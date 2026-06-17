/**
 * vapidRotationReminder.ts
 * ========================
 * Periodic job that checks whether the VAPID public key has been in use for
 * more than ROTATION_THRESHOLD_DAYS (default 90). If so, it calls notifyOwner
 * with a reminder to rotate the keys, then waits another full cycle before
 * checking again.
 *
 * Rationale: Stale VAPID keys can cause silent push delivery failures across
 * browsers once they expire or are revoked. A 90-day rotation cadence aligns
 * with common WebPush best-practice recommendations.
 *
 * Scheduling: Runs once at server startup, then repeats every 24 hours. The
 * actual "is rotation due?" check is lightweight (reads one env var + one DB
 * row), so a daily cadence is fine.
 */

import { getDb } from "./db";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import { pushBroadcasts } from "../drizzle/schema";
import { desc } from "drizzle-orm";

/** How many days before we remind the owner to rotate VAPID keys. */
const ROTATION_THRESHOLD_DAYS = 90;

/** How often to re-check (24 hours). */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/**
 * Reads the VAPID key creation date from the `push_broadcasts` table.
 * We use the date of the *first* broadcast as a proxy for when VAPID keys
 * were first activated. If no broadcasts exist, we fall back to the server
 * start time (i.e., assume keys are fresh).
 */
async function getVapidKeyAge(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    // Use the oldest broadcast as a proxy for VAPID activation date
    const rows = await db
      .select({ sentAt: pushBroadcasts.sentAt })
      .from(pushBroadcasts)
      .orderBy(pushBroadcasts.sentAt) // ascending — oldest first
      .limit(1);
    if (rows.length === 0) return 0;
    const ageMs = Date.now() - new Date(rows[0].sentAt).getTime();
    return Math.floor(ageMs / (24 * 60 * 60 * 1_000)); // days
  } catch {
    return 0;
  }
}

/**
 * Runs the VAPID rotation check. If VAPID keys are configured and have been
 * in use for more than ROTATION_THRESHOLD_DAYS, sends an owner notification.
 */
export async function runVapidRotationCheck(): Promise<void> {
  // Only run if VAPID keys are actually configured
  const vapidPublicKey = (ENV as any).vapidPublicKey;
  if (!vapidPublicKey) {
    console.log("[VAPID Rotation] No VAPID public key configured — skipping check.");
    return;
  }

  const ageInDays = await getVapidKeyAge();

  if (ageInDays < ROTATION_THRESHOLD_DAYS) {
    console.log(
      `[VAPID Rotation] Keys are ${ageInDays} days old — no rotation needed ` +
      `(threshold: ${ROTATION_THRESHOLD_DAYS} days).`
    );
    return;
  }

  console.warn(
    `[VAPID Rotation] Keys are ${ageInDays} days old — sending rotation reminder.`
  );

  const sent = await notifyOwner({
    title: "⚠️ VAPID Key Rotation Reminder",
    content:
      `Your Web Push VAPID keys have been in use for approximately **${ageInDays} days** ` +
      `(threshold: ${ROTATION_THRESHOLD_DAYS} days).\n\n` +
      `Stale VAPID keys can cause silent push delivery failures across browsers. ` +
      `Please rotate your keys:\n\n` +
      `1. Go to **Admin → Settings → Push Notifications**\n` +
      `2. Click **Generate New VAPID Keypair**\n` +
      `3. Copy the new keys into your project **Secrets** (`+
      "`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`)\n" +
      `4. Restart the server — existing browser subscriptions will auto-renew ` +
      `via the \`pushsubscriptionchange\` service-worker handler.`,
  });

  if (sent) {
    console.log("[VAPID Rotation] Owner notification sent successfully.");
  } else {
    console.warn("[VAPID Rotation] Owner notification failed — will retry next cycle.");
  }
}

/**
 * Starts the VAPID rotation reminder scheduler.
 * Runs an initial check after a short startup delay, then repeats every 24 h.
 */
export function startVapidRotationReminderScheduler(): void {
  // Delay first run by 5 minutes to let the server fully start
  const STARTUP_DELAY_MS = 5 * 60 * 1_000;

  console.log(
    `[VAPID Rotation] Scheduler started — first check in ${STARTUP_DELAY_MS / 60_000} min, ` +
    `then every ${CHECK_INTERVAL_MS / 3_600_000}h.`
  );

  setTimeout(async () => {
    try {
      await runVapidRotationCheck();
    } catch (err) {
      console.error("[VAPID Rotation] Initial check failed:", err);
    }
    // Repeat every 24 hours
    setInterval(async () => {
      try {
        await runVapidRotationCheck();
      } catch (err) {
        console.error("[VAPID Rotation] Scheduled check failed:", err);
      }
    }, CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}
