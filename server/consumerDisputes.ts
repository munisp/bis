import { createHash, createHmac, randomUUID } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PoolClient } from "pg";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPgPool } from "./db";
import { adminProcedure, protectedProcedure, router, writeProcedure } from "./_core/trpc";
import { ENV } from "./_core/env";
import { evidenceStorage, s3ChecksumMatchesSha256Hex, s3ChecksumSha256FromHex } from "./fieldEvidence";
import { consumerDisputeOutboxAad, encryptConsumerDisputeOutboxPayload, loadConsumerDisputeOutboxKeyring } from "./consumerDisputeOutboxCrypto";
import { permifyCheck } from "./permify";

const FCRA_REINVESTIGATION_DAYS = 30;
const CONSERVATIVE_NOTICE_DAYS = 5;
const MAX_DISPUTE_EVIDENCE_BYTES = 10 * 1024 * 1024;
const DISPUTE_EVIDENCE_TTL_SECONDS = 15 * 60;
const DISPUTE_EVIDENCE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
const CASE_REF_PATTERN = /^BIS-DR-[A-Z0-9]{18}$/;
const SNAPSHOT_REF_PATTERN = /^BIS-RPT-[A-Z0-9]{18}$/;
const ITEM_REF_PATTERN = /^BIS-DI-[A-Z0-9]{18}$/;
const TASK_REF_PATTERN = /^BIS-DST-[A-Z0-9]{18}$/;

const frameworkSchema = z.enum(["ndpa", "fcra", "dual"]);
const caseTypeSchema = z.enum([
  "accuracy", "completeness", "source_provenance", "suppression", "objection", "deletion", "method_description",
]);
const dispositionSchema = z.enum(["verified", "corrected", "deleted", "partially_resolved", "unverifiable", "not_in_scope"]);
const sourceResponseSchema = z.enum(["verified", "corrected", "deleted", "unverifiable", "no_response"]);

export type ConsumerDisputeEventActor = "consumer" | "caseworker" | "supervisor" | "provider" | "system";
export type ConsumerDisputeEventName =
  | "submitted" | "identity_verified" | "accepted" | "assigned" | "item_held" | "source_task_created"
  | "source_task_dispatched" | "source_response_recorded" | "extension_applied" | "frivolous_determined"
  | "item_corrected" | "item_deleted" | "item_verified" | "item_unverifiable" | "notice_queued"
  | "notice_delivered" | "method_description_requested" | "method_description_delivered" | "withdrawn"
  | "completed" | "reinserted" | "recipient_remediation_queued" | "evidence_initiated"
  | "evidence_verified" | "evidence_quarantined" | "deadline_escalated" | "deadline_acknowledged"
  | "deadline_resolved" | "provider_outbox_enqueued" | "provider_outbox_delivered" | "provider_outbox_failed";

type CaseRow = {
  id: string;
  case_ref: string;
  tenant_id: number;
  requester_user_id: number;
  subject_binding_id: string;
  framework: "ndpa" | "fcra" | "dual";
  jurisdiction_code: string;
  case_type: string;
  status: string;
  received_at: string;
  reinvestigation_due_at: string | null;
  extension_due_at: string | null;
  result_notice_due_at: string | null;
  completed_at: string | null;
};

function makeRef(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase()}`;
}

function requireTenant(tenantId: number | null): number {
  if (tenantId === null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "A tenant-scoped account is required for this action." });
  }
  return tenantId;
}

async function poolOrThrow() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "PostgreSQL is unavailable." });
  return pool;
}

function requireFcraModule(framework: z.infer<typeof frameworkSchema>, jurisdictionCode: string): void {
  if (framework === "ndpa") return;
  if (jurisdictionCode !== "US") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "FCRA reinvestigation cases require the US jurisdiction configuration." });
  }
  if (process.env.BIS_FCRA_CASES_ENABLED !== "true") {
    throw new TRPCError({ code: "FORBIDDEN", message: "The FCRA case module is not counsel-approved and enabled for this environment." });
  }
}

function calculateFcraClock(receivedAt: Date, framework: z.infer<typeof frameworkSchema>) {
  if (framework === "ndpa") return { reinvestigationDueAt: null, resultNoticeDueAt: null };
  return {
    reinvestigationDueAt: new Date(receivedAt.getTime() + FCRA_REINVESTIGATION_DAYS * 24 * 60 * 60 * 1000),
    // A five-calendar-day internal deadline is conservative relative to a five-business-day legal deadline.
    resultNoticeDueAt: new Date(receivedAt.getTime() + CONSERVATIVE_NOTICE_DAYS * 24 * 60 * 60 * 1000),
  };
}

function eventDigest(input: {
  caseRef: string;
  actorUserId: number | null;
  actorKind: ConsumerDisputeEventActor;
  eventType: ConsumerDisputeEventName;
  detail: Record<string, unknown>;
  occurredAt: string;
}): string {
  const auditKey = ENV.auditHmacSecret;
  if (!auditKey) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit integrity key is unavailable." });
  const canonical = JSON.stringify({
    caseRef: input.caseRef,
    actorUserId: input.actorUserId,
    actorKind: input.actorKind,
    eventType: input.eventType,
    detail: input.detail,
    occurredAt: input.occurredAt,
  });
  return createHmac("sha256", auditKey).update(canonical).digest("hex");
}

export async function appendConsumerDisputeEvent(client: PoolClient, input: {
  caseId: string;
  caseRef: string;
  actorUserId: number | null;
  actorKind: ConsumerDisputeEventActor;
  eventType: ConsumerDisputeEventName;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const occurredAt = new Date().toISOString();
  const detail = input.detail ?? {};
  const integrityHash = eventDigest({
    caseRef: input.caseRef,
    actorUserId: input.actorUserId,
    actorKind: input.actorKind,
    eventType: input.eventType,
    detail,
    occurredAt,
  });
  await client.query(
    `INSERT INTO consumer_dispute_events
       (case_id, actor_user_id, actor_kind, event_type, detail, integrity_hash, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz)`,
    [input.caseId, input.actorUserId, input.actorKind, input.eventType, JSON.stringify(detail), integrityHash, occurredAt],
  );
}

async function queueNotice(client: PoolClient, input: {
  caseId: string;
  caseRef: string;
  noticeType: "acknowledgement" | "identity_needed" | "frivolous" | "extension" | "result" | "method_description" | "reinsertion" | "recipient_remediation";
  recipientKind: "consumer" | "institution" | "furnisher" | "provider";
  templateVersion: string;
  actorUserId: number | null;
  actorKind: ConsumerDisputeEventActor;
  payload: Record<string, unknown>;
}): Promise<string> {
  const noticeRef = makeRef("BIS-NOT");
  const canonicalPayload = JSON.stringify({ noticeRef, caseRef: input.caseRef, type: input.noticeType, payload: input.payload });
  const contentHash = createHash("sha256").update(canonicalPayload).digest("hex");
  await client.query(
    `INSERT INTO consumer_dispute_notices
       (notice_ref, case_id, notice_type, template_version, delivery_channel, recipient_kind, delivery_status, content_sha256)
     VALUES ($1, $2, $3, $4, 'portal', $5, 'queued', $6)`,
    [noticeRef, input.caseId, input.noticeType, input.templateVersion, input.recipientKind, contentHash],
  );
  await appendConsumerDisputeEvent(client, {
    caseId: input.caseId,
    caseRef: input.caseRef,
    actorUserId: input.actorUserId,
    actorKind: input.actorKind,
    eventType: "notice_queued",
    detail: { noticeRef, noticeType: input.noticeType, recipientKind: input.recipientKind, templateVersion: input.templateVersion },
  });
  return noticeRef;
}

function caseworkerProcedure(permission: "manage_consumer_disputes" | "supervise_consumer_disputes") {
  return writeProcedure.use(async ({ ctx, next }) => {
    if (!ctx.user || !["admin", "analyst", "supervisor"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "A designated consumer-rights case role is required." });
    }
    if (ENV.isProduction) {
      const allowed = await permifyCheck("platform", "bis", permission, String(ctx.user.id));
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Consumer-rights permission denied." });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

const caseworkerWriteProcedure = caseworkerProcedure("manage_consumer_disputes");
const supervisorWriteProcedure = caseworkerProcedure("supervise_consumer_disputes");

async function assertConsumerCaseOwner(client: PoolClient, input: { caseRef: string; userId: number; tenantId: number }): Promise<CaseRow> {
  const result = await client.query<CaseRow>(
    `SELECT id, case_ref, tenant_id, requester_user_id, subject_binding_id, framework, jurisdiction_code, case_type,
            status, received_at, reinvestigation_due_at, extension_due_at, result_notice_due_at, completed_at
       FROM consumer_dispute_cases
      WHERE case_ref = $1 AND requester_user_id = $2 AND tenant_id = $3`,
    [input.caseRef, input.userId, input.tenantId],
  );
  const row = result.rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Consumer dispute case not found." });
  return row;
}

async function assertInternalCase(client: PoolClient, caseRef: string, tenantId: number | null): Promise<CaseRow> {
  const result = await client.query<CaseRow>(
    `SELECT id, case_ref, tenant_id, requester_user_id, subject_binding_id, framework, jurisdiction_code, case_type,
            status, received_at, reinvestigation_due_at, extension_due_at, result_notice_due_at, completed_at
       FROM consumer_dispute_cases
      WHERE case_ref = $1 AND ($2::integer IS NULL OR tenant_id = $2)
      FOR UPDATE`,
    [caseRef, tenantId],
  );
  const row = result.rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Consumer dispute case not found." });
  return row;
}

export const consumerDisputesRouter = router({
  bindSubject: supervisorWriteProcedure.input(z.object({
    consumerUserId: z.number().int().positive(),
    candidateRef: z.string().trim().min(8).max(32),
    verificationReference: z.string().trim().min(12).max(160),
    assuranceLevel: z.enum(["identity_verified", "manual_verified"]),
  })).mutation(async ({ ctx, input }) => {
    const tenantId = requireTenant(ctx.tenantId);
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const candidate = await client.query<{ id: number }>(
        `SELECT id FROM candidate_profiles WHERE "candidateRef" = $1 AND "tenantId" = $2 FOR UPDATE`,
        [input.candidateRef, tenantId],
      );
      if (!candidate.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Candidate not found in this tenant." });
      const user = await client.query<{ id: number }>(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [input.consumerUserId]);
      if (!user.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Consumer user account not found." });
      await client.query(
        `UPDATE consumer_subject_bindings SET revoked_at = NOW()
          WHERE tenant_id = $1 AND candidate_id = $2 AND revoked_at IS NULL`,
        [tenantId, candidate.rows[0].id],
      );
      const binding = await client.query<{ id: string }>(
        `INSERT INTO consumer_subject_bindings
           (user_id, tenant_id, candidate_id, assurance_level, verification_reference, verified_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [input.consumerUserId, tenantId, candidate.rows[0].id, input.assuranceLevel, input.verificationReference],
      );
      await client.query("COMMIT");
      return { bindingId: binding.rows[0]!.id, candidateRef: input.candidateRef, verified: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),

  snapshotCompletedOrder: caseworkerWriteProcedure.input(z.object({
    orderRef: z.string().trim().min(8).max(32),
    jurisdictionCode: z.string().trim().regex(/^[A-Z]{2}$/),
    reportPurpose: z.string().trim().min(3).max(96),
  })).mutation(async ({ ctx, input }) => {
    const tenantId = requireTenant(ctx.tenantId);
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const order = await client.query<{ id: number; candidate_id: number }>(
        `SELECT id, "candidateId" AS candidate_id
           FROM screening_orders
          WHERE "orderRef" = $1 AND "tenantId" = $2 AND "status" = 'completed'
          FOR UPDATE`,
        [input.orderRef, tenantId],
      );
      const screeningOrder = order.rows[0];
      if (!screeningOrder) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only a completed tenant screening order can be snapshotted." });
      const results = await client.query<{
        id: number; screening_type: string; status: string; outcome: string | null; data_source_ref: string | null;
        external_ref: string | null; completed_at: string | null; expires_at: string | null;
      }>(
        `SELECT id, "screeningType" AS screening_type, "status"::text AS status, "outcome"::text AS outcome,
                "dataSourceRef" AS data_source_ref, "externalRef" AS external_ref, "completedAt" AS completed_at, "expiresAt" AS expires_at
           FROM screening_results WHERE "orderId" = $1 ORDER BY id ASC`,
        [screeningOrder.id],
      );
      if (results.rows.length === 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A report snapshot requires at least one screening result." });
      const manifest = {
        schemaVersion: 1,
        orderRef: input.orderRef,
        jurisdictionCode: input.jurisdictionCode,
        reportPurpose: input.reportPurpose,
        generatedAt: new Date().toISOString(),
        items: results.rows.map((row) => ({
          reportItemKey: `screening-result:${row.id}`,
          screeningResultId: row.id,
          screeningType: row.screening_type,
          status: row.status,
          outcome: row.outcome,
          dataSourceRef: row.data_source_ref,
          externalRef: row.external_ref,
          completedAt: row.completed_at,
          expiresAt: row.expires_at,
        })),
      };
      const contentSha256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
      const snapshotRef = makeRef("BIS-RPT");
      await client.query(
        `INSERT INTO consumer_report_snapshots
           (snapshot_ref, tenant_id, candidate_id, screening_order_id, jurisdiction_code, report_purpose, content_sha256, manifest)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [snapshotRef, tenantId, screeningOrder.candidate_id, screeningOrder.id, input.jurisdictionCode, input.reportPurpose, contentSha256, JSON.stringify(manifest)],
      );
      await client.query("COMMIT");
      return { snapshotRef, contentSha256, itemCount: results.rows.length };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),

  open: writeProcedure.input(z.object({
    reportSnapshotRef: z.string().regex(SNAPSHOT_REF_PATTERN),
    framework: frameworkSchema.default("ndpa"),
    jurisdictionCode: z.string().trim().regex(/^[A-Z]{2}$/).default("NG"),
    caseType: caseTypeSchema,
    statement: z.string().trim().min(10).max(4_000),
    items: z.array(z.object({
      reportItemKey: z.string().trim().min(1).max(128),
      screeningResultId: z.number().int().positive().optional(),
      adverseItemId: z.number().int().positive().optional(),
      disputedValue: z.record(z.string(), z.unknown()).optional(),
    }).refine((item) => item.screeningResultId !== undefined || item.adverseItemId !== undefined || item.reportItemKey.length > 0, {
      message: "Every disputed item needs an immutable report item key or a result reference.",
    })).min(1).max(20),
  })).mutation(async ({ ctx, input }) => {
    const tenantId = requireTenant(ctx.tenantId);
    requireFcraModule(input.framework, input.jurisdictionCode);
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const binding = await client.query<{ binding_id: string; snapshot_id: string; candidate_id: number | null; manifest: unknown }>(
        `SELECT b.id AS binding_id, s.id AS snapshot_id, s.candidate_id, s.manifest
           FROM consumer_subject_bindings b
           JOIN consumer_report_snapshots s ON s.snapshot_ref = $1 AND s.tenant_id = $2
          WHERE b.user_id = $3 AND b.tenant_id = $2 AND b.revoked_at IS NULL
            AND b.assurance_level IN ('identity_verified', 'manual_verified')
            AND b.candidate_id IS NOT NULL AND b.candidate_id = s.candidate_id
          FOR UPDATE`,
        [input.reportSnapshotRef, tenantId, ctx.user.id],
      );
      const subject = binding.rows[0];
      if (!subject) {
        throw new TRPCError({ code: "FORBIDDEN", message: "A verified subject binding for this report is required before opening a dispute." });
      }
      const manifest = subject.manifest;
      const manifestItems = manifest && typeof manifest === "object" && "items" in manifest && Array.isArray(manifest.items)
        ? manifest.items
        : [];
      const allowedItems = new Map<number, string>();
      for (const item of manifestItems) {
        if (item && typeof item === "object" && "screeningResultId" in item && "reportItemKey" in item
          && typeof item.screeningResultId === "number" && typeof item.reportItemKey === "string") {
          allowedItems.set(item.screeningResultId, item.reportItemKey);
        }
      }
      for (const item of input.items) {
        if (item.screeningResultId === undefined || allowedItems.get(item.screeningResultId) !== item.reportItemKey) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Each disputed item must match an immutable screening result and report item in the selected snapshot." });
        }
        if (item.adverseItemId !== undefined) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Adverse-item disputes require a snapshot format that records the adverse item reference." });
        }
      }
      const receivedAt = new Date();
      const clocks = calculateFcraClock(receivedAt, input.framework);
      const caseRef = makeRef("BIS-DR");
      const caseInsert = await client.query<{ id: string }>(
        `INSERT INTO consumer_dispute_cases
           (case_ref, tenant_id, requester_user_id, subject_binding_id, report_snapshot_id, framework, jurisdiction_code,
            case_type, status, received_at, reinvestigation_due_at, source_notice_due_at, result_notice_due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'received', $9, $10, $11, $12)
         RETURNING id`,
        [
          caseRef, tenantId, ctx.user.id, subject.binding_id, subject.snapshot_id, input.framework, input.jurisdictionCode,
          input.caseType, receivedAt.toISOString(), clocks.reinvestigationDueAt?.toISOString() ?? null,
          input.framework === "ndpa" ? null : new Date(receivedAt.getTime() + CONSERVATIVE_NOTICE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
          clocks.resultNoticeDueAt?.toISOString() ?? null,
        ],
      );
      const caseId = caseInsert.rows[0]!.id;
      for (const item of input.items) {
        const itemRef = makeRef("BIS-DI");
        await client.query(
          `INSERT INTO consumer_dispute_items
             (item_ref, case_id, screening_result_id, adverse_item_id, report_item_key, disputed_value, consumer_statement,
              disposition, held_from_automation_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'pending', NOW())`,
          [itemRef, caseId, item.screeningResultId ?? null, item.adverseItemId ?? null, item.reportItemKey,
            JSON.stringify(item.disputedValue ?? {}), input.statement],
        );
      }
      await appendConsumerDisputeEvent(client, {
        caseId, caseRef, actorUserId: ctx.user.id, actorKind: "consumer", eventType: "submitted",
        detail: { framework: input.framework, jurisdictionCode: input.jurisdictionCode, caseType: input.caseType, itemCount: input.items.length },
      });
      for (const item of input.items) {
        await appendConsumerDisputeEvent(client, {
          caseId, caseRef, actorUserId: ctx.user.id, actorKind: "consumer", eventType: "item_held",
          detail: { reportItemKey: item.reportItemKey },
        });
      }
      const noticeRef = await queueNotice(client, {
        caseId, caseRef, noticeType: "acknowledgement", recipientKind: "consumer", templateVersion: "consumer-dispute-v1",
        actorUserId: ctx.user.id, actorKind: "consumer", payload: { framework: input.framework, caseType: input.caseType },
      });
      await client.query("COMMIT");
      return {
        caseRef,
        status: "received" as const,
        reinvestigationDueAt: clocks.reinvestigationDueAt?.toISOString() ?? null,
        acknowledgementNoticeRef: noticeRef,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),

  mine: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = requireTenant(ctx.tenantId);
    const pool = await poolOrThrow();
    const result = await pool.query<CaseRow>(
      `SELECT id, case_ref, tenant_id, requester_user_id, subject_binding_id, framework, jurisdiction_code, case_type,
              status, received_at, reinvestigation_due_at, extension_due_at, result_notice_due_at, completed_at
         FROM consumer_dispute_cases
        WHERE requester_user_id = $1 AND tenant_id = $2
        ORDER BY received_at DESC LIMIT 100`,
      [ctx.user.id, tenantId],
    );
    return result.rows.map(({ id: _id, tenant_id: _tenantId, requester_user_id: _requesterUserId, subject_binding_id: _subjectBindingId, ...row }) => row);
  }),

  getMine: protectedProcedure.input(z.object({ caseRef: z.string().regex(CASE_REF_PATTERN) })).query(async ({ ctx, input }) => {
    const tenantId = requireTenant(ctx.tenantId);
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      const caseRow = await assertConsumerCaseOwner(client, { caseRef: input.caseRef, userId: ctx.user.id, tenantId });
      const [items, notices, events] = await Promise.all([
        client.query(`SELECT item_ref, report_item_key, disposition, disposition_rationale, resolved_at, created_at
                        FROM consumer_dispute_items WHERE case_id = $1 ORDER BY created_at ASC`, [caseRow.id]),
        client.query(`SELECT notice_ref, notice_type, delivery_status, queued_at, delivered_at
                        FROM consumer_dispute_notices WHERE case_id = $1 ORDER BY queued_at ASC`, [caseRow.id]),
        client.query(`SELECT event_type, created_at, detail
                        FROM consumer_dispute_events WHERE case_id = $1 ORDER BY created_at ASC`, [caseRow.id]),
      ]);
      return {
        case: { ...caseRow, id: undefined, tenant_id: undefined, requester_user_id: undefined, subject_binding_id: undefined },
        items: items.rows,
        notices: notices.rows,
        events: events.rows,
      };
    } finally {
      client.release();
    }
  }),

  withdraw: writeProcedure.input(z.object({ caseRef: z.string().regex(CASE_REF_PATTERN) })).mutation(async ({ ctx, input }) => {
    const tenantId = requireTenant(ctx.tenantId);
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const caseRow = await assertConsumerCaseOwner(client, { caseRef: input.caseRef, userId: ctx.user.id, tenantId });
      if (["resolved", "withdrawn"].includes(caseRow.status)) {
        throw new TRPCError({ code: "CONFLICT", message: "This consumer dispute is already terminal." });
      }
      if (caseRow.status === "escalated") {
        throw new TRPCError({ code: "FORBIDDEN", message: "An escalated dispute cannot be withdrawn through self-service." });
      }
      await client.query(`UPDATE consumer_dispute_source_tasks SET status = 'cancelled', updated_at = NOW()
                           WHERE case_id = $1 AND status IN ('pending', 'dispatched', 'acknowledged')`, [caseRow.id]);
      await client.query(`UPDATE consumer_dispute_cases SET status = 'withdrawn', completed_at = NOW(), updated_at = NOW() WHERE id = $1`, [caseRow.id]);
      await appendConsumerDisputeEvent(client, { caseId: caseRow.id, caseRef: caseRow.case_ref, actorUserId: ctx.user.id, actorKind: "consumer", eventType: "withdrawn" });
      await client.query("COMMIT");
      return { caseRef: caseRow.case_ref, status: "withdrawn" as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),

  requestMethodDescription: writeProcedure.input(z.object({ caseRef: z.string().regex(CASE_REF_PATTERN) })).mutation(async ({ ctx, input }) => {
    const tenantId = requireTenant(ctx.tenantId);
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const caseRow = await assertConsumerCaseOwner(client, { caseRef: input.caseRef, userId: ctx.user.id, tenantId });
      if (!["fcra", "dual"].includes(caseRow.framework)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A reinvestigation-method request is unavailable for this case framework." });
      }
      const noticeRef = await queueNotice(client, {
        caseId: caseRow.id, caseRef: caseRow.case_ref, noticeType: "method_description", recipientKind: "consumer",
        templateVersion: "fcra-method-description-v1", actorUserId: ctx.user.id, actorKind: "consumer", payload: {},
      });
      await appendConsumerDisputeEvent(client, { caseId: caseRow.id, caseRef: caseRow.case_ref, actorUserId: ctx.user.id, actorKind: "consumer", eventType: "method_description_requested" });
      await client.query("COMMIT");
      return { caseRef: caseRow.case_ref, noticeRef, status: "queued" as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),

  initiateEvidence: writeProcedure.input(z.object({
    caseRef: z.string().regex(CASE_REF_PATTERN),
    contentType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
    contentLength: z.number().int().min(1).max(MAX_DISPUTE_EVIDENCE_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    idempotencyKey: z.string().uuid(),
  })).mutation(async ({ ctx, input }) => {
    const tenantId = requireTenant(ctx.tenantId);
    if (!DISPUTE_EVIDENCE_CONTENT_TYPES.has(input.contentType)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Consumer dispute evidence content type is not allowed." });
    }
    const pool = await poolOrThrow();
    const client = await pool.connect();
    let evidenceRef: string;
    let objectKey: string;
    let expiresAt: Date;
    let committed = false;
    try {
      await client.query("BEGIN");
      const caseRow = await assertConsumerCaseOwner(client, { caseRef: input.caseRef, userId: ctx.user.id, tenantId });
      if (["resolved", "withdrawn", "frivolous"].includes(caseRow.status)) {
        throw new TRPCError({ code: "CONFLICT", message: "Evidence cannot be added to this consumer dispute state." });
      }
      const existing = await client.query<{ evidence_ref: string; object_key: string; expires_at: string; custody_status: string }>(
        `SELECT evidence_ref, object_key, expires_at, custody_status
           FROM consumer_dispute_evidence
          WHERE case_id = $1 AND submitted_by_user_id = $2 AND idempotency_key = $3
          FOR UPDATE`,
        [caseRow.id, ctx.user.id, input.idempotencyKey],
      );
      const current = existing.rows[0];
      if (current) {
        if (current.custody_status !== "initiated") {
          throw new TRPCError({ code: "CONFLICT", message: "This evidence upload has already reached a terminal custody state." });
        }
        evidenceRef = current.evidence_ref;
        objectKey = current.object_key;
        expiresAt = new Date(current.expires_at);
        if (expiresAt <= new Date()) {
          await client.query(`UPDATE consumer_dispute_evidence SET custody_status = 'quarantined' WHERE evidence_ref = $1 AND custody_status = 'initiated'`, [evidenceRef]);
          await appendConsumerDisputeEvent(client, { caseId: caseRow.id, caseRef: caseRow.case_ref, actorUserId: ctx.user.id, actorKind: "consumer", eventType: "evidence_quarantined", detail: { evidenceRef, reason: "upload_authorization_expired" } });
          await client.query("COMMIT");
          committed = true;
          throw new TRPCError({ code: "CONFLICT", message: "The prior evidence upload authorization expired; use a new idempotency key." });
        }
      } else {
        evidenceRef = makeRef("BIS-DE");
        objectKey = `consumer-disputes/${tenantId}/${caseRow.id}/${evidenceRef}`;
        expiresAt = new Date(Date.now() + DISPUTE_EVIDENCE_TTL_SECONDS * 1000);
        const storage = evidenceStorage();
        await client.query(
          `INSERT INTO consumer_dispute_evidence
             (evidence_ref, case_id, submitted_by_user_id, idempotency_key, object_key, kms_key_id, ciphertext_sha256,
              content_type, byte_size, custody_status, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'initiated', $10)`,
          [evidenceRef, caseRow.id, ctx.user.id, input.idempotencyKey, objectKey, storage.kmsKeyId, input.sha256, input.contentType, input.contentLength, expiresAt],
        );
        await appendConsumerDisputeEvent(client, { caseId: caseRow.id, caseRef: caseRow.case_ref, actorUserId: ctx.user.id, actorKind: "consumer", eventType: "evidence_initiated", detail: { evidenceRef, contentType: input.contentType, contentLength: input.contentLength } });
      }
      await client.query("COMMIT");
      committed = true;
    } catch (error) {
      if (!committed) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const storage = evidenceStorage();
    const objectChecksum = s3ChecksumSha256FromHex(input.sha256);
    const command = new PutObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
      Metadata: { "dispute-evidence-id": evidenceRef, sha256: input.sha256 },
      ChecksumAlgorithm: "SHA256",
      ChecksumSHA256: objectChecksum,
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: storage.kmsKeyId,
    });
    const uploadUrl = await getSignedUrl(storage.client, command, { expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) });
    return {
      evidenceRef,
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
      headers: {
        "content-type": input.contentType,
        "x-amz-meta-dispute-evidence-id": evidenceRef,
        "x-amz-meta-sha256": input.sha256,
        "x-amz-checksum-sha256": objectChecksum,
        "x-amz-server-side-encryption": "aws:kms",
        "x-amz-server-side-encryption-aws-kms-key-id": storage.kmsKeyId,
      },
    };
  }),

  completeEvidence: writeProcedure.input(z.object({
    caseRef: z.string().regex(CASE_REF_PATTERN),
    evidenceRef: z.string().regex(/^BIS-DE-[A-Z0-9]{18}$/),
  })).mutation(async ({ ctx, input }) => {
    const tenantId = requireTenant(ctx.tenantId);
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      const rowResult = await client.query<{
        case_id: string; case_ref: string; object_key: string; object_version_id: string | null; kms_key_id: string;
        ciphertext_sha256: string; content_type: string; byte_size: string; custody_status: string; expires_at: string;
      }>(
        `SELECT c.id AS case_id, c.case_ref, e.object_key, e.object_version_id, e.kms_key_id, e.ciphertext_sha256,
                e.content_type, e.byte_size, e.custody_status, e.expires_at
           FROM consumer_dispute_evidence e
           JOIN consumer_dispute_cases c ON c.id = e.case_id
          WHERE e.evidence_ref = $1 AND c.case_ref = $2 AND c.requester_user_id = $3 AND c.tenant_id = $4`,
        [input.evidenceRef, input.caseRef, ctx.user.id, tenantId],
      );
      const row = rowResult.rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Consumer dispute evidence authorization not found." });
      if (row.custody_status === "verified") return { evidenceRef: input.evidenceRef, status: "verified" as const, objectVersionId: row.object_version_id };
      if (row.custody_status !== "initiated" || new Date(row.expires_at) <= new Date()) {
        throw new TRPCError({ code: "CONFLICT", message: "Consumer dispute evidence authorization is no longer active." });
      }
      const storage = evidenceStorage();
      let object;
      try {
        object = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: row.object_key, ChecksumMode: "ENABLED" }));
      } catch {
        await client.query("BEGIN");
        await client.query(`UPDATE consumer_dispute_evidence SET custody_status = 'quarantined' WHERE evidence_ref = $1 AND custody_status = 'initiated'`, [input.evidenceRef]);
        await appendConsumerDisputeEvent(client, { caseId: row.case_id, caseRef: row.case_ref, actorUserId: ctx.user.id, actorKind: "consumer", eventType: "evidence_quarantined", detail: { evidenceRef: input.evidenceRef, reason: "object_not_available_for_verification" } });
        await client.query("COMMIT");
        throw new TRPCError({ code: "BAD_REQUEST", message: "Evidence object could not be verified." });
      }
      const observedSha = object.Metadata?.sha256 ?? "";
      const observedId = object.Metadata?.["dispute-evidence-id"] ?? "";
      const metadataDigestValid = observedSha === row.ciphertext_sha256;
      const objectChecksumValid = s3ChecksumMatchesSha256Hex(row.ciphertext_sha256, object.ChecksumSHA256);
      const valid = metadataDigestValid
        && objectChecksumValid
        && observedId === input.evidenceRef
        && object.ContentType === row.content_type
        && Number(object.ContentLength) === Number(row.byte_size)
        && object.ServerSideEncryption === "aws:kms"
        && object.SSEKMSKeyId === row.kms_key_id;
      await client.query("BEGIN");
      if (!valid) {
        const quarantined = await client.query<{ custody_status: string }>(
          `UPDATE consumer_dispute_evidence SET custody_status = 'quarantined'
            WHERE evidence_ref = $1 AND custody_status = 'initiated'
            RETURNING custody_status`,
          [input.evidenceRef],
        );
        if (quarantined.rows[0]) {
          await appendConsumerDisputeEvent(client, { caseId: row.case_id, caseRef: row.case_ref, actorUserId: ctx.user.id, actorKind: "consumer", eventType: "evidence_quarantined", detail: { evidenceRef: input.evidenceRef, reason: "object_integrity_or_encryption_validation_failed" } });
        }
        await client.query("COMMIT");
        if (!quarantined.rows[0]) {
          throw new TRPCError({ code: "CONFLICT", message: "Evidence custody was finalized by another request." });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: "Evidence object integrity or encryption verification failed." });
      }
      const verified = await client.query<{ object_version_id: string | null }>(
        `UPDATE consumer_dispute_evidence
            SET custody_status = 'verified', object_version_id = $2, verified_at = NOW()
          WHERE evidence_ref = $1 AND custody_status = 'initiated'
          RETURNING object_version_id`,
        [input.evidenceRef, object.VersionId ?? null],
      );
      if (verified.rows[0]) {
        await appendConsumerDisputeEvent(client, { caseId: row.case_id, caseRef: row.case_ref, actorUserId: ctx.user.id, actorKind: "consumer", eventType: "evidence_verified", detail: { evidenceRef: input.evidenceRef, objectVersionId: verified.rows[0].object_version_id, kmsKeyId: row.kms_key_id } });
      }
      await client.query("COMMIT");
      if (!verified.rows[0]) {
        throw new TRPCError({ code: "CONFLICT", message: "Evidence custody was finalized by another request." });
      }
      return { evidenceRef: input.evidenceRef, status: "verified" as const, objectVersionId: verified.rows[0].object_version_id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }),

  queue: caseworkerWriteProcedure.input(z.object({
    status: z.enum(["received", "accepted", "source_pending", "investigating", "awaiting_consumer", "frivolous", "escalated"]).optional(),
    overdueOnly: z.boolean().default(false),
  })).query(async ({ ctx, input }) => {
    const pool = await poolOrThrow();
    const result = await pool.query<CaseRow>(
      `SELECT id, case_ref, tenant_id, requester_user_id, subject_binding_id, framework, jurisdiction_code, case_type,
              status, received_at, reinvestigation_due_at, extension_due_at, result_notice_due_at, completed_at
         FROM consumer_dispute_cases
        WHERE ($1::integer IS NULL OR tenant_id = $1)
          AND ($2::text IS NULL OR status = $2)
          AND ($3::boolean = FALSE OR COALESCE(extension_due_at, reinvestigation_due_at) < NOW())
          AND status NOT IN ('resolved', 'withdrawn')
        ORDER BY COALESCE(extension_due_at, reinvestigation_due_at, received_at) ASC
        LIMIT 200`,
      [ctx.user?.role === "admin" ? null : requireTenant(ctx.tenantId), input.status ?? null, input.overdueOnly],
    );
    return result.rows;
  }),

  assign: supervisorWriteProcedure.input(z.object({
    caseRef: z.string().regex(CASE_REF_PATTERN),
    assigneeUserId: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => {
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const caseRow = await assertInternalCase(client, input.caseRef, ctx.user?.role === "admin" ? null : requireTenant(ctx.tenantId));
      if (["resolved", "withdrawn"].includes(caseRow.status)) throw new TRPCError({ code: "CONFLICT", message: "A terminal case cannot be assigned." });
      await client.query(`UPDATE consumer_dispute_cases SET assigned_to_user_id = $1, status = CASE WHEN status = 'received' THEN 'accepted' ELSE status END,
                          accepted_at = COALESCE(accepted_at, NOW()), updated_at = NOW() WHERE id = $2`, [input.assigneeUserId, caseRow.id]);
      await appendConsumerDisputeEvent(client, { caseId: caseRow.id, caseRef: caseRow.case_ref, actorUserId: ctx.user!.id, actorKind: "supervisor", eventType: "assigned", detail: { assigneeUserId: input.assigneeUserId } });
      await client.query("COMMIT");
      return { caseRef: caseRow.case_ref, assignedToUserId: input.assigneeUserId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),

  createSourceTask: caseworkerWriteProcedure.input(z.object({
    caseRef: z.string().regex(CASE_REF_PATTERN),
    disputeItemRef: z.string().regex(ITEM_REF_PATTERN),
    providerAuthorizationRef: z.string().trim().min(8).max(96),
    dataSourceId: z.number().int().positive(),
    sourceRecordRef: z.string().trim().min(1).max(160).optional(),
    responseDueAt: z.string().datetime().optional(),
  })).mutation(async ({ ctx, input }) => {
    const environment = process.env.BIS_DEPLOYMENT_ENV ?? (ENV.isProduction ? "production" : "staging");
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const caseRow = await assertInternalCase(client, input.caseRef, ctx.user?.role === "admin" ? null : requireTenant(ctx.tenantId));
      if (["resolved", "withdrawn", "frivolous"].includes(caseRow.status)) throw new TRPCError({ code: "CONFLICT", message: "Source tasks cannot be created for this case state." });
      const item = await client.query<{ id: string }>(`SELECT id FROM consumer_dispute_items WHERE item_ref = $1 AND case_id = $2 FOR UPDATE`, [input.disputeItemRef, caseRow.id]);
      if (!item.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute item not found in this case." });
      const authorization = await client.query<{ id: string }>(
        `SELECT id FROM data_provider_authorizations
          WHERE authorization_ref = $1 AND data_source_id = $2 AND status = 'active' AND environment = $3
            AND effective_at <= NOW() AND expires_at > NOW()
            AND approved_jurisdictions ? $4 AND approved_use_cases ? 'reinvestigation'
            AND (tenant_id IS NULL OR tenant_id = $5)
          FOR UPDATE`,
        [input.providerAuthorizationRef, input.dataSourceId, environment, caseRow.jurisdiction_code, caseRow.tenant_id],
      );
      if (!authorization.rows[0]) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Provider authorization is missing, inactive, expired, or out of scope; no source request was sent." });
      }
      const evidence = await client.query<{ evidence_ref: string; ciphertext_sha256: string; object_version_id: string | null }>(
        `SELECT evidence_ref, ciphertext_sha256, object_version_id FROM consumer_dispute_evidence
          WHERE case_id = $1 AND custody_status = 'verified' ORDER BY created_at ASC`, [caseRow.id],
      );
      const manifest = JSON.stringify(evidence.rows.map((row) => ({ evidenceRef: row.evidence_ref, ciphertextSha256: row.ciphertext_sha256, objectVersionId: row.object_version_id })));
      const taskRef = makeRef("BIS-DST");
      const idempotencyKey = createHash("sha256").update(`${caseRow.case_ref}|${input.disputeItemRef}|${input.providerAuthorizationRef}|${manifest}`).digest("hex");
      const task = await client.query<{ id: string; task_ref: string }>(
        `INSERT INTO consumer_dispute_source_tasks
           (task_ref, case_id, dispute_item_id, provider_authorization_id, data_source_id, source_record_ref, idempotency_key,
            status, all_relevant_evidence_manifest_sha256, response_due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
         ON CONFLICT (provider_authorization_id, idempotency_key) DO UPDATE SET updated_at = consumer_dispute_source_tasks.updated_at
         RETURNING id, task_ref`,
        [taskRef, caseRow.id, item.rows[0].id, authorization.rows[0].id, input.dataSourceId, input.sourceRecordRef ?? null,
          idempotencyKey, createHash("sha256").update(manifest).digest("hex"), input.responseDueAt ?? caseRow.reinvestigation_due_at],
      );
      const sourceTask = task.rows[0];
      if (!sourceTask) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to persist the source task." });
      const keyring = loadConsumerDisputeOutboxKeyring();
      const eventType = "provider_reinvestigation_request";
      const outboxId = randomUUID();
      const outboxPayload = { caseRef: caseRow.case_ref, sourceTaskRef: taskRef, providerAuthorizationRef: input.providerAuthorizationRef, dataSourceId: input.dataSourceId };
      const outboxPlaintext = JSON.stringify(outboxPayload);
      const encryptedOutboxPayload = encryptConsumerDisputeOutboxPayload(keyring, consumerDisputeOutboxAad(eventType, idempotencyKey), outboxPayload);
      await client.query(
        `INSERT INTO consumer_dispute_provider_outbox
           (id, case_id, source_task_id, event_type, payload_ciphertext, payload_nonce, payload_key_version, payload_algorithm,
            payload_sha256, idempotency_key, state, available_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW())
         ON CONFLICT (event_type, idempotency_key) DO NOTHING`,
        [outboxId, caseRow.id, sourceTask.id, eventType, encryptedOutboxPayload.ciphertext, encryptedOutboxPayload.nonce,
          encryptedOutboxPayload.keyVersion, encryptedOutboxPayload.algorithm, createHash("sha256").update(outboxPlaintext).digest("hex"), idempotencyKey],
      );
      await client.query(`UPDATE consumer_dispute_cases SET status = 'source_pending', updated_at = NOW() WHERE id = $1`, [caseRow.id]);
      await appendConsumerDisputeEvent(client, { caseId: caseRow.id, caseRef: caseRow.case_ref, actorUserId: ctx.user!.id, actorKind: "caseworker", eventType: "source_task_created", detail: { taskRef, disputeItemRef: input.disputeItemRef, providerAuthorizationRef: input.providerAuthorizationRef, evidenceCount: evidence.rows.length } });
      await appendConsumerDisputeEvent(client, { caseId: caseRow.id, caseRef: caseRow.case_ref, actorUserId: ctx.user!.id, actorKind: "caseworker", eventType: "provider_outbox_enqueued", detail: { outboxId, taskRef, providerAuthorizationRef: input.providerAuthorizationRef } });
      await client.query("COMMIT");
      return { taskRef: sourceTask.task_ref, status: "pending" as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),

  recordSourceResponse: caseworkerWriteProcedure.input(z.object({
    caseRef: z.string().regex(CASE_REF_PATTERN),
    taskRef: z.string().regex(TASK_REF_PATTERN),
    disposition: sourceResponseSchema,
    responseManifest: z.record(z.string(), z.unknown()).default({}),
  })).mutation(async ({ ctx, input }) => {
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const caseRow = await assertInternalCase(client, input.caseRef, ctx.user?.role === "admin" ? null : requireTenant(ctx.tenantId));
      const task = await client.query<{ id: string; status: string }>(`SELECT id, status FROM consumer_dispute_source_tasks WHERE task_ref = $1 AND case_id = $2 FOR UPDATE`, [input.taskRef, caseRow.id]);
      if (!task.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Source task not found in this case." });
      if (["responded", "cancelled"].includes(task.rows[0].status)) throw new TRPCError({ code: "CONFLICT", message: "Source task is already terminal." });
      await client.query(`UPDATE consumer_dispute_source_tasks SET status = 'responded', response_received_at = NOW(), response_disposition = $1,
                           response_manifest = $2::jsonb, updated_at = NOW() WHERE id = $3`, [input.disposition, JSON.stringify(input.responseManifest), task.rows[0].id]);
      await client.query(`UPDATE consumer_dispute_cases SET status = 'investigating', updated_at = NOW() WHERE id = $1`, [caseRow.id]);
      await appendConsumerDisputeEvent(client, { caseId: caseRow.id, caseRef: caseRow.case_ref, actorUserId: ctx.user!.id, actorKind: "caseworker", eventType: "source_response_recorded", detail: { taskRef: input.taskRef, disposition: input.disposition } });
      await client.query("COMMIT");
      return { taskRef: input.taskRef, status: "responded" as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),

  dispositionItem: caseworkerWriteProcedure.input(z.object({
    caseRef: z.string().regex(CASE_REF_PATTERN),
    itemRef: z.string().regex(ITEM_REF_PATTERN),
    disposition: dispositionSchema,
    rationale: z.string().trim().min(10).max(4_000),
  })).mutation(async ({ ctx, input }) => {
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const caseRow = await assertInternalCase(client, input.caseRef, ctx.user?.role === "admin" ? null : requireTenant(ctx.tenantId));
      if (["resolved", "withdrawn", "frivolous"].includes(caseRow.status)) throw new TRPCError({ code: "CONFLICT", message: "Items cannot be dispositioned in this case state." });
      const item = await client.query<{ id: string; disposition: string }>(`SELECT id, disposition FROM consumer_dispute_items WHERE item_ref = $1 AND case_id = $2 FOR UPDATE`, [input.itemRef, caseRow.id]);
      if (!item.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute item not found in this case." });
      if (item.rows[0].disposition !== "pending") throw new TRPCError({ code: "CONFLICT", message: "Dispute item has already been dispositioned." });
      await client.query(`UPDATE consumer_dispute_items SET disposition = $1, disposition_rationale = $2, resolved_at = NOW() WHERE id = $3`, [input.disposition, input.rationale, item.rows[0].id]);
      const eventType: ConsumerDisputeEventName = input.disposition === "corrected" ? "item_corrected" : input.disposition === "deleted" ? "item_deleted" : input.disposition === "verified" ? "item_verified" : "item_unverifiable";
      await appendConsumerDisputeEvent(client, { caseId: caseRow.id, caseRef: caseRow.case_ref, actorUserId: ctx.user!.id, actorKind: "caseworker", eventType, detail: { itemRef: input.itemRef, disposition: input.disposition } });
      await client.query("COMMIT");
      return { itemRef: input.itemRef, disposition: input.disposition };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),

  complete: supervisorWriteProcedure.input(z.object({ caseRef: z.string().regex(CASE_REF_PATTERN) })).mutation(async ({ ctx, input }) => {
    const pool = await poolOrThrow();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const caseRow = await assertInternalCase(client, input.caseRef, ctx.user?.role === "admin" ? null : requireTenant(ctx.tenantId));
      if (["resolved", "withdrawn"].includes(caseRow.status)) throw new TRPCError({ code: "CONFLICT", message: "This consumer dispute is already terminal." });
      const [unresolved, activeTasks] = await Promise.all([
        client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM consumer_dispute_items WHERE case_id = $1 AND disposition = 'pending'`, [caseRow.id]),
        client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM consumer_dispute_source_tasks WHERE case_id = $1 AND status IN ('pending', 'dispatched', 'acknowledged')`, [caseRow.id]),
      ]);
      if (Number(unresolved.rows[0]?.count ?? "0") > 0 || Number(activeTasks.rows[0]?.count ?? "0") > 0) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Every disputed item and source task must be resolved before case completion." });
      }
      await client.query(`UPDATE consumer_dispute_cases SET status = 'resolved', completed_at = NOW(), updated_at = NOW() WHERE id = $1`, [caseRow.id]);
      const resultNoticeRef = await queueNotice(client, {
        caseId: caseRow.id, caseRef: caseRow.case_ref, noticeType: "result", recipientKind: "consumer", templateVersion: "consumer-dispute-result-v1",
        actorUserId: ctx.user!.id, actorKind: "supervisor", payload: { framework: caseRow.framework },
      });
      await appendConsumerDisputeEvent(client, { caseId: caseRow.id, caseRef: caseRow.case_ref, actorUserId: ctx.user!.id, actorKind: "supervisor", eventType: "completed" });
      await client.query("COMMIT");
      return { caseRef: caseRow.case_ref, status: "resolved" as const, resultNoticeRef };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),

  providerAuthorizations: router({
    list: adminProcedure.input(z.object({ environment: z.enum(["sandbox", "staging", "production"]).optional() })).query(async ({ input }) => {
      const pool = await poolOrThrow();
      const result = await pool.query(
        `SELECT authorization_ref, data_source_id, provider_code, environment, status, contract_reference, contract_version,
                approved_use_cases, approved_jurisdictions, approved_data_fields, certification_reference, effective_at, expires_at, suspended_at
           FROM data_provider_authorizations
          WHERE ($1::text IS NULL OR environment = $1)
          ORDER BY provider_code ASC, environment ASC`,
        [input.environment ?? null],
      );
      return result.rows;
    }),

    suspend: adminProcedure.input(z.object({
      authorizationRef: z.string().trim().min(8).max(96),
      reason: z.string().trim().min(10).max(1_000),
    })).mutation(async ({ ctx, input }) => {
      const pool = await poolOrThrow();
      const result = await pool.query<{ authorization_ref: string }>(
        `UPDATE data_provider_authorizations
            SET status = 'suspended', suspended_at = NOW(), suspension_reason = $1, updated_at = NOW()
          WHERE authorization_ref = $2 AND status = 'active'
          RETURNING authorization_ref`,
        [input.reason, input.authorizationRef],
      );
      if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No active provider authorization was found." });
      return { authorizationRef: result.rows[0].authorization_ref, suspendedByUserId: ctx.user.id, status: "suspended" as const };
    }),
  }),
});
