import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, writeProcedure } from "./_core/trpc";
import { getPgPool } from "./db";

const purposeSchema = z.enum(["pre_employment", "tenancy", "vendor_due_diligence", "consumer_self_check"]);
const sourceSchema = z.enum(["self_nominated_referee", "trade_association", "cooperative", "guarantor", "landlord", "neighbour", "field_observation"]);
const contactSchema = z.enum(["otp", "callback", "in_person_verified", "association_officer"]);
const corroborationSchema = z.enum(["second_reference", "association_attestation", "field_evidence", "licensed_provider_record"]);

function requireTenant(ctx: { tenantId: number | null; user: { id: number; role?: string } | null }) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated operator is required" });
  if (!ctx.tenantId || ctx.tenantId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "An explicit tenant context is required" });
  return { tenantId: ctx.tenantId, userId: ctx.user.id, role: ctx.user.role };
}
async function poolOrFail() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Informal verification storage is unavailable" });
  return pool;
}
function digest(caseId: string, type: string, detail: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify({ caseId, type, detail })).digest("hex");
}
async function event(client: { query: Function }, caseId: string, tenantId: number, userId: number, eventType: string, referenceId: string | null, detail: Record<string, unknown>) {
  await client.query(
    `INSERT INTO informal_reference_events (id, case_id, reference_id, tenant_id, event_type, actor_user_id, event_sha256, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [randomUUID(), caseId, referenceId, tenantId, eventType, userId, digest(caseId, eventType, detail), JSON.stringify(detail)],
  );
}

export const informalVerificationRouter = router({
  openCase: writeProcedure.input(z.object({
    candidateId: z.number().int().positive(), consentRef: z.string().min(4).max(32), purpose: purposeSchema,
    investigationId: z.number().int().positive().optional(), expiresAt: z.coerce.date(),
  })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx);
    if (input.expiresAt <= new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "An informal-verification case must have a future expiry" });
    const pool = await poolOrFail();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const consent = await client.query(
        `SELECT c."consentRef" FROM candidate_consents c
         JOIN candidate_profiles p ON p.id = c."candidateId"
         WHERE c."consentRef" = $1 AND c."candidateId" = $2 AND p."tenantId" = $3
           AND c."revokedAt" IS NULL AND c."signedAt" IS NOT NULL
         FOR SHARE`, [input.consentRef, input.candidateId, tenantId],
      );
      if (consent.rowCount !== 1) throw new TRPCError({ code: "FORBIDDEN", message: "An active, signed candidate consent is required" });
      const id = randomUUID();
      await client.query(
        `INSERT INTO informal_verification_cases (id, tenant_id, candidate_id, investigation_id, consent_ref, purpose, status, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'collecting', $7, $8)`,
        [id, tenantId, input.candidateId, input.investigationId ?? null, input.consentRef, input.purpose, input.expiresAt, userId],
      );
      await event(client, id, tenantId, userId, "case_opened", null, { purpose: input.purpose, expiresAt: input.expiresAt.toISOString() });
      await client.query("COMMIT");
      return { caseId: id, status: "collecting" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  addReference: writeProcedure.input(z.object({
    caseId: z.string().uuid(), sourceType: sourceSchema, sourceDisplayName: z.string().min(2).max(256),
    relationshipToSubject: z.string().min(2).max(256), contactVerificationMethod: contactSchema,
    subjectConsentConfirmedAt: z.coerce.date(), expiresAt: z.coerce.date(),
    sourceClaim: z.object({ category: z.string().min(2).max(64), statement: z.string().min(10).max(2000), claimedPeriod: z.string().min(2).max(128).optional() }),
  })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx);
    if (input.subjectConsentConfirmedAt > new Date() || input.expiresAt <= new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Reference consent and expiry timestamps are invalid" });
    const pool = await poolOrFail(); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT id FROM informal_verification_cases WHERE id = $1 AND tenant_id = $2 AND status IN ('open', 'collecting') AND expires_at > now() FOR UPDATE`, [input.caseId, tenantId],
      );
      if (current.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Verification case is unavailable for reference collection" });
      const id = randomUUID();
      await client.query(
        `INSERT INTO informal_references
          (id, case_id, tenant_id, source_type, source_display_name, relationship_to_subject, relationship_disclosed, subject_consent_confirmed_at, contact_verification_method, source_claim, provenance_status, collected_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9::jsonb, 'claimed', $10, $11)`,
        [id, input.caseId, tenantId, input.sourceType, input.sourceDisplayName, input.relationshipToSubject, input.subjectConsentConfirmedAt, input.contactVerificationMethod, JSON.stringify(input.sourceClaim), userId, input.expiresAt],
      );
      await event(client, input.caseId, tenantId, userId, "reference_collected", id, { sourceType: input.sourceType, contactMethod: input.contactVerificationMethod, provenance: "claimed" });
      await client.query("COMMIT");
      return { referenceId: id, provenanceStatus: "claimed" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  recordCorroboration: writeProcedure.input(z.object({
    caseId: z.string().uuid(), referenceId: z.string().uuid(), corroborationType: corroborationSchema,
    evidenceReference: z.string().min(8).max(160), outcome: z.enum(["supports", "contradicts", "inconclusive"]), notes: z.string().min(10).max(2048),
  })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx);
    const pool = await poolOrFail(); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const reference = await client.query(
        `SELECT r.id FROM informal_references r JOIN informal_verification_cases c ON c.id = r.case_id
         WHERE r.id = $1 AND r.case_id = $2 AND r.tenant_id = $3 AND c.status IN ('collecting', 'under_review') AND r.withdrawn_at IS NULL FOR UPDATE`,
        [input.referenceId, input.caseId, tenantId],
      );
      if (reference.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Reference is unavailable in this tenant case" });
      await client.query(
        `INSERT INTO informal_reference_corroborations (id, reference_id, tenant_id, corroboration_type, evidence_reference, outcome, verified_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (reference_id, corroboration_type, evidence_reference) DO NOTHING`,
        [randomUUID(), input.referenceId, tenantId, input.corroborationType, input.evidenceReference, input.outcome, userId, input.notes.trim()],
      );
      const target = input.outcome === "supports" ? "independently_confirmed" : input.outcome === "contradicts" ? "contradicted" : "attested";
      await client.query(`UPDATE informal_references SET provenance_status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`, [target, input.referenceId, tenantId]);
      await event(client, input.caseId, tenantId, userId, input.outcome === "contradicts" ? "reference_contradicted" : "reference_verified", input.referenceId, { corroborationType: input.corroborationType, outcome: input.outcome });
      await client.query("COMMIT");
      return { referenceId: input.referenceId, provenanceStatus: target };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  submitCorrection: protectedProcedure.input(z.object({ caseId: z.string().uuid(), referenceId: z.string().uuid().optional(), statement: z.string().min(10).max(2048) })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx);
    const pool = await poolOrFail(); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`UPDATE informal_verification_cases SET status = 'disputed', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status IN ('collecting', 'under_review', 'completed') RETURNING id`, [input.caseId, tenantId]);
      if (result.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Informal verification case cannot accept a correction" });
      await event(client, input.caseId, tenantId, userId, "subject_correction_submitted", input.referenceId ?? null, { statementSha256: createHash("sha256").update(input.statement).digest("hex") });
      await client.query("COMMIT");
      return { caseId: input.caseId, status: "disputed" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  submitForReview: writeProcedure.input(z.object({ caseId: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx);
    const pool = await poolOrFail(); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const references = await client.query(`SELECT id FROM informal_references WHERE case_id = $1 AND tenant_id = $2 AND withdrawn_at IS NULL AND expires_at > now() FOR SHARE`, [input.caseId, tenantId]);
      if (references.rowCount === 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "At least one current, consented reference is required before review" });
      const result = await client.query(`UPDATE informal_verification_cases SET status = 'under_review', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'collecting' RETURNING id`, [input.caseId, tenantId]);
      if (result.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Case cannot be moved to review in its current state" });
      await event(client, input.caseId, tenantId, userId, "reference_verified", null, { transition: "under_review" });
      await client.query("COMMIT");
      return { caseId: input.caseId, status: "under_review" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  completeCase: writeProcedure.input(z.object({ caseId: z.string().uuid(), rationale: z.string().min(10).max(2048) })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId, role } = requireTenant(ctx);
    if (role !== "admin" && role !== "supervisor") throw new TRPCError({ code: "FORBIDDEN", message: "A designated reviewer is required to complete informal verification" });
    const pool = await poolOrFail(); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const references = await client.query<{ provenance_status: string }>(`SELECT provenance_status FROM informal_references WHERE case_id = $1 AND tenant_id = $2 AND withdrawn_at IS NULL AND expires_at > now() FOR SHARE`, [input.caseId, tenantId]);
      if (!references.rows.some((row) => row.provenance_status === "independently_confirmed" || row.provenance_status === "contradicted")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "At least one independently confirmed or contradicted reference is required; uncorroborated claims cannot complete a case" });
      const result = await client.query(`UPDATE informal_verification_cases SET status = 'completed', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'under_review' RETURNING id`, [input.caseId, tenantId]);
      if (result.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Case must be under review before completion" });
      await event(client, input.caseId, tenantId, userId, "case_completed", null, { rationaleSha256: createHash("sha256").update(input.rationale.trim()).digest("hex"), result: "provenance_labelled" });
      await client.query("COMMIT");
      return { caseId: input.caseId, status: "completed" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),
});
