/**
 * SLA Breach Checker
 *
 * Runs on a 15-minute cron schedule (started from server/_core/index.ts).
 * For each investigation whose dueAt is within the next 1 hour and status
 * is not 'completed' or 'archived', it:
 *   1. Creates a critical alert in the database (if one hasn't been created yet today).
 *   2. Sends an Expo push notification to every user who has a registered push token.
 *
 * The "already notified today" guard uses the audit_log table to avoid duplicate
 * alerts on repeated cron runs.
 */

import { getDb } from "./db";
import { investigations, alerts, users } from "../drizzle/schema";
import { and, lte, gte, ne, eq, sql } from "drizzle-orm";

// ─── Expo Push API ────────────────────────────────────────────────────────────

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: "default" | "normal" | "high";
  sound?: "default" | null;
}

async function sendExpoPushNotifications(messages: ExpoPushMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error("[SLA Checker] Failed to send push notifications:", err);
  }
}

// ─── Core breach detection ────────────────────────────────────────────────────

export interface SlaBreachResult {
  checked: number;
  breaches: number;
  alertsCreated: number;
  notificationsSent: number;
}

export async function checkSlaBreaches(): Promise<SlaBreachResult> {
  const db = await getDb();
  if (!db) return { checked: 0, breaches: 0, alertsCreated: 0, notificationsSent: 0 };

  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 60_000); // 1 hour from now

  // Find investigations breaching SLA within the next hour
  const breachingInvs = await db
    .select({
      id: investigations.id,
      ref: investigations.ref,
      subjectName: investigations.subjectName,
      dueAt: investigations.dueAt,
      priority: investigations.priority,
      status: investigations.status,
    })
    .from(investigations)
    .where(
      and(
        lte(investigations.dueAt, horizon),
        gte(investigations.dueAt, now),
        ne(investigations.status, "completed" as any),
        ne(investigations.status, "archived" as any),
      )
    );

  if (breachingInvs.length === 0) {
    return { checked: 0, breaches: 0, alertsCreated: 0, notificationsSent: 0 };
  }

  // Collect all user push tokens
  const allUsers = await db
    .select({ pushToken: users.pushToken })
    .from(users)
    .where(sql`${users.pushToken} IS NOT NULL`);
  const pushTokens = allUsers.map((u) => u.pushToken!).filter(Boolean);

  let alertsCreated = 0;
  let notificationsSent = 0;
  const pushMessages: ExpoPushMessage[] = [];

  for (const inv of breachingInvs) {
    // Guard: check if a breach alert was already created in the last 2 hours
    const recentAlert = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.subjectRef, inv.ref),
          eq(alerts.sourceService, "sla-checker"),
          gte(alerts.createdAt, new Date(now.getTime() - 2 * 3_600_000))
        )
      )
      .limit(1);

    if (recentAlert.length > 0) continue; // Already notified recently

    const minutesLeft = Math.round((inv.dueAt!.getTime() - now.getTime()) / 60_000);
    const title = `⏰ SLA Breach Imminent: ${inv.ref}`;
    const body = `Investigation for "${inv.subjectName}" expires in ${minutesLeft} min. Priority: ${inv.priority?.toUpperCase()}.`;

    // Create alert in DB
    await db.insert(alerts).values({
      title,
      body,
      type: "system" as any,
      severity: "critical" as any,
      subjectRef: inv.ref,
      sourceService: "sla-checker",
      read: false,
      acknowledged: false,
      resolved: false,
      dismissed: false,
    });
    alertsCreated++;

    // Queue push notification
    for (const token of pushTokens) {
      pushMessages.push({
        to: token,
        title,
        body,
        data: { type: "investigation", id: inv.ref },
        priority: "high",
        sound: "default",
      });
    }
  }

  if (pushMessages.length > 0) {
    // Expo push API accepts up to 100 messages per request
    const chunks: ExpoPushMessage[][] = [];
    for (let i = 0; i < pushMessages.length; i += 100) {
      chunks.push(pushMessages.slice(i, i + 100));
    }
    for (const chunk of chunks) {
      await sendExpoPushNotifications(chunk);
      notificationsSent += chunk.length;
    }
  }

  console.log(
    `[SLA Checker] ${breachingInvs.length} breach(es) found, ${alertsCreated} alert(s) created, ${notificationsSent} push notification(s) sent.`
  );

  return {
    checked: breachingInvs.length,
    breaches: breachingInvs.length,
    alertsCreated,
    notificationsSent,
  };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

const INTERVAL_MS = 15 * 60_000; // 15 minutes

export function startSlaBreachScheduler(): void {
  console.log("[SLA Checker] Scheduler started — runs every 15 minutes.");
  // Run immediately on startup, then on interval
  checkSlaBreaches().catch((err) =>
    console.error("[SLA Checker] Initial run failed:", err)
  );
  setInterval(() => {
    checkSlaBreaches().catch((err) =>
      console.error("[SLA Checker] Scheduled run failed:", err)
    );
  }, INTERVAL_MS);
}
