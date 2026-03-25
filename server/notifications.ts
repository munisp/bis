/**
 * Notifications Router
 * Manages Expo push device token registration and server-initiated push delivery.
 * Uses the Expo Push Notification API (https://exp.host/--/api/v2/push/send).
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { pushDeviceTokens } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

async function sendExpoPush(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.error("[Expo Push] HTTP error:", res.status, await res.text());
      return messages.map(() => ({ status: "error" as const, message: `HTTP ${res.status}` }));
    }
    const json = await res.json() as { data: ExpoPushTicket[] };
    return json.data;
  } catch (err) {
    console.error("[Expo Push] Network error:", err);
    return messages.map(() => ({ status: "error" as const, message: "Network error" }));
  }
}

export const notificationsRouter = router({
  /**
   * Register or update an Expo push token for the authenticated user's device.
   * Called automatically by the bis-mobile app on startup.
   */
  registerPushToken: protectedProcedure
    .input(
      z.object({
        token: z.string().min(10).max(500),
        platform: z.enum(["ios", "android"]).default("ios"),
        deviceName: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Upsert: if token already exists for this user, update; otherwise insert
      const existing = await db
        .select()
        .from(pushDeviceTokens)
        .where(eq(pushDeviceTokens.token, input.token))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(pushDeviceTokens)
          .set({
            userId: ctx.user.id,
            platform: input.platform,
            deviceName: input.deviceName,
            active: true,
            updatedAt: new Date(),
          })
          .where(eq(pushDeviceTokens.token, input.token));
      } else {
        await db.insert(pushDeviceTokens).values({
          userId: ctx.user.id,
          token: input.token,
          platform: input.platform,
          deviceName: input.deviceName,
          active: true,
        });
      }

      return { success: true };
    }),

  /**
   * Deregister a push token (called on logout or token refresh).
   */
  deregisterPushToken: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      await db
        .update(pushDeviceTokens)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(pushDeviceTokens.token, input.token),
            eq(pushDeviceTokens.userId, ctx.user.id)
          )
        );

      return { success: true };
    }),

  /**
   * List all registered push tokens for the authenticated user.
   */
  listMyTokens: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");

    return db
      .select({
        id: pushDeviceTokens.id,
        platform: pushDeviceTokens.platform,
        deviceName: pushDeviceTokens.deviceName,
        active: pushDeviceTokens.active,
        createdAt: pushDeviceTokens.createdAt,
      })
      .from(pushDeviceTokens)
      .where(
        and(
          eq(pushDeviceTokens.userId, ctx.user.id),
          eq(pushDeviceTokens.active, true)
        )
      );
  }),

  /**
   * Admin: send a push notification to all active tokens for a specific user.
   * Used by backend jobs (e.g., alert triggers, investigation status changes).
   */
  sendToUser: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        title: z.string().min(1).max(255),
        body: z.string().min(1).max(1000),
        data: z.record(z.string(), z.unknown()).optional(),
        channelId: z.enum(["bis-alerts", "bis-investigations"]).default("bis-alerts"),
        priority: z.enum(["default", "normal", "high"]).default("high"),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const tokens = await db
        .select({ token: pushDeviceTokens.token, platform: pushDeviceTokens.platform })
        .from(pushDeviceTokens)
        .where(
          and(
            eq(pushDeviceTokens.userId, input.userId),
            eq(pushDeviceTokens.active, true)
          )
        );

      if (tokens.length === 0) {
        return { sent: 0, tickets: [] };
      }

      const messages: ExpoPushMessage[] = tokens.map((t) => ({
        to: t.token,
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        sound: "default",
        channelId: t.platform === "android" ? input.channelId : undefined,
        priority: input.priority,
      }));

      const tickets = await sendExpoPush(messages);
      const successCount = tickets.filter((t) => t.status === "ok").length;

      return { sent: successCount, total: tokens.length, tickets };
    }),

  /**
   * Admin: broadcast a push notification to all active device tokens.
   * Use sparingly — for critical system-wide alerts only.
   */
  broadcast: adminProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255),
        body: z.string().min(1).max(1000),
        data: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const tokens = await db
        .select({ token: pushDeviceTokens.token, platform: pushDeviceTokens.platform })
        .from(pushDeviceTokens)
        .where(eq(pushDeviceTokens.active, true));

      if (tokens.length === 0) return { sent: 0, total: 0 };

      // Batch in groups of 100 (Expo API limit per request)
      const BATCH_SIZE = 100;
      let totalSent = 0;
      for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batch = tokens.slice(i, i + BATCH_SIZE);
        const messages: ExpoPushMessage[] = batch.map((t) => ({
          to: t.token,
          title: input.title,
          body: input.body,
          data: input.data ?? {},
          sound: "default",
          channelId: t.platform === "android" ? "bis-alerts" : undefined,
          priority: "high",
        }));
        const tickets = await sendExpoPush(messages);
        totalSent += tickets.filter((t) => t.status === "ok").length;
      }

      return { sent: totalSent, total: tokens.length };
    }),
});
