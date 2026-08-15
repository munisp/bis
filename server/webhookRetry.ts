/**
 * webhookRetry.ts — Exponential Backoff Retry for Webhook Event Processing
 * ==========================================================================
 * Provides a durable retry mechanism for Paystack webhook events that fail
 * to credit TigerBeetle on the first attempt. Failed events are persisted to
 * PostgreSQL and retried with exponential backoff (1s, 2s, 4s, 8s, 16s, 32s, 60s cap).
 *
 * Architecture:
 *   1. Webhook arrives → attempt credit immediately
 *   2. If credit fails (TB unavailable) → persist to `webhook_retry_queue` table
 *   3. Background scheduler polls the queue every 10s
 *   4. Each item is retried with exponential backoff based on attempt count
 *   5. After max attempts (7), item is marked as `dead_letter` for manual review
 *   6. Successful retries update billing_topups and clear the queue entry
 */
import { getDb } from "./db";
import { creditTenantAccount } from "./billing";

// ── Configuration ─────────────────────────────────────────────────────────────
const MAX_ATTEMPTS = 7;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
const POLL_INTERVAL_MS = 10_000;

interface RetryItem {
  id: number;
  reference: string;
  tenantId: string;
  amountKobo: number;
  attempts: number;
  nextRetryAt: Date;
  status: "pending" | "dead_letter" | "completed";
  lastError: string | null;
  createdAt: Date;
}

// ── Backoff Calculator ────────────────────────────────────────────────────────
export function calculateBackoff(attempt: number): number {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  // Add 10% jitter to prevent thundering herd
  const jitter = delay * 0.1 * Math.random();
  return Math.round(delay + jitter);
}

// ── Enqueue a Failed Webhook ──────────────────────────────────────────────────
export async function enqueueFailedWebhook(opts: {
  reference: string;
  tenantId: string;
  amountKobo: number;
  error: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[WebhookRetry] Cannot enqueue — database unavailable:", opts.reference);
    return;
  }
  const nextRetryAt = new Date(Date.now() + calculateBackoff(0));
  await db.execute(
    `INSERT INTO webhook_retry_queue ("reference", "tenantId", "amountKobo", "attempts", "nextRetryAt", "status", "lastError", "createdAt")
     VALUES ($1, $2, $3, 0, $4, 'pending', $5, NOW())
     ON CONFLICT ("reference") DO UPDATE SET
       "attempts" = webhook_retry_queue."attempts",
       "lastError" = EXCLUDED."lastError"`,
    // @ts-ignore — raw SQL params
  );
  // Use Drizzle raw SQL for the insert
  try {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO webhook_retry_queue ("reference", "tenantId", "amountKobo", "attempts", "nextRetryAt", "status", "lastError", "createdAt")
      VALUES (${opts.reference}, ${opts.tenantId}, ${opts.amountKobo}, 0, ${nextRetryAt}, 'pending', ${opts.error}, NOW())
      ON CONFLICT ("reference") DO NOTHING
    `);
    console.log(`[WebhookRetry] Enqueued ${opts.reference} for retry at ${nextRetryAt.toISOString()}`);
  } catch (err) {
    console.error("[WebhookRetry] Enqueue failed:", err);
  }
}

// ── Process Retry Queue ───────────────────────────────────────────────────────
export async function processRetryQueue(): Promise<{ processed: number; succeeded: number; deadLettered: number }> {
  const db = await getDb();
  if (!db) return { processed: 0, succeeded: 0, deadLettered: 0 };

  const { sql } = await import("drizzle-orm");
  let processed = 0, succeeded = 0, deadLettered = 0;

  try {
    // Fetch items due for retry
    const rows = await db.execute(sql`
      SELECT * FROM webhook_retry_queue
      WHERE "status" = 'pending' AND "nextRetryAt" <= NOW()
      ORDER BY "nextRetryAt" ASC
      LIMIT 20
    `);

    const items = (rows as any).rows ?? rows ?? [];

    for (const item of items) {
      processed++;
      const attempts = (item.attempts ?? 0) + 1;

      try {
        const result = await creditTenantAccount({
          tenantId: item.tenantId,
          amountKobo: item.amountKobo,
          reference: item.reference,
        });

        if (result.recorded) {
          // Success — mark as completed
          await db.execute(sql`
            UPDATE webhook_retry_queue
            SET "status" = 'completed', "attempts" = ${attempts}
            WHERE "reference" = ${item.reference}
          `);
          succeeded++;
          console.log(`[WebhookRetry] SUCCESS: ${item.reference} credited on attempt ${attempts}`);
        } else {
          // TB still unavailable — schedule next retry or dead-letter
          if (attempts >= MAX_ATTEMPTS) {
            await db.execute(sql`
              UPDATE webhook_retry_queue
              SET "status" = 'dead_letter', "attempts" = ${attempts}, "lastError" = 'Max attempts exceeded'
              WHERE "reference" = ${item.reference}
            `);
            deadLettered++;
            console.warn(`[WebhookRetry] DEAD LETTER: ${item.reference} after ${attempts} attempts`);
          } else {
            const nextDelay = calculateBackoff(attempts);
            const nextRetry = new Date(Date.now() + nextDelay);
            await db.execute(sql`
              UPDATE webhook_retry_queue
              SET "attempts" = ${attempts}, "nextRetryAt" = ${nextRetry}, "lastError" = 'TB unavailable'
              WHERE "reference" = ${item.reference}
            `);
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempts >= MAX_ATTEMPTS) {
          await db.execute(sql`
            UPDATE webhook_retry_queue
            SET "status" = 'dead_letter', "attempts" = ${attempts}, "lastError" = ${errMsg}
            WHERE "reference" = ${item.reference}
          `);
          deadLettered++;
        } else {
          const nextDelay = calculateBackoff(attempts);
          const nextRetry = new Date(Date.now() + nextDelay);
          await db.execute(sql`
            UPDATE webhook_retry_queue
            SET "attempts" = ${attempts}, "nextRetryAt" = ${nextRetry}, "lastError" = ${errMsg}
            WHERE "reference" = ${item.reference}
          `);
        }
      }
    }
  } catch (err) {
    console.error("[WebhookRetry] Queue processing error:", err);
  }

  return { processed, succeeded, deadLettered };
}

// ── Background Scheduler ──────────────────────────────────────────────────────
let retryInterval: ReturnType<typeof setInterval> | null = null;

export function startWebhookRetryScheduler(): void {
  if (retryInterval) return; // Already running
  console.log(`[WebhookRetry] Scheduler started — polling every ${POLL_INTERVAL_MS / 1000}s`);
  retryInterval = setInterval(async () => {
    const result = await processRetryQueue();
    if (result.processed > 0) {
      console.log(`[WebhookRetry] Processed ${result.processed}: ${result.succeeded} succeeded, ${result.deadLettered} dead-lettered`);
    }
  }, POLL_INTERVAL_MS);
}

export function stopWebhookRetryScheduler(): void {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
}
