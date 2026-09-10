import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { startPaymentTransferWorkflow } from "./temporal";

const POLL_INTERVAL_MS = 5_000;
const LEASE_TIMEOUT_SECONDS = 300;
const MAX_ATTEMPTS = 10;
const MAX_BATCH_SIZE = 25;

interface PaymentOutboxRow {
  id: number;
  transaction_id: number;
  tenant_id: number;
  idempotency_key: string;
  rail: string;
  attempts: number;
  tx_ref: string;
  originator_account: string;
  beneficiary_account: string;
  beneficiary_name: string;
  beneficiary_bank: string;
  amount: number;
  currency: string;
  narration: string | null;
}

interface QueryRows<T> {
  rows?: T[];
}

function rowsOf<T>(result: unknown): T[] {
  if (typeof result === "object" && result !== null && "rows" in result) {
    const rows = (result as QueryRows<T>).rows;
    return Array.isArray(rows) ? rows : [];
  }
  return [];
}

function retryAt(attempt: number): Date {
  const base = Math.min(1_000 * 2 ** Math.max(attempt - 1, 0), 300_000);
  return new Date(Date.now() + base + randomInt(Math.max(1, Math.floor(base / 10))));
}

/**
 * Claims and dispatches payment intents. Claiming happens in PostgreSQL with
 * `FOR UPDATE SKIP LOCKED`; the HTTP request path never calls a rail or Temporal
 * directly. The workflow ID is deterministically derived from txRef by
 * startPaymentTransferWorkflow, so duplicate dispatch attempts are idempotent at
 * the workflow boundary and do not create a second transfer instruction.
 */
export async function processPaymentIntentOutbox(limit = MAX_BATCH_SIZE): Promise<{
  claimed: number;
  dispatched: number;
  deferred: number;
  deadLettered: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("payment intent outbox database unavailable");

  await db.execute(sql`
    UPDATE payment_intent_outbox
    SET status = 'queued', leased_at = NULL, lease_owner = NULL
    WHERE status = 'leased'
      AND leased_at < NOW() - make_interval(secs => ${LEASE_TIMEOUT_SECONDS})
  `);

  const claimed = rowsOf<PaymentOutboxRow>(
    await db.execute(sql`
      WITH candidate AS (
        SELECT o.id
        FROM payment_intent_outbox o
        WHERE o.status = 'queued' AND o.next_attempt_at <= NOW()
        ORDER BY o.next_attempt_at ASC, o.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.min(limit, MAX_BATCH_SIZE))}
      )
      UPDATE payment_intent_outbox o
      SET status = 'leased', leased_at = NOW(), lease_owner = current_setting('application_name', true)
      FROM candidate
      WHERE o.id = candidate.id
      RETURNING o.id, o.transaction_id, o.tenant_id, o.idempotency_key, o.rail, o.attempts,
        (SELECT t."txRef" FROM transactions t WHERE t.id = o.transaction_id) AS tx_ref,
        (SELECT t."originatorAccount" FROM transactions t WHERE t.id = o.transaction_id) AS originator_account,
        (SELECT t."beneficiaryAccount" FROM transactions t WHERE t.id = o.transaction_id) AS beneficiary_account,
        (SELECT t."beneficiaryName" FROM transactions t WHERE t.id = o.transaction_id) AS beneficiary_name,
        (SELECT t."beneficiaryBank" FROM transactions t WHERE t.id = o.transaction_id) AS beneficiary_bank,
        (SELECT t.amount FROM transactions t WHERE t.id = o.transaction_id) AS amount,
        (SELECT t.currency FROM transactions t WHERE t.id = o.transaction_id) AS currency,
        (SELECT t.narration FROM transactions t WHERE t.id = o.transaction_id) AS narration
    `)
  );

  let dispatched = 0;
  let deferred = 0;
  let deadLettered = 0;
  for (const item of claimed) {
    const attempt = item.attempts + 1;
    if (!isDispatchable(item)) {
      await db.execute(sql`
        UPDATE payment_intent_outbox
        SET status = 'dead_letter', attempts = ${attempt}, leased_at = NULL,
            last_error_code = 'INVALID_DURABLE_PAYMENT_INTENT'
        WHERE id = ${item.id} AND status = 'leased'
      `);
      await db.execute(sql`
        UPDATE transactions SET status = 'under_review', "updatedAt" = NOW()
        WHERE id = ${item.transaction_id} AND status = 'pending'
      `);
      deadLettered++;
      continue;
    }

    try {
      const workflow = await startPaymentTransferWorkflow({
        txRef: item.tx_ref,
        transactionId: item.transaction_id,
        originatorAccountId: item.originator_account,
        beneficiaryAccountId: item.beneficiary_account,
        beneficiaryName: item.beneficiary_name,
        beneficiaryBankCode: item.beneficiary_bank,
        amountKobo: item.amount,
        currency: item.currency,
        rail: item.rail,
        narration: item.narration ?? undefined,
      });
      await db.execute(sql`
        UPDATE payment_intent_outbox
        SET status = 'workflow_started', attempts = ${attempt}, leased_at = NULL,
            workflow_id = ${workflow.workflowId}, workflow_run_id = ${workflow.runId ?? null},
            last_error_code = NULL
        WHERE id = ${item.id} AND status = 'leased'
      `);
      dispatched++;
    } catch {
      if (attempt >= MAX_ATTEMPTS) {
        await db.execute(sql`
          UPDATE payment_intent_outbox
          SET status = 'dead_letter', attempts = ${attempt}, leased_at = NULL,
              last_error_code = 'TEMPORAL_WORKFLOW_START_FAILED'
          WHERE id = ${item.id} AND status = 'leased'
        `);
        await db.execute(sql`
          UPDATE transactions SET status = 'under_review', "updatedAt" = NOW()
          WHERE id = ${item.transaction_id} AND status = 'pending'
        `);
        deadLettered++;
      } else {
        await db.execute(sql`
          UPDATE payment_intent_outbox
          SET status = 'queued', attempts = ${attempt}, leased_at = NULL,
              next_attempt_at = ${retryAt(attempt)}, last_error_code = 'TEMPORAL_WORKFLOW_START_FAILED'
          WHERE id = ${item.id} AND status = 'leased'
        `);
        deferred++;
      }
    }
  }
  return { claimed: claimed.length, dispatched, deferred, deadLettered };
}

function isDispatchable(item: PaymentOutboxRow): boolean {
  return Boolean(
    item.tx_ref && item.originator_account && item.beneficiary_account &&
      item.beneficiary_name && item.beneficiary_bank && item.amount > 0 && item.currency === "NGN"
  );
}

let interval: ReturnType<typeof setInterval> | undefined;

export function startPaymentIntentOutboxDispatcher(): void {
  if (interval) return;
  interval = setInterval(() => {
    void processPaymentIntentOutbox().catch(() => {
      // The next durable poll retries; do not log payment references or payloads.
    });
  }, POLL_INTERVAL_MS);
}

export function stopPaymentIntentOutboxDispatcher(): void {
  if (interval) clearInterval(interval);
  interval = undefined;
}
