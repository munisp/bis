import { createHash, createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "./_core/env";
import { getPgPool } from "./db";
import { protectedProcedure, router, writeProcedure } from "./_core/trpc";
import { permifyCheck } from "./permify";
import { encryptPiiEnvelope, piiAad } from "./piiEnvelopeCrypto";
import { activeTenantEncryptionRegistry } from "./piiKeyRegistry";

const CASE_REF = /^BIS-AA-[A-Z0-9]{18}$/;
const FCRA_MIN_WAIT_DAYS = 5;
const noticeTypeSchema = z.enum(["pre_adverse", "final_adverse", "undeliverable", "dispute_hold", "dispute_result"]);
const deliveryChannelSchema = z.enum(["portal", "email", "postal", "manual"]);
const frameworkSchema = z.enum(["ndpa", "fcra", "dual"]);
type NoticeType = z.infer<typeof noticeTypeSchema>;
type DeliveryChannel = z.infer<typeof deliveryChannelSchema>;
type CaseStatus = "pre_notice_queued" | "pre_notice_delivered" | "waiting" | "paused_for_dispute" | "final_notice_queued" | "completed" | "undeliverable" | "manual_delivery" | "canceled";
type TemplateRow = { id: string; template_key: NoticeType; jurisdiction_code: string; version: string; content_sha256: string };
type CaseRow = { id: string; status: CaseStatus; candidate_id: number; screening_order_id: number; jurisdiction_code: string; final_notice_eligible_at: string | null; paused_from_status: string | null };

function ref(): string { return `BIS-AA-${randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase()}`; }
function tenant(ctx: { tenantId: number | null }): number { if (ctx.tenantId === null) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant context is required." }); return ctx.tenantId; }
async function pool(): Promise<import("pg").Pool> { const value = await getPgPool(); if (!value) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "PostgreSQL is unavailable." }); return value; }
function eventHash(input: Record<string, unknown>): string { if (!ENV.auditHmacSecret) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit integrity key is unavailable." }); return createHmac("sha256", ENV.auditHmacSecret).update(JSON.stringify(input)).digest("hex"); }
function sha256(input: unknown): string { return createHash("sha256").update(JSON.stringify(input)).digest("hex"); }
function assertComplianceModuleEnabled(): void {
  if (ENV.isProduction && process.env.BIS_COMPLIANCE_ADVERSE_ACTION_ENABLED !== "true") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Adverse-action workflows are disabled pending counsel and operational approval." });
  }
}

function complianceProcedure(permission: "manage_adverse_actions" | "supervise_adverse_actions", roles: string[]) {
  return writeProcedure.use(async ({ ctx, next }) => {
    const tenantId = tenant(ctx); assertComplianceModuleEnabled();
    if (!ctx.user || !roles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "A designated adverse-action compliance role is required." });
    if (ENV.isProduction) {
      const allowed = await permifyCheck("platform", String(tenantId), permission, String(ctx.user.id));
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Adverse-action permission denied." });
    }
    return next({ ctx });
  });
}
const adjudicatorProcedure = complianceProcedure("manage_adverse_actions", ["admin", "supervisor", "analyst"]);
const administratorProcedure = complianceProcedure("supervise_adverse_actions", ["admin", "supervisor"]);
const caseRefSchema = z.string().regex(CASE_REF);

async function appendEvent(client: PoolClient, adverseActionCaseId: string, actorUserId: number | null, eventType: string, detail: Record<string, unknown>): Promise<void> {
  const createdAt = new Date().toISOString();
  await client.query(
    `INSERT INTO compliance_adverse_action_events (adverse_action_case_id, actor_user_id, event_type, detail, integrity_hash, created_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6::timestamptz)`,
    [adverseActionCaseId, actorUserId, eventType, JSON.stringify(detail), eventHash({ adverseActionCaseId, actorUserId, eventType, detail, createdAt }), createdAt],
  );
}

async function appendTemplateEvent(client: PoolClient, templateId: string, actorUserId: number, eventType: "created" | "superseded", detail: Record<string, unknown>): Promise<void> {
  const createdAt = new Date().toISOString();
  await client.query(
    `INSERT INTO compliance_template_events (template_id, actor_user_id, event_type, detail, integrity_hash, created_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6::timestamptz)`,
    [templateId, actorUserId, eventType, JSON.stringify(detail), eventHash({ templateId, actorUserId, eventType, detail, createdAt }), createdAt],
  );
}

async function lockedCase(client: PoolClient, caseRef: string, tenantId: number): Promise<CaseRow> {
  const query = await client.query<CaseRow>(
    `SELECT id,status,candidate_id,screening_order_id,jurisdiction_code,final_notice_eligible_at,paused_from_status
       FROM compliance_adverse_action_cases WHERE case_ref=$1 AND tenant_id=$2 FOR UPDATE`,
    [caseRef, tenantId],
  );
  if (!query.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Adverse-action case not found." });
  return query.rows[0];
}

async function assertNoOpenDispute(client: PoolClient, candidateId: number, tenantId: number): Promise<void> {
  const open = await client.query(
    `SELECT 1 FROM consumer_dispute_cases cds
      JOIN consumer_subject_bindings csb ON csb.id=cds.subject_binding_id
     WHERE csb.candidate_id=$1 AND cds.tenant_id=$2
       AND cds.status NOT IN ('resolved','withdrawn','frivolous') LIMIT 1`,
    [candidateId, tenantId],
  );
  if (open.rowCount) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A consumer dispute is open; adverse action must remain paused." });
}

async function queueNotice(client: PoolClient, input: { tenantId: number; caseId: string; caseRef: string; candidateId: number; template: TemplateRow; noticeType: NoticeType; channel: DeliveryChannel }): Promise<{ deliveryId: string; outboxId: string | null }> {
  const deliveryId = randomUUID();
  const contentSha256 = sha256({ caseRef: input.caseRef, noticeType: input.noticeType, templateId: input.template.id, templateContentSha256: input.template.content_sha256 });
  await client.query(
    `INSERT INTO compliance_notice_deliveries (id,adverse_action_case_id,template_id,notice_type,channel,status,content_sha256)
     VALUES ($1,$2,$3,$4,$5,'queued',$6)`,
    [deliveryId, input.caseId, input.template.id, input.noticeType, input.channel, contentSha256],
  );
  if (input.channel === "manual") return { deliveryId, outboxId: null };
  const outboxId = randomUUID();
  const key = await activeTenantEncryptionRegistry(client, input.tenantId);
  const payload = { caseRef: input.caseRef, candidateId: input.candidateId, templateId: input.template.id, templateKey: input.template.template_key, jurisdictionCode: input.template.jurisdiction_code, templateVersion: input.template.version, noticeType: input.noticeType, channel: input.channel, deliveryId };
  const encrypted = await encryptPiiEnvelope(key, piiAad(input.tenantId, "candidate_profile", input.candidateId, `compliance-notice-outbox:${outboxId}`), payload);
  await client.query(
    `INSERT INTO compliance_notice_delivery_outbox
       (id,tenant_id,adverse_action_case_id,delivery_id,payload_ciphertext,payload_nonce,payload_key_version,payload_sha256,idempotency_key,payload_crypto_provider,payload_provider_key_version,payload_key_registry_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [outboxId, input.tenantId, input.caseId, deliveryId, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, sha256(payload), randomUUID(), encrypted.cryptoProvider, encrypted.providerKeyVersion, key.id],
  );
  return { deliveryId, outboxId };
}

async function templateFor(client: PoolClient, tenantId: number, type: NoticeType, jurisdictionCode: string, version: string): Promise<TemplateRow> {
  const template = await client.query<TemplateRow>(
    `SELECT id,template_key,jurisdiction_code,version,content_sha256 FROM compliance_notice_templates
      WHERE tenant_id=$1 AND template_key=$2 AND jurisdiction_code=$3 AND version=$4 AND superseded_at IS NULL FOR SHARE`,
    [tenantId, type, jurisdictionCode, version],
  );
  if (!template.rows[0]) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "An active counsel-approved notice template is unavailable." });
  return template.rows[0];
}

export async function pauseAdverseActionsForOpenDispute(client: PoolClient, input: { tenantId: number; candidateId: number; disputeCaseRef: string; actorUserId: number | null }): Promise<number> {
  const cases = await client.query<{ id: string; case_ref: string; status: string; final_notice_eligible_at: string | null }>(
    `SELECT id,case_ref,status,final_notice_eligible_at FROM compliance_adverse_action_cases
      WHERE tenant_id=$1 AND candidate_id=$2 AND status IN ('pre_notice_queued','pre_notice_delivered','waiting','final_notice_queued') FOR UPDATE`,
    [input.tenantId, input.candidateId],
  );
  for (const row of cases.rows) {
    const remainingSeconds = row.final_notice_eligible_at
      ? Math.max(0, Math.ceil((new Date(row.final_notice_eligible_at).getTime() - Date.now()) / 1000))
      : null;
    await client.query(`UPDATE compliance_adverse_action_cases SET status='paused_for_dispute',paused_from_status=$2,paused_at=NOW(),updated_at=NOW() WHERE id=$1`, [row.id, row.status]);
    await client.query(`UPDATE compliance_notice_deliveries SET status='canceled' WHERE adverse_action_case_id=$1 AND status IN ('queued','sent')`, [row.id]);
    await client.query(`UPDATE compliance_notice_delivery_outbox SET state='cancelled',last_error_code='COMPLIANCE_NOTICE_PAUSED_FOR_DISPUTE',updated_at=NOW() WHERE adverse_action_case_id=$1 AND state IN ('pending','leased')`, [row.id]);
    await appendEvent(client, row.id, input.actorUserId, "paused_for_dispute", { disputeCaseRef: input.disputeCaseRef, automatic: true, remainingWaitSeconds: remainingSeconds });
  }
  return cases.rowCount ?? 0;
}

function assertFcraEnabled(framework: "ndpa" | "fcra" | "dual", jurisdictionCode: string, attestation?: string): void {
  if (framework === "ndpa") return;
  if (jurisdictionCode !== "US") throw new TRPCError({ code: "BAD_REQUEST", message: "FCRA adverse-action workflows require the US jurisdiction." });
  if (process.env.BIS_FCRA_ADVERSE_ACTION_ENABLED !== "true") throw new TRPCError({ code: "FORBIDDEN", message: "FCRA adverse action is not counsel-approved and enabled for this environment." });
  if (!attestation || attestation.trim().length < 40) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A case-specific FCRA eligibility attestation is required." });
}

export const complianceWorkflowRouter = router({
  createNoticeTemplate: administratorProcedure.input(z.object({ templateKey: noticeTypeSchema, jurisdictionCode: z.string().trim().regex(/^[A-Z]{2}(-[A-Z0-9]{1,8})?$/), version: z.string().trim().min(1).max(32), body: z.string().trim().min(32).max(100_000), counselApprovalReference: z.string().trim().min(12).max(256) })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await client.query("BEGIN");
      const key = await activeTenantEncryptionRegistry(client, tenantId);
      const encrypted = await encryptPiiEnvelope(key, `bis-compliance-template:v2|${tenantId}|${input.templateKey}|${input.jurisdictionCode}|${input.version}`, { body: input.body });
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO compliance_notice_templates (tenant_id,template_key,jurisdiction_code,version,body_ciphertext,body_nonce,body_key_version,content_sha256,approved_by,counsel_approval_reference,body_crypto_provider,body_provider_key_version,body_key_registry_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [tenantId, input.templateKey, input.jurisdictionCode, input.version, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, encrypted.plaintextSha256, ctx.user.id, input.counselApprovalReference, encrypted.cryptoProvider, encrypted.providerKeyVersion, key.id],
      );
      await appendTemplateEvent(client, inserted.rows[0]!.id, ctx.user.id, "created", { templateKey: input.templateKey, jurisdictionCode: input.jurisdictionCode, version: input.version, counselApprovalReference: input.counselApprovalReference });
      await client.query("COMMIT");
      return { templateId: inserted.rows[0]!.id, version: input.version };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  supersedeNoticeTemplate: administratorProcedure.input(z.object({ templateId: z.string().uuid(), reason: z.string().trim().min(20).max(4_000) })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<{ id: string }>(`UPDATE compliance_notice_templates SET superseded_at=NOW() WHERE id=$1 AND tenant_id=$2 AND superseded_at IS NULL RETURNING id`, [input.templateId, tenantId]);
      if (!updated.rows[0]) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Active notice template not found." });
      await appendTemplateEvent(client, input.templateId, ctx.user.id, "superseded", { reason: input.reason });
      await client.query("COMMIT"); return { templateId: input.templateId, superseded: true };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  initiatePreAdverse: adjudicatorProcedure.input(z.object({ screeningOrderId: z.number().int().positive(), reportSnapshotId: z.number().int().positive(), candidateConsentRef: z.string().trim().min(8).max(32), framework: frameworkSchema.default("ndpa"), jurisdictionCode: z.string().trim().regex(/^[A-Z]{2}$/), fcraEligibilityAttestation: z.string().trim().min(40).max(4_000).optional(), waitingPeriodDays: z.number().int().min(FCRA_MIN_WAIT_DAYS).max(30), templateVersion: z.string().trim().min(1).max(32), channel: deliveryChannelSchema.default("portal"), items: z.array(z.object({ screeningResultId: z.number().int().positive(), rationale: z.string().trim().min(20).max(4_000) })).min(1).max(50), employerAttestation: z.string().trim().min(40).max(4_000) })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); assertFcraEnabled(input.framework, input.jurisdictionCode, input.fcraEligibilityAttestation); const db = await pool(); const client = await db.connect();
    try {
      await client.query("BEGIN");
      const source = await client.query<{ candidate_id: number }>(
        `SELECT so."candidateId" AS candidate_id FROM screening_orders so
          JOIN consumer_report_snapshots rs ON rs.id=$2 AND rs.tenant_id=$1 AND rs.screening_order_id=so.id AND rs.candidate_id=so."candidateId"
          JOIN candidate_consents cc ON cc."consentRef"=$4 AND cc."candidateId"=so."candidateId" AND (cc."orderId" IS NULL OR cc."orderId"=so.id) AND cc."signedAt" IS NOT NULL AND cc."revokedAt" IS NULL
         WHERE so.id=$3 AND so."tenantId"=$1 AND so.status='completed' FOR UPDATE`,
        [tenantId, input.reportSnapshotId, input.screeningOrderId, input.candidateConsentRef],
      );
      if (!source.rows[0]) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A completed tenant order, matching immutable snapshot, and active signed candidate consent are required." });
      await assertNoOpenDispute(client, source.rows[0].candidate_id, tenantId);
      const template = await templateFor(client, tenantId, "pre_adverse", input.jurisdictionCode, input.templateVersion);
      const caseRef = ref();
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO compliance_adverse_action_cases
           (case_ref,tenant_id,screening_order_id,candidate_id,report_snapshot_id,jurisdiction_code,framework,status,waiting_period_days,initiated_by,employer_attestation_at,employer_attestation_text,fcra_eligibility_attested_at,fcra_eligibility_attestation_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pre_notice_queued',$8,$9,NOW(),$10,$11,$12) RETURNING id`,
        [caseRef, tenantId, input.screeningOrderId, source.rows[0].candidate_id, input.reportSnapshotId, input.jurisdictionCode, input.framework, input.waitingPeriodDays, ctx.user.id, input.employerAttestation, input.framework === "ndpa" ? null : new Date(), input.framework === "ndpa" ? null : input.fcraEligibilityAttestation],
      );
      const key = await activeTenantEncryptionRegistry(client, tenantId);
      for (const item of input.items) {
        const result = await client.query(`SELECT 1 FROM screening_results WHERE id=$1 AND "orderId"=$2 FOR UPDATE`, [item.screeningResultId, input.screeningOrderId]);
        if (!result.rowCount) throw new TRPCError({ code: "BAD_REQUEST", message: "Selected adverse-action item is not in this screening order." });
        const encrypted = await encryptPiiEnvelope(key, piiAad(tenantId, "candidate_profile", source.rows[0].candidate_id, `adverse-rationale:${caseRef}:${item.screeningResultId}`), { rationale: item.rationale });
        await client.query(`INSERT INTO compliance_adverse_action_items (adverse_action_case_id,screening_result_id,rationale_ciphertext,rationale_nonce,rationale_key_version,rationale_crypto_provider,rationale_provider_key_version,rationale_key_registry_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [inserted.rows[0]!.id, item.screeningResultId, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, encrypted.cryptoProvider, encrypted.providerKeyVersion, key.id]);
      }
      const queued = await queueNotice(client, { tenantId, caseId: inserted.rows[0]!.id, caseRef, candidateId: source.rows[0].candidate_id, template, noticeType: "pre_adverse", channel: input.channel });
      await appendEvent(client, inserted.rows[0]!.id, ctx.user.id, "created", { caseRef, framework: input.framework, itemCount: input.items.length, jurisdiction: input.jurisdictionCode });
      await appendEvent(client, inserted.rows[0]!.id, ctx.user.id, "pre_notice_queued", { templateVersion: input.templateVersion, deliveryId: queued.deliveryId, outboxId: queued.outboxId, channel: input.channel });
      await client.query("COMMIT"); return { caseRef, deliveryId: queued.deliveryId, status: "pre_notice_queued" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  recordDelivery: adjudicatorProcedure.input(z.object({ caseRef: caseRefSchema, deliveryId: z.string().uuid(), status: z.enum(["delivered", "undeliverable", "manual_required"]), providerMessageRef: z.string().trim().min(4).max(256).optional() })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await client.query("BEGIN"); const c = await lockedCase(client, input.caseRef, tenantId);
      const delivery = await client.query<{ notice_type: NoticeType; channel: DeliveryChannel; status: string }>(`SELECT notice_type,channel,status FROM compliance_notice_deliveries WHERE id=$1 AND adverse_action_case_id=$2 FOR UPDATE`, [input.deliveryId, c.id]);
      const current = delivery.rows[0];
      if (!current || !["queued", "manual_required"].includes(current.status) || (current.status === "manual_required" && current.channel !== "manual")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "An eligible queued or manual notice delivery was not found." });
      await client.query(`UPDATE compliance_notice_deliveries SET status=$1,sent_at=CASE WHEN $1='delivered' THEN NOW() ELSE sent_at END,delivered_at=CASE WHEN $1='delivered' THEN NOW() ELSE delivered_at END,provider_message_ref=$2 WHERE id=$3`, [input.status, input.providerMessageRef ?? null, input.deliveryId]);
      await client.query(`UPDATE compliance_notice_delivery_outbox SET state='cancelled',last_error_code='COMPLIANCE_DELIVERY_RECORDED_MANUALLY',updated_at=NOW() WHERE delivery_id=$1 AND state IN ('pending','leased')`, [input.deliveryId]);
      if (input.status === "delivered" && current.notice_type === "pre_adverse") {
        await client.query(`UPDATE compliance_adverse_action_cases SET status='waiting',pre_notice_due_at=NOW(),final_notice_eligible_at=NOW()+make_interval(days=>waiting_period_days),updated_at=NOW() WHERE id=$1`, [c.id]);
        await appendEvent(client, c.id, ctx.user.id, "pre_notice_delivered", { deliveryId: input.deliveryId, manual: current.channel === "manual" });
      } else if (input.status === "delivered" && current.notice_type === "final_adverse") {
        await client.query(`UPDATE compliance_adverse_action_cases SET status='completed',final_notice_sent_at=NOW(),updated_at=NOW() WHERE id=$1`, [c.id]);
        await appendEvent(client, c.id, ctx.user.id, "final_notice_delivered", { deliveryId: input.deliveryId, manual: current.channel === "manual" });
        await appendEvent(client, c.id, ctx.user.id, "completed", { deliveryId: input.deliveryId });
      } else {
        await client.query(`UPDATE compliance_adverse_action_cases SET status=$1,updated_at=NOW() WHERE id=$2`, [input.status === "undeliverable" ? "undeliverable" : "manual_delivery", c.id]);
        await appendEvent(client, c.id, ctx.user.id, "manual_delivery_required", { deliveryId: input.deliveryId, status: input.status });
      }
      await client.query("COMMIT"); return { caseRef: input.caseRef, status: input.status };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  pauseForDispute: adjudicatorProcedure.input(z.object({ caseRef: caseRefSchema, disputeCaseRef: z.string().regex(/^BIS-DR-[A-Z0-9]{18}$/) })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await client.query("BEGIN"); const c = await lockedCase(client, input.caseRef, tenantId);
      if (!["waiting", "pre_notice_delivered"].includes(c.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only a delivered pre-adverse case in its waiting period can be paused." });
      const disputed = await client.query(`SELECT 1 FROM consumer_dispute_cases d JOIN consumer_subject_bindings b ON b.id=d.subject_binding_id WHERE d.case_ref=$1 AND d.tenant_id=$2 AND b.candidate_id=$3 AND d.status NOT IN ('resolved','withdrawn','frivolous')`, [input.disputeCaseRef, tenantId, c.candidate_id]);
      if (!disputed.rowCount) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "An open dispute bound to this candidate is required to pause adverse action." });
      const paused = await pauseAdverseActionsForOpenDispute(client, { tenantId, candidateId: c.candidate_id, disputeCaseRef: input.disputeCaseRef, actorUserId: ctx.user.id });
      if (paused !== 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Adverse-action case was not eligible for a dispute hold." });
      await client.query("COMMIT"); return { caseRef: input.caseRef, status: "paused_for_dispute" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  resumeAfterDispute: administratorProcedure.input(z.object({ caseRef: caseRefSchema, resolutionReference: z.string().trim().min(12).max(256) })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await client.query("BEGIN"); const c = await lockedCase(client, input.caseRef, tenantId);
      if (c.status !== "paused_for_dispute" || !["pre_notice_queued", "pre_notice_delivered", "waiting", "final_notice_queued"].includes(c.paused_from_status ?? "")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Case is not eligible for dispute-resolution resumption." });
      await assertNoOpenDispute(client, c.candidate_id, tenantId);
      const pausedFrom = c.paused_from_status!;
      if (pausedFrom === "pre_notice_queued" || pausedFrom === "final_notice_queued") {
        const prior = await client.query<TemplateRow & { notice_type: NoticeType; channel: DeliveryChannel }>(`SELECT t.id,t.template_key,t.jurisdiction_code,t.version,t.content_sha256,d.notice_type,d.channel FROM compliance_notice_deliveries d JOIN compliance_notice_templates t ON t.id=d.template_id WHERE d.adverse_action_case_id=$1 AND d.status='canceled' AND d.notice_type=$2 ORDER BY d.created_at DESC LIMIT 1 FOR SHARE`, [c.id, pausedFrom === "pre_notice_queued" ? "pre_adverse" : "final_adverse"]);
        const original = prior.rows[0]; if (!original) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The original paused notice cannot be safely re-queued." });
        const queued = await queueNotice(client, { tenantId, caseId: c.id, caseRef: input.caseRef, candidateId: c.candidate_id, template: original, noticeType: original.notice_type, channel: original.channel });
        await client.query(`UPDATE compliance_adverse_action_cases SET status=$2,paused_from_status=NULL,paused_at=NULL,updated_at=NOW() WHERE id=$1`, [c.id, pausedFrom]);
        await appendEvent(client, c.id, ctx.user.id, "resumed", { resolutionReference: input.resolutionReference, deliveryId: queued.deliveryId, outboxId: queued.outboxId, requeued: true });
        await client.query("COMMIT"); return { caseRef: input.caseRef, deliveryId: queued.deliveryId, status: pausedFrom as "pre_notice_queued" | "final_notice_queued" };
      }
      const remaining = await client.query<{ remaining_seconds: number | null }>(`SELECT GREATEST(0, EXTRACT(EPOCH FROM (final_notice_eligible_at - paused_at)))::integer AS remaining_seconds FROM compliance_adverse_action_cases WHERE id=$1 FOR UPDATE`, [c.id]);
      const remainingSeconds = remaining.rows[0]?.remaining_seconds ?? null;
      await client.query(`UPDATE compliance_adverse_action_cases SET status='waiting',paused_from_status=NULL,paused_at=NULL,final_notice_eligible_at=CASE WHEN $2::integer IS NULL THEN NULL ELSE NOW()+make_interval(secs=>$2::integer) END,updated_at=NOW() WHERE id=$1`, [c.id, remainingSeconds]);
      await appendEvent(client, c.id, ctx.user.id, "resumed", { resolutionReference: input.resolutionReference, remainingWaitSeconds: remainingSeconds });
      await client.query("COMMIT"); return { caseRef: input.caseRef, status: "waiting" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  queueFinalAdverse: adjudicatorProcedure.input(z.object({ caseRef: caseRefSchema, templateVersion: z.string().trim().min(1).max(32), channel: deliveryChannelSchema.default("portal") })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await client.query("BEGIN"); const c = await lockedCase(client, input.caseRef, tenantId);
      if (c.status !== "waiting" || !c.final_notice_eligible_at || new Date(c.final_notice_eligible_at) > new Date()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Pre-adverse waiting period has not completed." });
      await assertNoOpenDispute(client, c.candidate_id, tenantId); const template = await templateFor(client, tenantId, "final_adverse", c.jurisdiction_code, input.templateVersion);
      const queued = await queueNotice(client, { tenantId, caseId: c.id, caseRef: input.caseRef, candidateId: c.candidate_id, template, noticeType: "final_adverse", channel: input.channel });
      await client.query(`UPDATE compliance_adverse_action_cases SET status='final_notice_queued',updated_at=NOW() WHERE id=$1`, [c.id]);
      await appendEvent(client, c.id, ctx.user.id, "final_notice_queued", { templateVersion: input.templateVersion, deliveryId: queued.deliveryId, outboxId: queued.outboxId, channel: input.channel });
      await client.query("COMMIT"); return { caseRef: input.caseRef, deliveryId: queued.deliveryId, status: "final_notice_queued" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  resolveManualDelivery: administratorProcedure.input(z.object({ caseRef: caseRefSchema, deliveryId: z.string().uuid(), channel: deliveryChannelSchema, resolutionReference: z.string().trim().min(12).max(256) })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await client.query("BEGIN"); const c = await lockedCase(client, input.caseRef, tenantId);
      if (!["manual_delivery", "undeliverable"].includes(c.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Case does not require manual delivery recovery." });
      const original = await client.query<TemplateRow & { notice_type: NoticeType }>(`SELECT t.id,t.template_key,t.jurisdiction_code,t.version,t.content_sha256,d.notice_type FROM compliance_notice_deliveries d JOIN compliance_notice_templates t ON t.id=d.template_id WHERE d.id=$1 AND d.adverse_action_case_id=$2 AND d.status IN ('undeliverable','manual_required') FOR SHARE`, [input.deliveryId, c.id]);
      const source = original.rows[0]; if (!source) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Undeliverable or manual notice delivery not found." });
      if (source.notice_type !== "pre_adverse" && source.notice_type !== "final_adverse") throw new TRPCError({ code: "BAD_REQUEST", message: "Only adverse-action notice deliveries can be recovered." });
      const queued = await queueNotice(client, { tenantId, caseId: c.id, caseRef: input.caseRef, candidateId: c.candidate_id, template: source, noticeType: source.notice_type, channel: input.channel });
      await client.query(`UPDATE compliance_adverse_action_cases SET status=$2,updated_at=NOW() WHERE id=$1`, [c.id, source.notice_type === "pre_adverse" ? "pre_notice_queued" : "final_notice_queued"]);
      await appendEvent(client, c.id, ctx.user.id, "manual_delivery_resolved", { priorDeliveryId: input.deliveryId, deliveryId: queued.deliveryId, outboxId: queued.outboxId, resolutionReference: input.resolutionReference, channel: input.channel });
      await client.query("COMMIT"); return { caseRef: input.caseRef, deliveryId: queued.deliveryId, status: source.notice_type === "pre_adverse" ? "pre_notice_queued" as const : "final_notice_queued" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  cancel: adjudicatorProcedure.input(z.object({ caseRef: caseRefSchema, reason: z.string().trim().min(20).max(4_000) })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await client.query("BEGIN"); const c = await lockedCase(client, input.caseRef, tenantId);
      if (["completed", "canceled"].includes(c.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Completed or canceled adverse action cannot be changed." });
      await client.query(`UPDATE compliance_adverse_action_cases SET status='canceled',updated_at=NOW() WHERE id=$1`, [c.id]);
      await client.query(`UPDATE compliance_notice_deliveries SET status='canceled' WHERE adverse_action_case_id=$1 AND status IN ('queued','sent')`, [c.id]);
      await client.query(`UPDATE compliance_notice_delivery_outbox SET state='cancelled',last_error_code='COMPLIANCE_CASE_CANCELLED',updated_at=NOW() WHERE adverse_action_case_id=$1 AND state IN ('pending','leased')`, [c.id]);
      await appendEvent(client, c.id, ctx.user.id, "canceled", { reason: input.reason });
      await client.query("COMMIT"); return { caseRef: input.caseRef, status: "canceled" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  list: protectedProcedure.input(z.object({ status: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); assertComplianceModuleEnabled(); if (!ctx.user || !["admin", "supervisor", "analyst", "auditor"].includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "A designated compliance read role is required." });
    if (ENV.isProduction && !(await permifyCheck("platform", String(tenantId), "manage_adverse_actions", String(ctx.user.id)))) throw new TRPCError({ code: "FORBIDDEN", message: "Adverse-action permission denied." });
    const db = await pool(); const res = await db.query(`SELECT case_ref,status,framework,jurisdiction_code,waiting_period_days,final_notice_eligible_at,created_at FROM compliance_adverse_action_cases WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC LIMIT 200`, [tenantId, input?.status ?? null]);
    return res.rows;
  }),
});
