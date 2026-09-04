import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router, writeProcedure } from "./_core/trpc";
import { getPgPool } from "./db";
import { encryptInstitutionalPayload, institutionalOutboxAad, loadInstitutionalOutboxKeyring } from "./institutionalOutboxCrypto";

const sourceCodes = ["npf", "efcc", "icpc", "dss", "ndlea", "nscdc", "frsc", "custom_state"] as const;
const institutionTypes = ["employer", "government", "law_enforcement", "verification_firm"] as const;
const purposeCodes = ["employment_screening", "government_clearance", "law_enforcement_case", "regulated_due_diligence"] as const;

function requireTenant(ctx: { tenantId: number | null; user: { id: number; role?: string } | null }): { tenantId: number; userId: number } {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated institutional operator is required" });
  if (!ctx.tenantId || ctx.tenantId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "Restricted-data access requires an explicit institution tenant" });
  return { tenantId: ctx.tenantId, userId: ctx.user.id };
}

function requireInstitutionAdministrator(ctx: { tenantId: number | null; user: { id: number; role?: string } | null }) {
  const actor = requireTenant(ctx);
  if (ctx.user?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Only a designated institution administrator may administer restricted-data authority" });
  return actor;
}

async function poolOrFail() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Institutional authorization storage is unavailable" });
  return pool;
}

const authorityInput = z.object({
  institutionType: z.enum(institutionTypes),
  authorityReference: z.string().min(8).max(160),
  lawfulBasis: z.string().min(8).max(64),
  permittedPurposes: z.array(z.enum(purposeCodes)).min(1).max(4),
  permittedSources: z.array(z.enum(sourceCodes)).min(1).max(sourceCodes.length),
  jurisdiction: z.string().min(2).max(96),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  evidenceRef: z.string().min(8).max(128),
});

export const institutionalAccessRouter = router({
  submitAuthorization: writeProcedure.input(authorityInput).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireInstitutionAdministrator(ctx);
    if (input.validUntil <= input.validFrom || input.validUntil <= new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Institution authority must have a valid future end date" });
    const pool = await poolOrFail();
    const id = randomUUID();
    await pool.query(
      `INSERT INTO institution_authorizations
        (id, tenant_id, institution_type, authority_reference, lawful_basis, permitted_purposes, permitted_sources, jurisdiction, valid_from, valid_until, status, evidence_ref, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8, $9, $10, 'pending', $11, $12)`,
      [id, tenantId, input.institutionType, input.authorityReference, input.lawfulBasis, input.permittedPurposes, input.permittedSources, input.jurisdiction, input.validFrom, input.validUntil, input.evidenceRef, userId],
    );
    return { authorizationId: id, status: "pending" as const };
  }),

  approveAuthorization: adminProcedure.input(z.object({ authorizationId: z.string().uuid(), rationale: z.string().min(10).max(2048) })).mutation(async ({ input, ctx }) => {
    const { userId } = requireInstitutionAdministrator(ctx);
    const pool = await poolOrFail();
    const result = await pool.query(
      `UPDATE institution_authorizations
       SET status = 'active', approved_by = $2, approved_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $3 AND status = 'pending' AND created_by <> $2 AND valid_until > now()
       RETURNING id, valid_until`, [input.authorizationId, userId, ctx.tenantId],
    );
    if (result.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Authority is unavailable, expired, or cannot be approved by its submitter" });
    return { authorizationId: input.authorizationId, status: "active" as const, validUntil: result.rows[0].valid_until.toISOString() };
  }),

  revokeAuthorization: adminProcedure.input(z.object({ authorizationId: z.string().uuid(), rationale: z.string().min(10).max(2048) })).mutation(async ({ input, ctx }) => {
    const { userId } = requireInstitutionAdministrator(ctx);
    const pool = await poolOrFail();
    const result = await pool.query(
      `UPDATE institution_authorizations SET status = 'revoked', revoked_by = $2, revoked_at = now(), revocation_reason = $3, updated_at = now()
       WHERE id = $1 AND tenant_id = $4 AND status IN ('pending', 'active', 'suspended') RETURNING id`,
      [input.authorizationId, userId, input.rationale.trim(), ctx.tenantId],
    );
    if (result.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Authority cannot be revoked in its current state" });
    await pool.query(
      `UPDATE institutional_request_outbox o SET status = 'cancelled'
       FROM criminal_request_authorizations r
       WHERE o.request_authorization_id = r.id AND r.institution_authorization_id = $1 AND o.status IN ('pending', 'leased')`, [input.authorizationId],
    );
    return { authorizationId: input.authorizationId, status: "revoked" as const };
  }),

  createRestrictedRequest: writeProcedure.input(z.object({
    requestRef: z.string().min(4).max(32),
    institutionAuthorizationId: z.string().uuid(),
    legalCaseReference: z.string().min(8).max(160),
    purposeCode: z.enum(purposeCodes),
    source: z.enum(sourceCodes),
    expiresAt: z.coerce.date(),
  })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx);
    if (input.expiresAt <= new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Restricted request approval must expire in the future" });
    const pool = await poolOrFail();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const authority = await client.query<{ id: string }>(
        `SELECT id FROM institution_authorizations
         WHERE id = $1 AND tenant_id = $2 AND status = 'active' AND valid_from <= now() AND valid_until > now()
           AND $3 = ANY(permitted_purposes) AND $4 = ANY(permitted_sources)
         FOR SHARE`, [input.institutionAuthorizationId, tenantId, input.purposeCode, input.source],
      );
      if (authority.rowCount !== 1) throw new TRPCError({ code: "FORBIDDEN", message: "No active institutional authority permits this purpose and source" });
      const request = await client.query<{ requestRef: string }>(
        `SELECT "requestRef" FROM criminal_record_requests WHERE "requestRef" = $1 AND "tenantId" = $2 FOR SHARE`, [input.requestRef, tenantId],
      );
      if (request.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Restricted criminal-record request was not found in this tenant" });
      const id = randomUUID();
      await client.query(
        `INSERT INTO criminal_request_authorizations
          (id, request_ref, tenant_id, institution_authorization_id, legal_case_reference, purpose_code, approval_status, requested_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
        [id, input.requestRef, tenantId, input.institutionAuthorizationId, input.legalCaseReference, input.purposeCode, userId, input.expiresAt],
      );
      await client.query("COMMIT");
      return { requestAuthorizationId: id, status: "pending" as const };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }),

  approveRestrictedRequest: adminProcedure.input(z.object({ requestAuthorizationId: z.string().uuid(), approvalNote: z.string().min(10).max(2048) })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireInstitutionAdministrator(ctx);
    const pool = await poolOrFail();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const approved = await client.query<{ id: string; request_ref: string; institution_authorization_id: string }>(
        `UPDATE criminal_request_authorizations
         SET approval_status = 'approved', approved_by = $2, approval_note = $3, approved_at = now(), updated_at = now()
         WHERE id = $1 AND tenant_id = $4 AND approval_status = 'pending' AND requested_by <> $2 AND expires_at > now()
         RETURNING id, request_ref, institution_authorization_id`, [input.requestAuthorizationId, userId, input.approvalNote.trim(), tenantId],
      );
      if (approved.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Restricted request is unavailable, expired, or cannot be approved by its submitter" });
      const idempotencyKey = randomUUID();
      const keyring = loadInstitutionalOutboxKeyring();
      const aad = institutionalOutboxAad("restricted_criminal_request_dispatch", idempotencyKey);
      const encrypted = encryptInstitutionalPayload(keyring, aad, {
        requestAuthorizationId: approved.rows[0].id,
        requestRef: approved.rows[0].request_ref,
        tenantId,
        approvedAt: new Date().toISOString(),
      });
      await client.query(
        `INSERT INTO institutional_request_outbox
          (id, tenant_id, request_authorization_id, provider_authorization_id, event_type, payload_ciphertext, payload_nonce, payload_key_version, idempotency_key, status)
         VALUES ($1, $2, $3, $4, 'restricted_criminal_request_dispatch', $5, $6, $7, $8, 'pending')`,
        [randomUUID(), tenantId, approved.rows[0].id, approved.rows[0].institution_authorization_id, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, idempotencyKey],
      );
      await client.query("COMMIT");
      return { requestAuthorizationId: input.requestAuthorizationId, status: "approved" as const, dispatchStatus: "pending" as const };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }),

  listAuthorizations: protectedProcedure.query(async ({ ctx }) => {
    const { tenantId } = requireTenant(ctx);
    const pool = await poolOrFail();
    const { rows } = await pool.query(
      `SELECT id, institution_type, authority_reference, lawful_basis, permitted_purposes, permitted_sources, jurisdiction, valid_from, valid_until, status, approved_at
       FROM institution_authorizations WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId],
    );
    return rows;
  }),
});
