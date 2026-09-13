/**
 * WP2 — Monitoring Scheduler
 *
 * 60-second interval worker that re-screens due monitoring enrollments and
 * fans out alerts on screening deltas.
 *
 * Multi-instance safety: enrollments are claimed with
 * `SELECT ... FOR UPDATE SKIP LOCKED`, so N BFF replicas can run this worker
 * concurrently without double-processing.
 *
 * Failure policy: all per-enrollment work happens in ONE transaction. A
 * screening/persistence failure records a monitoring_runs row with
 * result='error' and never crashes the loop (fail-closed: no silent baseline
 * mutation on error).
 *
 * Startup is guarded by MONITORING_SCHEDULER_ENABLED (default: enabled).
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getPgPool } from "./db";
import {
  alertSeverity,
  buildSnapshot,
  computeNextRunAt,
  diffSnapshots,
  hasDelta,
  publishMonitoringEvent,
  runListScreening,
  writeMonitoringAuditLog,
  type MonitoringFrequency,
  type MonitoringSnapshot,
  type SnapshotHit,
} from "./monitoring";

const POLL_INTERVAL_MS = 60_000;
const BATCH_SIZE = 25;

type SqlClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export interface MonitoringSchedulerDeps {
  /** Screening entry point — injectable for tests. Defaults to the real gateway pipeline. */
  screen: (subjectName: string, listSet: string[]) => Promise<Record<string, any>>;
  /** Event publisher — injectable for tests. */
  publish: (eventType: string, subjectRef: string, severity: string, payload: unknown) => Promise<void>;
  now: () => Date;
}

const defaultDeps: MonitoringSchedulerDeps = {
  screen: (subjectName, listSet) => runListScreening(subjectName, listSet),
  publish: publishMonitoringEvent,
  now: () => new Date(),
};

export interface DueEnrollmentRow {
  id: string;
  tenant_id: number;
  investigation_ref: string;
  subject_name: string;
  list_set: string[];
  frequency: MonitoringFrequency;
  status: string;
  next_run_at: Date | null;
  baseline_snapshot: MonitoringSnapshot | null;
}

/**
 * Claim up to `limit` due enrollments. Must be called inside a transaction;
 * the SKIP LOCKED claim is held until that transaction ends, so callers process
 * one enrollment per transaction.
 */
export async function claimDueEnrollments(client: SqlClient, limit: number): Promise<Array<{ id: string }>> {
  const result = await client.query(
    `SELECT id FROM monitoring_enrollments
     WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= now()
     ORDER BY next_run_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return result.rows;
}

interface PendingAlert {
  alertType: "new_hit" | "status_change" | "removed_hit";
  severity: string;
  hit: SnapshotHit;
  before?: SnapshotHit;
}

/**
 * Process ONE due enrollment in ONE transaction:
 *   re-run screening → diff vs baseline → write monitoring_runs → on delta
 *   write monitoring_alerts + audit, update baseline_snapshot and next_run_at.
 * Errors roll back and are recorded as a result='error' run in a fresh
 * transaction; the function never throws.
 */
export async function processDueEnrollment(
  pool: Pool,
  enrollmentId: string,
  deps: MonitoringSchedulerDeps = defaultDeps,
): Promise<"processed" | "skipped" | "error"> {
  const startedAt = deps.now();
  const alerts: PendingAlert[] = [];
  let investigationRef = "";
  let severity = "info";

  const client = (await pool.connect()) as unknown as SqlClient & { release: () => void };
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, tenant_id, investigation_ref, subject_name, list_set, frequency, status, baseline_snapshot
       FROM monitoring_enrollments WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [enrollmentId],
    );
    if (current.rowCount !== 1) {
      await client.query("ROLLBACK").catch(() => undefined);
      return "skipped";
    }
    const enrollment = current.rows[0] as DueEnrollmentRow;
    investigationRef = enrollment.investigation_ref;

    // Re-run the subject's screening via the existing entry points (fail-closed).
    const perList = await deps.screen(enrollment.subject_name, enrollment.list_set);
    const snapshot = buildSnapshot(enrollment.subject_name, perList);
    const delta = diffSnapshots(enrollment.baseline_snapshot, snapshot);
    const changed = hasDelta(delta);

    for (const hit of delta.newHits) alerts.push({ alertType: "new_hit", severity: alertSeverity("new_hit", hit), hit });
    for (const { before, after } of delta.statusChanges) alerts.push({ alertType: "status_change", severity: alertSeverity("status_change", after), hit: after, before });
    for (const hit of delta.removedHits) alerts.push({ alertType: "removed_hit", severity: alertSeverity("removed_hit", hit), hit });
    severity = alerts.some((a) => a.severity === "critical") ? "critical" : alerts.some((a) => a.severity === "high") ? "high" : alerts.length > 0 ? "warning" : "info";

    await client.query(
      `INSERT INTO monitoring_runs (id, enrollment_id, started_at, finished_at, result, snapshot, error)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULL)`,
      [randomUUID(), enrollmentId, startedAt, deps.now(), changed ? "change_detected" : "no_change", JSON.stringify(snapshot)],
    );

    for (const alert of alerts) {
      await client.query(
        `INSERT INTO monitoring_alerts (id, tenant_id, enrollment_id, alert_type, severity, delta)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [randomUUID(), enrollment.tenant_id, enrollmentId, alert.alertType, alert.severity, JSON.stringify({ hit: alert.hit, before: alert.before ?? null })],
      );
    }

    if (changed) {
      await client.query(
        `UPDATE monitoring_enrollments
         SET baseline_snapshot = $1::jsonb, last_run_at = $2, next_run_at = $3, updated_at = now()
         WHERE id = $4`,
        [JSON.stringify(snapshot), startedAt, computeNextRunAt(enrollment.frequency, startedAt), enrollmentId],
      );
      await writeMonitoringAuditLog(client, {
        tenantId: enrollment.tenant_id, userId: null, category: "alert",
        action: `Monitoring change detected (${alerts.map((a) => a.alertType).join(", ")})`,
        targetRef: enrollment.investigation_ref,
        result: "warning",
        detail: { enrollmentId, newHits: delta.newHits.length, removedHits: delta.removedHits.length, statusChanges: delta.statusChanges.length, severity },
      });
    } else {
      await client.query(
        `UPDATE monitoring_enrollments SET last_run_at = $1, next_run_at = $2, updated_at = now() WHERE id = $3`,
        [startedAt, computeNextRunAt(enrollment.frequency, startedAt), enrollmentId],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await recordErrorRun(pool, enrollmentId, startedAt, investigationRef, error, deps);
    return "error";
  }
  client.release();

  // Post-commit fan-out: publish one MONITORING_ALERT event per alert.
  // Kept outside the transaction so network latency never holds row locks.
  for (const alert of alerts) {
    await deps.publish("MONITORING_ALERT", investigationRef, alert.severity, {
      enrollmentId,
      alertType: alert.alertType,
      severity: alert.severity,
      hit: alert.hit,
      before: alert.before ?? null,
    }).catch((e) => console.warn("[MonitoringScheduler] Event publish failed:", e));
  }
  return "processed";
}

/** Record a failed run without mutating the baseline (fail-closed retry next cycle). */
async function recordErrorRun(pool: Pool, enrollmentId: string, startedAt: Date, investigationRef: string, error: unknown, deps: MonitoringSchedulerDeps): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const client = (await pool.connect()) as unknown as SqlClient & { release: () => void };
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO monitoring_runs (id, enrollment_id, started_at, finished_at, result, snapshot, error)
       VALUES ($1, $2, $3, $4, 'error', NULL, $5)`,
      [randomUUID(), enrollmentId, startedAt, deps.now(), message.slice(0, 2000)],
    );
    // Advance next_run_at so a broken enrollment retries on the next poll
    // instead of hot-looping, but keeps its existing baseline untouched.
    await client.query(
      `UPDATE monitoring_enrollments SET next_run_at = now() + interval '60 seconds', updated_at = now() WHERE id = $1`,
      [enrollmentId],
    );
    await writeMonitoringAuditLog(client, {
      tenantId: null, userId: null, category: "system",
      action: "Monitoring run failed",
      targetRef: investigationRef || enrollmentId,
      result: "failure",
      detail: { enrollmentId, error: message.slice(0, 500) },
    });
    await client.query("COMMIT");
  } catch (inner) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[MonitoringScheduler] Failed to record error run:", inner);
  } finally {
    client.release();
  }
  console.error(`[MonitoringScheduler] Enrollment ${enrollmentId} run failed: ${message}`);
}

/** One scheduler tick: claim due enrollments, process each in its own transaction. */
export async function runDueEnrollments(
  pool: Pool,
  deps: MonitoringSchedulerDeps = defaultDeps,
  batchSize: number = BATCH_SIZE,
): Promise<{ processed: number; errors: number; skipped: number }> {
  // Claim phase: short transaction holding SKIP LOCKED rows only long enough
  // to read IDs — the per-enrollment FOR UPDATE in processDueEnrollment is the
  // authoritative lock for the actual work.
  const claimClient = (await pool.connect()) as unknown as SqlClient & { release: () => void };
  let due: Array<{ id: string }> = [];
  try {
    await claimClient.query("BEGIN");
    due = await claimDueEnrollments(claimClient, batchSize);
    await claimClient.query("COMMIT");
  } catch (error) {
    await claimClient.query("ROLLBACK").catch(() => undefined);
    console.error("[MonitoringScheduler] Claim query failed:", error);
    return { processed: 0, errors: 1, skipped: 0 };
  } finally {
    claimClient.release();
  }

  let processed = 0;
  let errors = 0;
  let skipped = 0;
  for (const row of due) {
    const outcome = await processDueEnrollment(pool, row.id, deps);
    if (outcome === "processed") processed += 1;
    else if (outcome === "error") errors += 1;
    else skipped += 1;
  }
  return { processed, errors, skipped };
}

// ─── Interval worker lifecycle ────────────────────────────────────────────────

let _timer: NodeJS.Timeout | null = null;
let _tickInFlight = false;

function schedulerEnabled(): boolean {
  const raw = (process.env.MONITORING_SCHEDULER_ENABLED ?? "").trim().toLowerCase();
  return !["0", "false", "off", "disabled"].includes(raw); // default: enabled
}

/** Start the 60s interval worker. Safe to call once at server boot. */
export function startMonitoringScheduler(): void {
  if (!schedulerEnabled()) {
    console.info("[MonitoringScheduler] Disabled via MONITORING_SCHEDULER_ENABLED");
    return;
  }
  if (_timer) {
    console.warn("[MonitoringScheduler] Already started — skipping duplicate registration");
    return;
  }
  _timer = setInterval(async () => {
    if (_tickInFlight) return; // no overlap
    _tickInFlight = true;
    try {
      const pool = await getPgPool();
      if (!pool) {
        console.error("[MonitoringScheduler] Database pool unavailable — skipping tick (fail-closed)");
        return;
      }
      const { processed, errors, skipped } = await runDueEnrollments(pool);
      if (processed + errors + skipped > 0) {
        console.info(`[MonitoringScheduler] Tick complete: ${processed} processed, ${errors} errors, ${skipped} skipped`);
      }
    } catch (error) {
      // Never crash the loop.
      console.error("[MonitoringScheduler] Tick failed:", error);
    } finally {
      _tickInFlight = false;
    }
  }, POLL_INTERVAL_MS);
  _timer.unref();
  console.info(`[MonitoringScheduler] Started — polling every ${POLL_INTERVAL_MS / 1000}s for due enrollments`);
}

/** Stop the worker (tests / graceful shutdown). */
export function stopMonitoringScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.info("[MonitoringScheduler] Stopped");
  }
}
