/**
 * Archival Scheduler
 *
 * Wires the nightly archival job to a node-cron schedule.
 * Runs at 02:00 UTC every day — low-traffic window for Nigerian banking hours.
 *
 * Lesson from 1B payments architecture:
 *   "Schedule archival during off-peak hours. Nigerian banking peak is 08:00–20:00 WAT
 *    (07:00–19:00 UTC). 02:00 UTC = 03:00 WAT — safe maintenance window."
 */
import { schedule, validate, type ScheduledTask } from "node-cron";
import { runArchivalJob } from "./archival";

let _archivalTask: ScheduledTask | null = null;

/**
 * startArchivalScheduler — registers the nightly cron job.
 * Called once at server startup, after the HTTP server is listening.
 *
 * Schedule: "0 2 * * *" = 02:00 UTC every day
 */
export function startArchivalScheduler(): void {
  if (_archivalTask) {
    console.warn("[ArchivalScheduler] Already started — skipping duplicate registration");
    return;
  }

  const CRON_EXPR = "0 2 * * *";

  // Validate cron expression before registering
  if (!validate(CRON_EXPR)) {
    console.error("[ArchivalScheduler] Invalid cron expression — archival will not run");
    return;
  }

  _archivalTask = schedule(
    CRON_EXPR,
    async () => {
      try {
        await runArchivalJob();
      } catch (err) {
        console.error("[ArchivalScheduler] Unhandled error in archival job:", err);
      }
    },
    {
      timezone: "UTC",
      name: "nightly-archival",
      noOverlap: true, // Don't start a new run if the previous one is still running
    }
  );

  const nextRun = _archivalTask.getNextRun();
  console.info(
    `[ArchivalScheduler] Nightly archival job scheduled — runs at 02:00 UTC daily` +
    (nextRun ? ` (next run: ${nextRun.toISOString()})` : "") +
    " | hot→warm: 90d cutoff, warm→cold: 365d cutoff"
  );
}

/**
 * stopArchivalScheduler — stops the cron job (used in tests / graceful shutdown).
 */
export function stopArchivalScheduler(): void {
  if (_archivalTask) {
    _archivalTask.stop();
    _archivalTask = null;
    console.info("[ArchivalScheduler] Stopped");
  }
}
