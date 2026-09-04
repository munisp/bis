import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPgPool } from "./db";
import { adminProcedure, protectedProcedure, writeProcedure, router } from "./_core/trpc";

export const consumerPurposeSchema = z.enum([
  "self",
  "personal_safety",
  "fraud_prevention",
  "account_security",
  "compliance_investigation",
  "legal_authority",
]);
export type ConsumerPurpose = z.infer<typeof consumerPurposeSchema>;

async function poolOrThrow() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "PostgreSQL is unavailable" });
  return pool;
}

export async function assertActiveConsumerConsent(input: {
  userId: number;
  purpose: ConsumerPurpose;
  mode: "consumer" | "institutional";
}) {
  const pool = await poolOrThrow();
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM consumer_consent_records
     WHERE user_id = $1 AND purpose = $2 AND revoked_at IS NULL
       AND (legal_basis = 'consent' OR $3 = 'institutional')
     ORDER BY granted_at DESC LIMIT 1`,
    [input.userId, input.purpose, input.mode],
  );
  if (!result.rows[0]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "An active purpose-specific consent or authorized institutional basis is required before consumer discovery.",
    });
  }
}

const rightsRequestSchema = z.object({
  requestType: z.enum(["access", "correction", "deletion", "suppression", "objection"]),
  subjectProfileRef: z.string().regex(/^BIS-NG-DEMO-[0-9]{4}$/).optional(),
  requestScope: z.object({
    fieldNames: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
    statement: z.string().trim().min(10).max(2_000),
  }),
});

export const consumerGovernanceRouter = router({
  consent: router({
    grant: writeProcedure.input(z.object({
      purpose: consumerPurposeSchema,
      legalBasis: z.enum(["consent", "legal_obligation", "legitimate_interest", "legal_authority"]),
      policyVersion: z.string().trim().regex(/^NG-CONSUMER-[0-9]{4}-[0-9]{2}$/),
      scopes: z.array(z.enum(["consumer_discovery", "profile_detail", "provenance", "relationship_linkage"])).min(1).max(4),
    })).mutation(async ({ ctx, input }) => {
      const consumerPurpose = ["self", "personal_safety", "fraud_prevention"].includes(input.purpose);
      if (consumerPurpose && input.legalBasis !== "consent") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Consumer discovery purposes require consent as their stated basis." });
      }
      const pool = await poolOrThrow();
      const result = await pool.query<{ id: string; granted_at: string }>(
        `INSERT INTO consumer_consent_records
         (user_id, tenant_id, purpose, legal_basis, policy_version, scopes)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, granted_at`,
        [ctx.user.id, ctx.tenantId, input.purpose, input.legalBasis, input.policyVersion, JSON.stringify(input.scopes)],
      );
      return { consentId: result.rows[0]!.id, grantedAt: result.rows[0]!.granted_at };
    }),

    revoke: writeProcedure.input(z.object({ consentId: z.string().regex(/^\d+$/) })).mutation(async ({ ctx, input }) => {
      const pool = await poolOrThrow();
      const result = await pool.query<{ id: string }>(
        `UPDATE consumer_consent_records SET revoked_at = NOW()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
         RETURNING id`,
        [input.consentId, ctx.user.id],
      );
      if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No active consent record was found." });
      return { revoked: true };
    }),

    active: protectedProcedure.query(async ({ ctx }) => {
      const pool = await poolOrThrow();
      const result = await pool.query<{
        id: string; purpose: ConsumerPurpose; legal_basis: string; policy_version: string; scopes: unknown; granted_at: string;
      }>(
        `SELECT id, purpose, legal_basis, policy_version, scopes, granted_at
         FROM consumer_consent_records
         WHERE user_id = $1 AND revoked_at IS NULL
         ORDER BY granted_at DESC`,
        [ctx.user.id],
      );
      return result.rows.map(row => ({
        consentId: row.id, purpose: row.purpose, legalBasis: row.legal_basis,
        policyVersion: row.policy_version, scopes: row.scopes, grantedAt: row.granted_at,
      }));
    }),
  }),

  rights: router({
    submit: writeProcedure.input(rightsRequestSchema).mutation(async ({ ctx, input }) => {
      const pool = await poolOrThrow();
      const requestRef = `NG-DSR-${randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase()}`;
      const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await pool.query("BEGIN");
      try {
        const request = await pool.query<{ id: string }>(
          `INSERT INTO consumer_rights_requests
           (request_ref, requester_user_id, tenant_id, request_type, subject_profile_ref, request_scope, status, due_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'identity_pending', $7)
           RETURNING id`,
          [requestRef, ctx.user.id, ctx.tenantId, input.requestType, input.subjectProfileRef ?? null, JSON.stringify(input.requestScope), dueAt],
        );
        await pool.query(
          `INSERT INTO consumer_rights_request_events (request_id, actor_user_id, event_type, detail)
           VALUES ($1, $2, 'submitted', $3::jsonb)`,
          [request.rows[0]!.id, ctx.user.id, JSON.stringify({ requestType: input.requestType, subjectProfileRef: input.subjectProfileRef ?? null })],
        );
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
      return { requestRef, status: "identity_pending" as const, dueAt: dueAt.toISOString() };
    }),

    mine: protectedProcedure.query(async ({ ctx }) => {
      const pool = await poolOrThrow();
      const result = await pool.query<{
        request_ref: string; request_type: string; subject_profile_ref: string | null; status: string; due_at: string; created_at: string; resolved_at: string | null;
      }>(
        `SELECT request_ref, request_type, subject_profile_ref, status, due_at, created_at, resolved_at
         FROM consumer_rights_requests WHERE requester_user_id = $1 ORDER BY created_at DESC`,
        [ctx.user.id],
      );
      return result.rows;
    }),

    queue: adminProcedure.input(z.object({ status: z.enum(["identity_pending", "received", "in_review", "fulfilled", "rejected", "withdrawn"]).optional() })).query(async ({ input }) => {
      const pool = await poolOrThrow();
      const result = await pool.query(
        `SELECT request_ref, request_type, subject_profile_ref, status, due_at, created_at, identity_verification_ref
         FROM consumer_rights_requests WHERE ($1::text IS NULL OR status = $1) ORDER BY due_at ASC LIMIT 200`,
        [input.status ?? null],
      );
      return result.rows;
    }),

    verifyIdentity: adminProcedure.input(z.object({
      requestRef: z.string().regex(/^NG-DSR-[A-Z0-9]{18}$/),
      verificationReference: z.string().trim().min(12).max(160),
    })).mutation(async ({ ctx, input }) => {
      const pool = await poolOrThrow();
      await pool.query("BEGIN");
      try {
        const request = await pool.query<{ id: string }>(
          `UPDATE consumer_rights_requests
           SET identity_verification_ref = $1, status = 'received', assigned_to_user_id = $2, updated_at = NOW()
           WHERE request_ref = $3 AND status = 'identity_pending'
           RETURNING id`,
          [input.verificationReference, ctx.user.id, input.requestRef],
        );
        if (!request.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "The request is not awaiting identity verification." });
        await pool.query(
          `INSERT INTO consumer_rights_request_events (request_id, actor_user_id, event_type, detail)
           VALUES ($1, $2, 'identity_verified', $3::jsonb)`,
          [request.rows[0].id, ctx.user.id, JSON.stringify({ verificationReference: input.verificationReference })],
        );
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
      return { verified: true };
    }),

    resolve: adminProcedure.input(z.object({
      requestRef: z.string().regex(/^NG-DSR-[A-Z0-9]{18}$/),
      outcome: z.enum(["fulfilled", "rejected", "withdrawn"]),
      resolutionCode: z.enum(["fulfilled", "identity_failed", "insufficient_scope", "legal_hold", "not_found", "withdrawn"]),
      resolutionDetail: z.string().trim().min(5).max(2_000),
    })).mutation(async ({ ctx, input }) => {
      const pool = await poolOrThrow();
      await pool.query("BEGIN");
      try {
        const request = await pool.query<{ id: string; request_type: string; subject_profile_ref: string | null }>(
          `SELECT id, request_type, subject_profile_ref FROM consumer_rights_requests
           WHERE request_ref = $1 FOR UPDATE`,
          [input.requestRef],
        );
        const row = request.rows[0];
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Rights request not found." });
        if (["fulfilled", "rejected", "withdrawn"].includes((await pool.query<{ status: string }>("SELECT status FROM consumer_rights_requests WHERE id = $1", [row.id])).rows[0]!.status)) {
          throw new TRPCError({ code: "CONFLICT", message: "Rights request is already terminal." });
        }
        if (input.outcome === "fulfilled" && input.resolutionCode !== "fulfilled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A fulfilled request requires the fulfilled resolution code." });
        }
        if (input.outcome === "withdrawn" && input.resolutionCode !== "withdrawn") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A withdrawn request requires the withdrawn resolution code." });
        }
        if (input.outcome === "fulfilled" && ["deletion", "suppression"].includes(row.request_type) && row.subject_profile_ref) {
          await pool.query(
            `UPDATE consumer_discovery_profiles SET record_status = 'suppressed', updated_at = NOW()
             WHERE profile_ref = $1 AND dataset_origin = 'synthetic_demo'`,
            [row.subject_profile_ref],
          );
        }
        await pool.query(
          `UPDATE consumer_rights_requests
           SET status = $1, resolution_code = $2, resolution_detail = $3, assigned_to_user_id = $4,
               resolved_at = NOW(), updated_at = NOW()
           WHERE id = $5`,
          [input.outcome, input.resolutionCode, input.resolutionDetail, ctx.user.id, row.id],
        );
        await pool.query(
          `INSERT INTO consumer_rights_request_events (request_id, actor_user_id, event_type, detail)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [row.id, ctx.user.id, input.outcome === "fulfilled" ? "fulfilled" : input.outcome === "withdrawn" ? "withdrawn" : "rejected", JSON.stringify({ resolutionCode: input.resolutionCode })],
        );
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
      return { status: input.outcome, requestRef: input.requestRef };
    }),
  }),
});
