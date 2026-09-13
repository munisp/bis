import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import { getPgPool } from "./db";

const reconciliationInput = z.object({ billingEventId: z.string().uuid(), rationale: z.string().trim().min(20).max(2000), ledgerEvidenceRef: z.string().trim().min(8).max(256).optional(), ledgerEvidenceSha256: z.string().regex(/^[0-9a-f]{64}$/).optional() });

async function poolOrFail() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Billing reconciliation storage is unavailable" });
  return pool;
}

export const intelligenceBillingReconciliationRouter = router({
  listOpen: adminProcedure.input(z.object({ tenantId: z.number().int().positive().optional() }).optional()).query(async ({ input, ctx }) => {
    const pool = await poolOrFail();
    const tenantId = input?.tenantId ?? ctx.tenantId;
    if (!tenantId || (ctx.tenantId !== null && ctx.tenantId !== tenantId)) throw new TRPCError({ code: "FORBIDDEN", message: "Cross-tenant billing reconciliation access is denied" });
    const { rows } = await pool.query(
      `SELECT r.id, r.billing_event_id, r.deterministic_transfer_id, r.status, r.last_error_code, r.requested_at,
              e.assessment_id, e.amount_kobo, e.attempt_count
       FROM intelligence_assessment_billing_reconciliations r
       JOIN intelligence_assessment_billing_events e ON e.id = r.billing_event_id
       WHERE r.tenant_id = $1 AND r.status IN ('open','under_review')
       ORDER BY r.requested_at ASC`, [tenantId],
    );
    return rows;
  }),

  claim: adminProcedure.input(z.object({ billingEventId: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    const pool = await poolOrFail();
    const { rows } = await pool.query(
      `UPDATE intelligence_assessment_billing_reconciliations r
       SET status = 'under_review', reviewed_by = $2, reviewed_at = now(), updated_at = now()
       FROM intelligence_assessment_billing_events e
       WHERE r.billing_event_id = $1 AND e.id = r.billing_event_id AND r.tenant_id = e.tenant_id
         AND r.status = 'open' AND r.requested_by <> $2 AND (r.tenant_id = $3 OR $3 IS NULL)
       RETURNING r.id, r.status`, [input.billingEventId, ctx.user!.id, ctx.tenantId],
    );
    if (rows.length !== 1) throw new TRPCError({ code: "CONFLICT", message: "Reconciliation is unavailable, cross-tenant, or cannot be claimed by its requester" });
    return { reconciliationId: rows[0].id, status: rows[0].status };
  }),

  confirmSettled: adminProcedure.input(reconciliationInput).mutation(async ({ input, ctx }) => {
    if (!input.ledgerEvidenceRef || !input.ledgerEvidenceSha256) throw new TRPCError({ code: "BAD_REQUEST", message: "Independent ledger evidence reference and SHA-256 are required to confirm settlement" });
    const pool = await poolOrFail();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const update = await client.query(
        `UPDATE intelligence_assessment_billing_reconciliations r
         SET status = 'confirmed_settled', reviewed_by = $2, reviewed_at = now(), closed_at = now(),
             resolution_rationale = $3, ledger_evidence_ref = $4, ledger_evidence_sha256 = $5, updated_at = now()
         FROM intelligence_assessment_billing_events e
         WHERE r.billing_event_id = $1 AND e.id = r.billing_event_id
           AND r.status IN ('open','under_review') AND r.requested_by <> $2
           AND (r.tenant_id = $6 OR $6 IS NULL)
         RETURNING r.tenant_id`, [input.billingEventId, ctx.user!.id, input.rationale, input.ledgerEvidenceRef, input.ledgerEvidenceSha256, ctx.tenantId],
      );
      if (update.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Reconciliation cannot be confirmed by its requester or is not open" });
      await client.query("UPDATE intelligence_assessment_billing_events SET status = 'settled', settled_at = COALESCE(settled_at, now()), last_error_code = NULL, updated_at = now() WHERE id = $1 AND status = 'awaiting_reconciliation'", [input.billingEventId]);
      await client.query("COMMIT");
      return { billingEventId: input.billingEventId, status: "settled" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  confirmNotSettled: adminProcedure.input(reconciliationInput).mutation(async ({ input, ctx }) => {
    const pool = await poolOrFail();
    const { rows } = await pool.query(
      `UPDATE intelligence_assessment_billing_reconciliations r
       SET status = 'confirmed_not_settled', reviewed_by = $2, reviewed_at = now(), closed_at = now(), resolution_rationale = $3, updated_at = now()
       FROM intelligence_assessment_billing_events e
       WHERE r.billing_event_id = $1 AND e.id = r.billing_event_id AND r.status IN ('open','under_review')
         AND r.requested_by <> $2 AND (r.tenant_id = $4 OR $4 IS NULL)
       RETURNING r.id`, [input.billingEventId, ctx.user!.id, input.rationale, ctx.tenantId],
    );
    if (rows.length !== 1) throw new TRPCError({ code: "CONFLICT", message: "Reconciliation cannot be closed by its requester or is not open" });
    return { billingEventId: input.billingEventId, status: "confirmed_not_settled" as const };
  }),

  approveDeterministicRetry: adminProcedure.input(reconciliationInput.pick({ billingEventId: true, rationale: true })).mutation(async ({ input, ctx }) => {
    const pool = await poolOrFail();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const update = await client.query(
        `UPDATE intelligence_assessment_billing_reconciliations r
         SET status = 'approved_retry', reviewed_by = $2, reviewed_at = now(), requeued_at = now(), closed_at = now(), resolution_rationale = $3, updated_at = now()
         FROM intelligence_assessment_billing_events e
         WHERE r.billing_event_id = $1 AND e.id = r.billing_event_id AND r.status IN ('open','under_review')
           AND r.requested_by <> $2 AND (r.tenant_id = $4 OR $4 IS NULL)
         RETURNING r.id`, [input.billingEventId, ctx.user!.id, input.rationale, ctx.tenantId],
      );
      if (update.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Reconciliation retry cannot be approved by its requester or is not open" });
      await client.query(
        `UPDATE intelligence_assessment_billing_events
         SET status = 'retryable_failure', attempt_count = 0, available_at = now(), leased_at = NULL, lease_owner = NULL,
             last_error_code = 'human_approved_deterministic_retry', updated_at = now()
         WHERE id = $1 AND status = 'awaiting_reconciliation'`, [input.billingEventId],
      );
      await client.query("COMMIT");
      return { billingEventId: input.billingEventId, status: "retryable_failure" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),
});

export const __intelligenceBillingReconciliationInternals = { evidenceDigest: (value: string) => createHash("sha256").update(value).digest("hex") };
