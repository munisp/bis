import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import { getPgPool } from "./db";
import { withTenantTransaction } from "./tenantRls";

const opaqueReference = z
  .string()
  .trim()
  .min(8)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Evidence reference must be an opaque identifier.");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "Evidence digest must be a lowercase SHA-256 hex value.");
const caseIdInput = z.object({ reconciliationCaseId: z.string().uuid() });
const evidenceInput = z.object({
  reconciliationCaseId: z.string().uuid(),
  reasonCode: z.enum([
    "MATCHING_SETTLEMENT_CONFIRMED",
    "NO_EXTERNAL_EFFECT_CONFIRMED",
    "NO_SETTLEMENT_CONFIRMED",
    "COMPENSATION_REQUIRED",
  ]),
  ledgerEvidenceRef: opaqueReference,
  ledgerEvidenceSha256: sha256,
  providerEvidenceRef: opaqueReference,
  providerEvidenceSha256: sha256,
});

type ReconciliationCase = {
  id: string;
  transaction_id: number;
  outbox_id: number;
  tenant_id: number;
  status: "open" | "under_review" | "approved_retry" | "confirmed_settled" | "confirmed_not_settled" | "compensation_required" | "cancelled";
  last_error_code: string;
  claimed_by: number | null;
  transaction_status: string;
  outbox_status: string;
};

type Resolution = "confirmed_settled" | "confirmed_not_settled" | "approved_retry" | "compensation_required";

function requireTenantId(tenantId: number | null | undefined): number {
  if (!Number.isSafeInteger(tenantId) || !tenantId || tenantId <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "A trusted tenant scope is required for payment reconciliation." });
  }
  return tenantId;
}

function requireActorId(actorId: number | undefined): number {
  if (!Number.isSafeInteger(actorId) || !actorId || actorId <= 0) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated reviewer is required for payment reconciliation." });
  }
  return actorId;
}

async function poolOrFail() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Payment reconciliation storage is unavailable." });
  return pool;
}

async function appendEvent(
  client: { query: (query: string, values?: unknown[]) => Promise<unknown> },
  input: {
    caseId: string;
    tenantId: number;
    eventType: "case_opened" | "case_claimed" | "settlement_confirmed" | "not_settled_confirmed" | "retry_approved" | "compensation_required" | "case_cancelled";
    actorUserId: number | null;
    fromStatus: string | null;
    toStatus: string;
    reasonCode: string;
    ledgerEvidenceSha256?: string;
    providerEvidenceSha256?: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO payment_reconciliation_events
      (id, reconciliation_case_id, tenant_id, event_type, actor_user_id, from_status, to_status,
       reason_code, ledger_evidence_sha256, provider_evidence_sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      randomUUID(),
      input.caseId,
      input.tenantId,
      input.eventType,
      input.actorUserId,
      input.fromStatus,
      input.toStatus,
      input.reasonCode,
      input.ledgerEvidenceSha256 ?? null,
      input.providerEvidenceSha256 ?? null,
    ]
  );
}

async function lockClaimedCase(
  client: { query: <T = Record<string, unknown>>(query: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  reconciliationCaseId: string,
  tenantId: number,
  actorId: number
): Promise<ReconciliationCase> {
  const result = await client.query<ReconciliationCase>(
    `SELECT c.id, c.transaction_id, c.outbox_id, c.tenant_id, c.status, c.last_error_code, c.claimed_by,
            t.status AS transaction_status, o.status AS outbox_status
     FROM payment_reconciliation_cases c
     JOIN transactions t ON t.id = c.transaction_id AND t."tenantId" = c.tenant_id
     JOIN payment_intent_outbox o ON o.id = c.outbox_id AND o.transaction_id = c.transaction_id AND o.tenant_id = c.tenant_id
     WHERE c.id = $1 AND c.tenant_id = $2
     FOR UPDATE OF c, t, o`,
    [reconciliationCaseId, tenantId]
  );
  const item = result.rows[0];
  if (!item || item.status !== "under_review" || item.claimed_by === null || item.claimed_by === actorId) {
    throw new TRPCError({ code: "CONFLICT", message: "The payment reconciliation case is unavailable for independent resolution." });
  }
  if (item.transaction_status !== "under_review" || item.outbox_status !== "dead_letter") {
    throw new TRPCError({ code: "CONFLICT", message: "The durable payment state is inconsistent and requires incident containment." });
  }
  return item;
}

async function resolveCase(
  input: z.infer<typeof evidenceInput>,
  tenantId: number,
  actorId: number,
  resolution: Resolution
): Promise<{ reconciliationCaseId: string; status: Resolution }> {
  const pool = await poolOrFail();
  const client = await pool.connect();
  try {
    return await withTenantTransaction(client, tenantId, async tenantClient => {
      const item = await lockClaimedCase(tenantClient, input.reconciliationCaseId, tenantId, actorId);
      const eventType = resolution === "confirmed_settled"
        ? "settlement_confirmed"
        : resolution === "confirmed_not_settled"
          ? "not_settled_confirmed"
          : resolution === "approved_retry"
            ? "retry_approved"
            : "compensation_required";
      const result = await tenantClient.query<{ id: string }>(
        `UPDATE payment_reconciliation_cases
         SET status = $2, resolved_by = $3, resolved_at = NOW(), closed_at = NOW(),
             resolution_rationale = $4, ledger_evidence_ref = $5, ledger_evidence_sha256 = $6,
             provider_evidence_ref = $7, provider_evidence_sha256 = $8
         WHERE id = $1 AND tenant_id = $9 AND status = 'under_review' AND claimed_by <> $3
         RETURNING id`,
        [
          item.id,
          resolution,
          actorId,
          input.reasonCode,
          input.ledgerEvidenceRef,
          input.ledgerEvidenceSha256,
          input.providerEvidenceRef,
          input.providerEvidenceSha256,
          tenantId,
        ]
      );
      if (result.rows.length !== 1) throw new TRPCError({ code: "CONFLICT", message: "Payment reconciliation resolution could not be recorded." });

      if (resolution === "confirmed_settled") {
        const updated = await tenantClient.query<{ id: number }>(
          `UPDATE transactions SET status = 'completed', "updatedAt" = NOW()
           WHERE id = $1 AND "tenantId" = $2 AND status = 'under_review'
           RETURNING id`,
          [item.transaction_id, tenantId]
        );
        if (updated.rows.length !== 1) throw new TRPCError({ code: "CONFLICT", message: "Payment transaction could not be settled safely." });
      } else if (resolution === "confirmed_not_settled") {
        const updated = await tenantClient.query<{ id: number }>(
          `UPDATE transactions SET status = 'failed', "updatedAt" = NOW()
           WHERE id = $1 AND "tenantId" = $2 AND status = 'under_review'
           RETURNING id`,
          [item.transaction_id, tenantId]
        );
        if (updated.rows.length !== 1) throw new TRPCError({ code: "CONFLICT", message: "Payment transaction could not be failed safely." });
      } else if (resolution === "approved_retry") {
        const queued = await tenantClient.query<{ id: number }>(
          `UPDATE payment_intent_outbox
           SET status = 'queued', attempts = 0, leased_at = NULL, lease_owner = NULL,
               next_attempt_at = NOW(), last_error_code = 'HUMAN_APPROVED_DETERMINISTIC_RETRY'
           WHERE id = $1 AND tenant_id = $2 AND transaction_id = $3 AND status = 'dead_letter'
           RETURNING id`,
          [item.outbox_id, tenantId, item.transaction_id]
        );
        if (queued.rows.length !== 1) throw new TRPCError({ code: "CONFLICT", message: "Payment outbox could not be requeued safely." });
        const updated = await tenantClient.query<{ id: number }>(
          `UPDATE transactions SET status = 'pending', "updatedAt" = NOW()
           WHERE id = $1 AND "tenantId" = $2 AND status = 'under_review'
           RETURNING id`,
          [item.transaction_id, tenantId]
        );
        if (updated.rows.length !== 1) throw new TRPCError({ code: "CONFLICT", message: "Payment transaction could not be requeued safely." });
      }

      await appendEvent(tenantClient, {
        caseId: item.id,
        tenantId,
        eventType,
        actorUserId: actorId,
        fromStatus: "under_review",
        toStatus: resolution,
        reasonCode: input.reasonCode,
        ledgerEvidenceSha256: input.ledgerEvidenceSha256,
        providerEvidenceSha256: input.providerEvidenceSha256,
      });
      return { reconciliationCaseId: item.id, status: resolution };
    });
  } finally {
    client.release();
  }
}

export const paymentReconciliationRouter = router({
  listOpen: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ input, ctx }) => {
      const tenantId = requireTenantId(ctx.tenantId);
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        return await withTenantTransaction(client, tenantId, async tenantClient => {
          const result = await tenantClient.query(
            `SELECT c.id, c.transaction_id, c.outbox_id, c.status, c.last_error_code, c.opened_at, c.claimed_at,
                    o.attempts, o.workflow_id, o.workflow_run_id
             FROM payment_reconciliation_cases c
             JOIN payment_intent_outbox o ON o.id = c.outbox_id AND o.tenant_id = c.tenant_id
             WHERE c.tenant_id = $1 AND c.status IN ('open', 'under_review')
             ORDER BY c.opened_at ASC, c.id ASC
             LIMIT $2`,
            [tenantId, input?.limit ?? 50]
          );
          return result.rows;
        });
      } finally {
        client.release();
      }
    }),

  claim: adminProcedure.input(caseIdInput).mutation(async ({ input, ctx }) => {
    const tenantId = requireTenantId(ctx.tenantId);
    const actorId = requireActorId(ctx.user?.id);
    const pool = await poolOrFail();
    const client = await pool.connect();
    try {
      return await withTenantTransaction(client, tenantId, async tenantClient => {
        const result = await tenantClient.query<{ id: string; status: "under_review" }>(
          `UPDATE payment_reconciliation_cases
           SET status = 'under_review', claimed_by = $2, claimed_at = NOW()
           WHERE id = $1 AND tenant_id = $3 AND status = 'open' AND claimed_by IS NULL
           RETURNING id, status`,
          [input.reconciliationCaseId, actorId, tenantId]
        );
        const item = result.rows[0];
        if (!item) throw new TRPCError({ code: "CONFLICT", message: "Payment reconciliation case is not available to claim." });
        await appendEvent(tenantClient, {
          caseId: item.id,
          tenantId,
          eventType: "case_claimed",
          actorUserId: actorId,
          fromStatus: "open",
          toStatus: "under_review",
          reasonCode: "INDEPENDENT_REVIEW_CLAIMED",
        });
        return { reconciliationCaseId: item.id, status: item.status };
      });
    } finally {
      client.release();
    }
  }),

  confirmSettled: adminProcedure.input(evidenceInput.extend({ reasonCode: z.literal("MATCHING_SETTLEMENT_CONFIRMED") })).mutation(async ({ input, ctx }) =>
    resolveCase(input, requireTenantId(ctx.tenantId), requireActorId(ctx.user?.id), "confirmed_settled")
  ),

  confirmNotSettled: adminProcedure.input(evidenceInput.extend({ reasonCode: z.literal("NO_SETTLEMENT_CONFIRMED") })).mutation(async ({ input, ctx }) =>
    resolveCase(input, requireTenantId(ctx.tenantId), requireActorId(ctx.user?.id), "confirmed_not_settled")
  ),

  approveDeterministicRetry: adminProcedure.input(evidenceInput.extend({ reasonCode: z.literal("NO_EXTERNAL_EFFECT_CONFIRMED") })).mutation(async ({ input, ctx }) =>
    resolveCase(input, requireTenantId(ctx.tenantId), requireActorId(ctx.user?.id), "approved_retry")
  ),

  requireCompensation: adminProcedure.input(evidenceInput.extend({ reasonCode: z.literal("COMPENSATION_REQUIRED") })).mutation(async ({ input, ctx }) =>
    resolveCase(input, requireTenantId(ctx.tenantId), requireActorId(ctx.user?.id), "compensation_required")
  ),
});
