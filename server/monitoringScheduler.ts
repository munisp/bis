/**
 * server/monitoringScheduler.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Continuous re-screening loop for ongoing-monitoring enrollments.
 *
 * Every 60s the loop claims due enrollments directly in PostgreSQL:
 *
 *   WHERE status = 'active' AND next_run_at <= now()
 *   ORDER BY next_run_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
 *
 * so multiple BFF replicas never process the same enrollment twice (same
 * leased-claim precedent as server/paymentIntentOutbox.ts). Each enrollment is
 * processed in ONE transaction: re-run the existing screening pipeline, diff
 * against the baseline snapshot, insert the monitoring_runs row, insert
 * monitoring_alerts rows for any delta, write the audit log, and advance
 * baseline_snapshot + next_run_at. Event-processor fan-out (MONITORING_ALERT,
 * severity critical for a new sanctions hit) happens immediately after COMMIT
 * so no alert is published for a rolled-back transaction.
 *
 * Fail-closed: a screening/provider failure records a monitoring_runs row with
 * result='error' and advances next_run_at by one frequency period (no hot
 * loop, no silent "clear"). A per-enrollment failure never crashes the loop.
 *
 * Started from server/_core/index.ts when MONITORING_SCHEDULER_ENABLED is not
 * "false" (default on).
 */

import { getPgPool } from "./db";
import {
  alertSeverity,
  diffSnapshots,
  nextRunAt,
  publishMonitoringEvent,
  runSubjectScreening,
  writeMonitoringAuditLog,
  type MonitoringFrequency,
  type MonitoringListKind,
  type MonitoringSnapshot,
} from "./monitoring";

const POLL_INTERVAL_MS = 60_000;
const MAX_BATCH_SIZE = 10;

interface EnrollmentRow {
  id: string;
  tenant_id: number;
  investigation_ref: string;
  subject_name: string;
  subject_identifiers: Record<string, string> | null;
  list_set: MonitoringListKind[];
  frequency: MonitoringFrequency;
  baseline_snapshot: MonitoringSnapshot | null;
  created_by: number | null;
}

interface PendingAlert {
  alertType: "new_hit" | "status_change" | "removed_hit";
  severity: string;
  delta: Record<string, unknown>;
}

/** Records a fail-closed error run in its own short transaction. */
async function recordErrorRun(
  pool: { connect: () => Promise<{ query: (t: string, v?: unknown[]) => Promise<any>; release: () => void }> },
  enrollment: EnrollmentRow,
  error: unknown,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO monitoring_runs (enrollment_id, started_at, finished_at, result, error)
       VALUES ($1, now(), now(), 'error', $2)`,
      [enrollment.id, error instanceof Error ? error.message.slice(0, 1024) : String(error).slice(0, 1024)],
    );
    // Advance the schedule so a failing provider does not spin every 60s; the
    // baseline is left untouched so the next successful run diffs against it.
    await client.query(
      `UPDATE monitoring_enrollments SET last_run_at = now(), next_run_at = $2, updated_at = now()
       WHERE id = $1 AND status = 'active'`,
      [enrollment.id, nextRunAt(enrollment.frequency)],
    );
    await writeMonitoringAuditLog(client, {
      tenantId: enrollment.tenant_id,
      userId: enrollment.created_by,
      action: "monitoring_run_error",
      targetRef: enrollment.investigation_ref,
      result: "failure",
      detail: { enrollmentId: enrollment.id, error: error instanceof Error ? error.message : String(error) },
    });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[monitoringScheduler] Failed to record error run:", e);
  } finally {
    client.release();
  }
}

export async function processDueMonitoringEnrollments(limit = MAX_BATCH_SIZE): Promise<{
  processed: number;
  changed: number;
  alertsRaised: number;
  errors: number;
}> {
  const pool = await getPgPool();
  if (!pool) return { processed: 0, changed: 0, alertsRaised: 0, errors: 0 };

  let processed = 0;
  let changed = 0;
  let alertsRaised = 0;
  let errors = 0;

  for (let i = 0; i < Math.max(1, Math.min(limit, MAX_BATCH_SIZE)); i++) {
    const client = await pool.connect();
    // Alerts committed in this iteration, fanned out after COMMIT.
    let postCommit: { enrollment: EnrollmentRow; alerts: PendingAlert[] } | null = null;
    let pendingErrorRun: { enrollment: EnrollmentRow; error: unknown } | null = null;
    try {
      await client.query("BEGIN");
      const due = await client.query(
        `SELECT id, tenant_id, investigation_ref, subject_name, subject_identifiers, list_set, frequency, baseline_snapshot, created_by
         FROM monitoring_enrollments
         WHERE status = 'active' AND next_run_at <= now()
         ORDER BY next_run_at ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );
      if (due.rowCount !== 1) {
        await client.query("COMMIT");
        break;
      }
      const enrollment = due.rows[0] as EnrollmentRow;

      let snapshot: MonitoringSnapshot | null = null;
      try {
        snapshot = await runSubjectScreening(
          enrollment.subject_name,
          enrollment.subject_identifiers ?? {},
          enrollment.list_set,
        );
      } catch (screeningError) {
        // Fail-closed: roll back the claim transaction; the finally block
        // releases the client, then record an error run in a fresh transaction.
        await client.query("ROLLBACK").catch(() => undefined);
        pendingErrorRun = { enrollment, error: screeningError };
      }

      if (snapshot !== null) {
      const delta = diffSnapshots(enrollment.baseline_snapshot, snapshot);
      const result = delta.changed ? "change_detected" : "no_change";
      await client.query(
        `INSERT INTO monitoring_runs (enrollment_id, started_at, finished_at, result, snapshot)
         VALUES ($1, now(), now(), $2, $3::jsonb)`,
        [enrollment.id, result, JSON.stringify(snapshot)],
      );

      const alerts: PendingAlert[] = [];
      if (delta.changed) {
        for (const hit of delta.newHits) alerts.push({ alertType: "new_hit", severity: alertSeverity("new_hit", hit), delta: { hit } });
        for (const sc of delta.statusChanges) alerts.push({ alertType: "status_change", severity: alertSeverity("status_change", { list: sc.list, status: sc.to }), delta: { statusChange: sc } });
        for (const hit of delta.removedHits) alerts.push({ alertType: "removed_hit", severity: alertSeverity("removed_hit", hit), delta: { hit } });
        for (const alert of alerts) {
          await client.query(
            `INSERT INTO monitoring_alerts (tenant_id, enrollment_id, alert_type, severity, delta)
             VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [enrollment.tenant_id, enrollment.id, alert.alertType, alert.severity, JSON.stringify(alert.delta)],
          );
        }
        await writeMonitoringAuditLog(client, {
          tenantId: enrollment.tenant_id,
          userId: enrollment.created_by,
          action: "monitoring_change_detected",
          targetRef: enrollment.investigation_ref,
          result: "warning",
          detail: {
            enrollmentId: enrollment.id,
            newHits: delta.newHits.length,
            removedHits: delta.removedHits.length,
            statusChanges: delta.statusChanges.length,
          },
        });
      }

      await client.query(
        `UPDATE monitoring_enrollments
         SET baseline_snapshot = $2::jsonb, last_run_at = now(), next_run_at = $3, updated_at = now()
         WHERE id = $1 AND status = 'active'`,
        [enrollment.id, JSON.stringify(snapshot), nextRunAt(enrollment.frequency)],
      );
      await client.query("COMMIT");

      processed++;
      if (delta.changed) {
        changed++;
        postCommit = { enrollment, alerts };
      }
      }
    } catch (loopError) {
      // Never crash the loop on a per-enrollment failure.
      await client.query("ROLLBACK").catch(() => undefined);
      errors++;
      console.error("[monitoringScheduler] Enrollment processing failed:", loopError);
    } finally {
      client.release();
    }

    if (pendingErrorRun) {
      await recordErrorRun(pool, pendingErrorRun.enrollment, pendingErrorRun.error).catch(() => undefined);
      errors++;
    }

    if (postCommit) {
      const { enrollment, alerts } = postCommit;
      for (const alert of alerts) {
        await publishMonitoringEvent("MONITORING_ALERT", enrollment.investigation_ref, alert.severity, {
          enrollmentId: enrollment.id,
          tenantId: enrollment.tenant_id,
          subjectName: enrollment.subject_name,
          alertType: alert.alertType,
          ...alert.delta,
        });
        alertsRaised++;
      }
    }
  }

  return { processed, changed, alertsRaised, errors };
}

let interval: ReturnType<typeof setInterval> | undefined;

export function startMonitoringScheduler(): void {
  if (interval) return;
  console.log("[monitoringScheduler] Starting — polling every 60s for due enrollments");
  interval = setInterval(() => {
    void processDueMonitoringEnrollments().catch((error) => {
      console.error("[monitoringScheduler] Poll cycle failed:", error);
    });
  }, POLL_INTERVAL_MS);
  interval.unref?.();
}

export function stopMonitoringScheduler(): void {
  if (interval) clearInterval(interval);
  interval = undefined;
}
