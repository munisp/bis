import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getPgPool } from "./db";
import { debitTenantForIntelligenceAssessment, intelligenceAssessmentTransferId } from "./billingSettlement";

const MAX_ATTEMPTS = 10;
const LEASE_TIMEOUT_SECONDS = 300;

type BillingEvent = { id: string; tenant_id: number; assessment_id: string; amount_kobo: string | number; status: string; attempt_count: number; requested_by: number };

function amount(value: string | number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid assessment meter amount");
  return parsed;
}

/** Adds one event per approved decision-support assessment; all other score states remain free review work. */
export async function enqueueUnmeteredIntelligenceAssessments(limit = 100): Promise<number> {
  const pool = await getPgPool();
  if (!pool) throw new Error("Assessment billing requires PostgreSQL");
  const inserted = await pool.query(
    `INSERT INTO intelligence_assessment_billing_events
      (id, tenant_id, assessment_id, metering_policy_id, requested_by, amount_kobo, status, idempotency_key)
     SELECT gen_random_uuid(), a.tenant_id, a.id, p.id, a.created_by, p.prepaid_price_kobo, 'pending', a.id
     FROM investigation_score_assessments a
     JOIN investigation_score_policies sp ON sp.id = a.policy_id
     JOIN intelligence_assessment_metering_policies p
       ON p.tenant_id = a.tenant_id AND p.policy_code = sp.policy_code
     LEFT JOIN intelligence_assessment_billing_events e ON e.assessment_id = a.id
     WHERE a.decision_support_status = 'decision_support_only'
       AND a.superseded_at IS NULL
       AND a.expires_at > now()
       AND p.enabled = true
       AND p.approved_by IS NOT NULL AND p.approved_at IS NOT NULL
       AND p.effective_from <= now() AND (p.expires_at IS NULL OR p.expires_at > now())
       AND e.id IS NULL
     ORDER BY a.calculated_at ASC
     LIMIT $1
     ON CONFLICT (assessment_id) DO NOTHING`,
    [Math.max(1, Math.min(limit, 500))],
  );
  return inserted.rowCount ?? 0;
}

async function reserveAndConsumeEntitledUnit(event: BillingEvent): Promise<boolean> {
  const pool = await getPgPool();
  if (!pool) throw new Error("Assessment billing requires PostgreSQL");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ reservation_id: string | null }>("SELECT reservation_id FROM intelligence_assessment_billing_events WHERE id = $1 FOR UPDATE", [event.id]);
    if (existing.rowCount !== 1) throw new Error("Assessment billing event disappeared");
    if (existing.rows[0].reservation_id) { await client.query("COMMIT"); return true; }
    const entitlement = await client.query<{ id: string }>(
      `SELECT id FROM billing_entitlements
       WHERE tenant_id = $1 AND status = 'active' AND period_start <= now() AND period_end > now()
         AND total_units > consumed_units + reserved_units
       ORDER BY period_end ASC FOR UPDATE SKIP LOCKED LIMIT 1`, [event.tenant_id],
    );
    if (entitlement.rowCount !== 1) { await client.query("COMMIT"); return false; }
    const reservationId = randomUUID();
    await client.query("UPDATE billing_entitlements SET reserved_units = reserved_units + 1, updated_at = now() WHERE id = $1", [entitlement.rows[0].id]);
    await client.query(
      `INSERT INTO billing_check_reservations
        (id, tenant_id, entitlement_id, investigation_ref, requested_tier, status, idempotency_key, reserved_by, expires_at)
       VALUES ($1,$2,$3,$4,'intelligence_assessment','consumed',$5,$6,now())`,
      [reservationId, event.tenant_id, entitlement.rows[0].id, `intelligence:${event.assessment_id}`, event.id, event.requested_by],
    );
    await client.query("UPDATE billing_entitlements SET reserved_units = reserved_units - 1, consumed_units = consumed_units + 1, updated_at = now() WHERE id = $1", [entitlement.rows[0].id]);
    await client.query(
      `INSERT INTO billing_usage_events (id, tenant_id, reservation_id, usage_type, units, investigation_ref, recorded_by)
       VALUES ($1,$2,$3,'intelligence_assessment',1,$4,$5)`,
      [randomUUID(), event.tenant_id, reservationId, `intelligence:${event.assessment_id}`, event.requested_by],
    );
    await client.query("UPDATE intelligence_assessment_billing_events SET reservation_id = $2, status = 'settled', settled_at = now(), updated_at = now() WHERE id = $1", [event.id, reservationId]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function processIntelligenceAssessmentBillingEvent(eventId: string, workerId: string): Promise<void> {
  const pool = await getPgPool();
  if (!pool) throw new Error("Assessment billing requires PostgreSQL");
  const claimed = await pool.query<BillingEvent>(
    `UPDATE intelligence_assessment_billing_events
     SET status = 'leased', leased_at = now(), lease_owner = $2, attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = $1 AND status IN ('pending','retryable_failure') AND attempt_count < $3
     RETURNING id, tenant_id, assessment_id, amount_kobo, status, attempt_count, requested_by`, [eventId, workerId, MAX_ATTEMPTS],
  );
  if (claimed.rowCount !== 1) return;
  const event = claimed.rows[0];
  try {
    if (await reserveAndConsumeEntitledUnit(event)) return;
    const charge = amount(event.amount_kobo);
    if (charge === 0) {
      await pool.query("UPDATE intelligence_assessment_billing_events SET status = 'payment_required', last_error_code = 'no_entitlement', updated_at = now() WHERE id = $1", [event.id]);
      return;
    }
    const transferId = await debitTenantForIntelligenceAssessment({ tenantId: event.tenant_id, billingEventId: event.id, amountKobo: charge });
    const settled = await pool.query(
      `UPDATE intelligence_assessment_billing_events
       SET status = 'settled', tigerbeetle_transfer_id = $2, settled_at = now(), last_error_code = NULL, updated_at = now()
       WHERE id = $1 AND status = 'leased' RETURNING id`, [event.id, transferId],
    );
    if (settled.rowCount !== 1) throw new Error("TigerBeetle transfer completed but assessment billing state requires reconciliation");
  } catch (error) {
    const retryable = error instanceof Error && /unavailable|timeout|connection|reconciliation/i.test(error.message);
    const errorCode = retryable ? "ledger_unavailable" : "payment_or_integrity_failure";
    if (retryable && event.attempt_count >= MAX_ATTEMPTS) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE intelligence_assessment_billing_events
           SET status = 'awaiting_reconciliation', tigerbeetle_transfer_id = COALESCE(tigerbeetle_transfer_id, $2),
               last_error_code = $3, updated_at = now()
           WHERE id = $1 AND status = 'leased'`,
          [event.id, intelligenceAssessmentTransferId(event.id), errorCode],
        );
        await client.query(
          `INSERT INTO intelligence_assessment_billing_reconciliations
            (id, billing_event_id, tenant_id, deterministic_transfer_id, status, last_error_code, requested_by)
           VALUES ($1, $2, $3, $4, 'open', $5, $6)
           ON CONFLICT (billing_event_id) DO NOTHING`,
          [randomUUID(), event.id, event.tenant_id, intelligenceAssessmentTransferId(event.id), errorCode, event.requested_by],
        );
        await client.query("COMMIT");
      } catch (reconciliationError) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw reconciliationError;
      } finally { client.release(); }
      return;
    }
    await pool.query(
      `UPDATE intelligence_assessment_billing_events
       SET status = CASE WHEN $2 THEN 'retryable_failure' ELSE 'payment_required' END,
           available_at = CASE WHEN $2 THEN now() + interval '5 minutes' ELSE available_at END,
           last_error_code = $3, updated_at = now()
       WHERE id = $1`, [event.id, retryable, errorCode],
    );
    if (retryable) throw error;
  }
}

export async function processDueIntelligenceAssessmentBillingEvents(limit = 50): Promise<number> {
  const pool = await getPgPool();
  if (!pool) throw new Error("Assessment billing requires PostgreSQL");
  await enqueueUnmeteredIntelligenceAssessments(limit);
  const stale = await pool.query(
    `UPDATE intelligence_assessment_billing_events SET status = 'retryable_failure', lease_owner = NULL, leased_at = NULL, available_at = now(), updated_at = now()
     WHERE status = 'leased' AND leased_at < now() - ($1 || ' seconds')::interval`, [LEASE_TIMEOUT_SECONDS],
  );
  const due = await pool.query<{ id: string }>(
    `SELECT id FROM intelligence_assessment_billing_events
     WHERE status IN ('pending','retryable_failure') AND available_at <= now()
     ORDER BY created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`, [Math.max(1, Math.min(limit, 100))],
  );
  const workerId = `intelligence-meter-${randomUUID()}`;
  for (const row of due.rows) await processIntelligenceAssessmentBillingEvent(row.id, workerId);
  return (due.rowCount ?? 0) + (stale.rowCount ?? 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  processDueIntelligenceAssessmentBillingEvents()
    .then((processed) => process.stdout.write(`${JSON.stringify({ event: "intelligence_assessment_billing_complete", processed })}\n`))
    .catch((error) => { process.stderr.write(`${JSON.stringify({ event: "intelligence_assessment_billing_failed", error: error instanceof Error ? error.message : "unknown" })}\n`); process.exitCode = 1; });
}

export const __intelligenceAssessmentBillingInternals = { amount, MAX_ATTEMPTS, LEASE_TIMEOUT_SECONDS, intelligenceAssessmentTransferId };
