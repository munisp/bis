/**
 * pushNotify.ts — Server-side push notification delivery
 *
 * Supports two transports:
 *   1. FCM Legacy HTTP API  (platform = 'fcm', FCM_SERVER_KEY set)
 *   2. Web Push / VAPID     (platform = 'webpush', VAPID keys set)
 *
 * Usage:
 *   import { sendPushToUser } from "./pushNotify";
 *   await sendPushToUser(userId, { title: "Alert", body: "New critical alert" });
 */

import webpush from "web-push";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { pushSubscriptions } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

export interface PushPayload {
  title: string;
  body: string;
  /** Optional deep-link path, e.g. "/alerts/42" */
  url?: string;
  /** Optional icon URL */
  icon?: string;
  /** Optional badge count */
  badge?: number;
  /** Optional tag for notification grouping/replacement */
  tag?: string;
}

// ── VAPID initialisation (Web Push) ──────────────────────────────────────────
// Only initialise if VAPID keys are present; otherwise Web Push is silently
// disabled and FCM-only mode is used.
let vapidInitialised = false;
function ensureVapid() {
  if (vapidInitialised) return;
  if (!ENV.vapidPublicKey || !ENV.vapidPrivateKey) return;
  webpush.setVapidDetails(
    ENV.vapidSubject,
    ENV.vapidPublicKey,
    ENV.vapidPrivateKey,
  );
  vapidInitialised = true;
}

// ── FCM Legacy HTTP API ───────────────────────────────────────────────────────
async function sendFcm(token: string, payload: PushPayload): Promise<boolean> {
  if (!ENV.fcmServerKey) return false;
  try {
    const res = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `key=${ENV.fcmServerKey}`,
      },
      body: JSON.stringify({
        to: token,
        notification: {
          title: payload.title,
          body: payload.body,
          icon: payload.icon ?? "/favicon.ico",
          badge: payload.badge,
          tag: payload.tag,
          click_action: payload.url ?? "/",
        },
        data: payload.url ? { url: payload.url } : undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json() as { success?: number; failure?: number; results?: Array<{ error?: string }> };
    // FCM returns success:1 on delivery; failure:1 + error on invalid token
    if (json.failure && json.results?.[0]?.error === "NotRegistered") {
      return false; // caller should deactivate this token
    }
    return res.ok && (json.success ?? 0) > 0;
  } catch {
    return false;
  }
}

// ── Web Push (VAPID) ──────────────────────────────────────────────────────────
async function sendWebPush(
  endpoint: string,
  p256dh: string | null,
  auth: string | null,
  payload: PushPayload,
): Promise<boolean> {
  ensureVapid();
  if (!vapidInitialised) return false;
  if (!p256dh || !auth) return false;
  try {
    await webpush.sendNotification(
      { endpoint, keys: { p256dh, auth } },
      JSON.stringify({ title: payload.title, body: payload.body, url: payload.url, tag: payload.tag }),
      { TTL: 86400 },
    );
    return true;
  } catch (err: any) {
    // 410 Gone = subscription expired; signal caller to deactivate
    if (err?.statusCode === 410) return false;
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Delivers a push notification to all active subscriptions for a given user.
 * Automatically deactivates tokens that are reported as invalid/expired.
 *
 * @returns Object with counts: { sent, failed, deactivated }
 */
export async function sendPushToUser(
  userId: number,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; deactivated: number }> {
  const db = await getDb();
  if (!db) return { sent: 0, failed: 0, deactivated: 0 };

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.active, true)));

  let sent = 0;
  let failed = 0;
  let deactivated = 0;

  for (const sub of subs) {
    let ok = false;

    if (sub.platform === "fcm") {
      ok = await sendFcm(sub.token, payload);
    } else if (sub.platform === "webpush") {
      ok = await sendWebPush(sub.token, sub.p256dh, sub.auth, payload);
    }

    if (ok) {
      sent++;
    } else {
      failed++;
      // Deactivate the subscription so we don't keep hitting dead tokens
      await db
        .update(pushSubscriptions)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(pushSubscriptions.id, sub.id));
      deactivated++;
    }
  }

  return { sent, failed, deactivated };
}

/**
 * Broadcast a push notification to multiple users at once.
 * Useful for system-wide alerts (e.g., sanctions list update).
 */
export async function broadcastPush(
  userIds: number[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number; deactivated: number }> {
  let total = { sent: 0, failed: 0, deactivated: 0 };
  for (const uid of userIds) {
    const r = await sendPushToUser(uid, payload);
    total.sent += r.sent;
    total.failed += r.failed;
    total.deactivated += r.deactivated;
  }
  return total;
}
