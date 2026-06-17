/**
 * Broadcast Scheduler
 * Heartbeat job that checks for overdue scheduled broadcasts every minute
 * and dispatches them via the push notification system.
 */

import { eq, and, lte } from "drizzle-orm";
import { getDb } from "./db";
import { scheduledBroadcasts, pushSubscriptions, pushBroadcasts } from "../drizzle/schema";
import { broadcastPush } from "./pushNotify";

const POLL_INTERVAL_MS = 60_000; // 1 minute

/**
 * Dispatch all scheduled broadcasts whose scheduledAt <= now() and status = 'scheduled'.
 * Returns the number of broadcasts dispatched.
 */
export async function runScheduledBroadcastDispatch(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const now = Date.now();

  // Fetch all overdue scheduled broadcasts
  const overdue = await db
    .select()
    .from(scheduledBroadcasts)
    .where(
      and(
        eq(scheduledBroadcasts.status, "scheduled"),
        lte(scheduledBroadcasts.scheduledAt, now),
      ),
    )
    .limit(50); // process at most 50 per tick to avoid overload

  if (overdue.length === 0) return 0;

  let dispatched = 0;

  for (const job of overdue) {
    try {
      // Mark as sent immediately to prevent double-dispatch (optimistic lock)
      const updated = await db
        .update(scheduledBroadcasts)
        .set({ status: "sent", dispatchedAt: Date.now(), updatedAt: new Date() })
        .where(
          and(
            eq(scheduledBroadcasts.id, job.id),
            eq(scheduledBroadcasts.status, "scheduled"),
          ),
        )
        .returning();

      if (!updated.length) {
        // Another process already claimed this job — skip
        continue;
      }

      // Collect distinct active subscriber user IDs
      const rows = await db
        .selectDistinct({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.active, true));
      const userIds = rows.map((r) => r.userId);

      // Dispatch the broadcast
      const result = await broadcastPush(userIds, {
        title: job.title,
        body: job.body,
        url: job.url ?? undefined,
        tag: job.tag ?? undefined,
      });

      // Persist broadcast record and link it
      try {
        const [bcRow] = await db
          .insert(pushBroadcasts)
          .values({
            title: job.title,
            body: job.body,
            url: job.url ?? null,
            tag: job.tag ?? null,
            sentCount: result.sent,
            failedCount: result.failed,
            deactivatedCount: result.deactivated,
            createdBy: job.createdBy ?? null,
            sentAt: new Date(),
          })
          .returning();
        if (bcRow?.id) {
          await db
            .update(scheduledBroadcasts)
            .set({ broadcastId: bcRow.id })
            .where(eq(scheduledBroadcasts.id, job.id));
        }
      } catch {
        // Persistence is best-effort — don't fail the dispatch
      }

      dispatched++;
      console.log(
        `[BroadcastScheduler] Dispatched scheduled broadcast #${job.id} "${job.title}" — sent: ${result.sent}, failed: ${result.failed}`,
      );
    } catch (err) {
      console.error(
        `[BroadcastScheduler] Failed to dispatch scheduled broadcast #${job.id}:`,
        err,
      );
      // Leave as 'scheduled' so it retries next tick
    }
  }

  return dispatched;
}

/**
 * Start the broadcast scheduler heartbeat.
 * Polls every POLL_INTERVAL_MS for overdue scheduled broadcasts.
 */
export function startBroadcastScheduler(): void {
  // Initial run after a short startup delay
  setTimeout(async () => {
    try {
      const n = await runScheduledBroadcastDispatch();
      if (n > 0) console.log(`[BroadcastScheduler] Initial dispatch: ${n} broadcast(s) sent`);
    } catch (err) {
      console.error("[BroadcastScheduler] Initial dispatch error:", err);
    }

    // Recurring poll
    setInterval(async () => {
      try {
        const n = await runScheduledBroadcastDispatch();
        if (n > 0) console.log(`[BroadcastScheduler] Dispatched ${n} scheduled broadcast(s)`);
      } catch (err) {
        console.error("[BroadcastScheduler] Poll error:", err);
      }
    }, POLL_INTERVAL_MS);
  }, 10_000); // 10s startup delay
}
