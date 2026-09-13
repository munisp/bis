/**
 * Monitoring Scheduler
 *
 * Polls every 60 seconds for due active monitoring enrollments and executes
 * continuous re-screening via processDueMonitoringEnrollments. Claiming uses
 * FOR UPDATE SKIP LOCKED inside monitoring.ts, so multiple BFF replicas can
 * run this loop concurrently without double-screening an enrollment.
 *
 * Disabled by setting MONITORING_SCHEDULER_ENABLED=false; enabled by default.
 */
import { processDueMonitoringEnrollments } from "./monitoring";

const POLL_INTERVAL_MS = 60_000;

let _interval: ReturnType<typeof setInterval> | undefined;
let _running = false;

export function startMonitoringScheduler(): void {
  if (_interval) {
    console.warn("[MonitoringScheduler] Already started — skipping duplicate registration");
    return;
  }
  _interval = setInterval(() => {
    if (_running) return; // never overlap runs
    _running = true;
    void processDueMonitoringEnrollments()
      .catch((error) => {
        // The next durable poll retries; per-enrollment failures are already
        // recorded as result='error' run rows inside the processor.
        console.warn("[MonitoringScheduler] Poll failed:", error instanceof Error ? error.message : "unknown");
      })
      .finally(() => {
        _running = false;
      });
  }, POLL_INTERVAL_MS);
  // Do not keep the process alive solely for the scheduler.
  if (typeof _interval.unref === "function") _interval.unref();
  console.info("[MonitoringScheduler] Continuous re-screening loop scheduled — 60s poll for due enrollments");
}

export function stopMonitoringScheduler(): void {
  if (_interval) clearInterval(_interval);
  _interval = undefined;
}
