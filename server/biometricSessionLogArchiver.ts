/**
 * Biometric Session Log Archiver
 *
 * Runs weekly (Sunday 03:00 UTC — low-traffic window for Nigerian banking hours).
 * Moves biometric_session_logs rows older than 90 days to a cold S3 prefix
 * (biometric-archive/YYYY/MM/), then deletes the DB rows to keep the hot table lean.
 *
 * Architecture note (ISO 30107-3 / NFIU compliance):
 *   - Hot table (DB):   last 90 days — fast dashboard queries
 *   - Cold archive (S3): older records — available for regulatory audit on demand
 *   - Retention:        S3 lifecycle policy should retain cold archives for 7 years
 *
 * Mirrors the pattern in archivalScheduler.ts / archival.ts.
 */

import { schedule, validate, type ScheduledTask } from "node-cron";
import { lt, and } from "drizzle-orm";
import { getDb } from "./db";
import { biometricSessionLogs } from "../drizzle/schema";
import { storagePut } from "./storage";

const COLD_CUTOFF_DAYS = 90;
const BATCH_SIZE = 1000;

let _archiverTask: ScheduledTask | null = null;

// ── Core archival job ────────────────────────────────────────────────────────

export async function runBiometricSessionLogArchival(): Promise<{
  archived: number;
  deleted: number;
  skipped: number;
  errors: string[];
}> {
  const db = await getDb();
  if (!db) {
    console.warn("[BiometricArchiver] DB unavailable — skipping archival run");
    return { archived: 0, deleted: 0, skipped: 0, errors: ["DB unavailable"] };
  }

  const cutoff = new Date(Date.now() - COLD_CUTOFF_DAYS * 24 * 3_600_000);
  let archived = 0;
  let deleted = 0;
  let skipped = 0;
  const errors: string[] = [];

  console.info(`[BiometricArchiver] Starting archival — cutoff: ${cutoff.toISOString()}`);

  // Process in batches to avoid memory pressure
  let hasMore = true;
  while (hasMore) {
    // Fetch a batch of old rows
    const rows = await db
      .select()
      .from(biometricSessionLogs)
      .where(lt(biometricSessionLogs.createdAt, cutoff))
      .limit(BATCH_SIZE);

    if (rows.length === 0) {
      hasMore = false;
      break;
    }

    // Group by year/month for S3 prefix organisation
    const byMonth: Record<string, typeof rows> = {};
    for (const row of rows) {
      const dt = row.createdAt ?? new Date(0);
      const key = `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(row);
    }

    // Upload each month-group as a NDJSON file to cold S3
    for (const [monthKey, monthRows] of Object.entries(byMonth)) {
      try {
        const ndjson = monthRows.map(r => JSON.stringify(r)).join("\n");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const s3Key = `biometric-archive/${monthKey}/session-logs-${timestamp}-${Math.random().toString(36).slice(2, 8)}.ndjson`;
        await storagePut(s3Key, Buffer.from(ndjson, "utf-8"), "application/x-ndjson");
        archived += monthRows.length;
      } catch (err) {
        const msg = `Failed to archive ${monthKey}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[BiometricArchiver] ${msg}`);
        errors.push(msg);
        // Skip deletion for this batch if S3 upload failed — data safety first
        skipped += monthRows.length;
        continue;
      }
    }

    // Delete successfully archived rows
    const archivedIds = rows
      .filter(r => !errors.some(e => e.includes("Failed to archive")))
      .map(r => r.id);

    if (archivedIds.length > 0) {
      // Delete in sub-batches of 200 to stay within SQL parameter limits
      for (let i = 0; i < archivedIds.length; i += 200) {
        const chunk = archivedIds.slice(i, i + 200);
        try {
          // Use a raw delete with IN clause
          await db.delete(biometricSessionLogs).where(
            // Drizzle inArray helper
            (await import("drizzle-orm")).inArray(biometricSessionLogs.id, chunk)
          );
          deleted += chunk.length;
        } catch (err) {
          const msg = `Delete chunk failed: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`[BiometricArchiver] ${msg}`);
          errors.push(msg);
        }
      }
    }

    // If we got fewer rows than BATCH_SIZE, we're done
    if (rows.length < BATCH_SIZE) hasMore = false;
  }

  console.info(
    `[BiometricArchiver] Archival complete — archived: ${archived}, deleted: ${deleted}, skipped: ${skipped}, errors: ${errors.length}`
  );

  return { archived, deleted, skipped, errors };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

/**
 * startBiometricSessionLogArchiver — registers the weekly cron job.
 * Called once at server startup, after the HTTP server is listening.
 *
 * Schedule: "0 3 * * 0" = 03:00 UTC every Sunday
 */
export function startBiometricSessionLogArchiver(): void {
  if (_archiverTask) {
    console.warn("[BiometricArchiver] Already started — skipping duplicate registration");
    return;
  }

  const CRON_EXPR = "0 3 * * 0"; // 03:00 UTC every Sunday
  if (!validate(CRON_EXPR)) {
    console.error("[BiometricArchiver] Invalid cron expression — archiver will not run");
    return;
  }

  _archiverTask = schedule(
    CRON_EXPR,
    async () => {
      try {
        await runBiometricSessionLogArchival();
      } catch (err) {
        console.error("[BiometricArchiver] Unhandled error in archival job:", err);
      }
    },
    {
      timezone: "UTC",
      name: "weekly-biometric-archival",
      noOverlap: true,
    }
  );

  const nextRun = _archiverTask.getNextRun();
  console.info(
    `[BiometricArchiver] Weekly archival scheduled — runs at 03:00 UTC every Sunday` +
    (nextRun ? ` (next run: ${nextRun.toISOString()})` : "") +
    ` | hot→cold: ${COLD_CUTOFF_DAYS}d cutoff, cold prefix: s3://biometric-archive/`
  );
}

/**
 * stopBiometricSessionLogArchiver — gracefully stops the scheduler.
 * Called during server shutdown.
 */
export function stopBiometricSessionLogArchiver(): void {
  if (_archiverTask) {
    _archiverTask.stop();
    _archiverTask = null;
    console.info("[BiometricArchiver] Scheduler stopped");
  }
}
