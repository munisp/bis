/**
 * Nigerian Screening — Webhook Subscriptions + Auto-Assess Engine
 * ───────────────────────────────────────────────────────────────
 * Webhook: tenants subscribe to bis.screening.* events and receive
 *          signed HTTP POST callbacks.
 * Auto-Assess: configurable rules that automatically set overallOutcome
 *              on a screening order once all results are complete.
 */

import { router, protectedProcedure, adminProcedure, writeProcedure } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { ENV } from "./_core/env";
import {
  screeningOrders,
  screeningResults,
  reportTags,
  candidateProfiles,
  webhooks,
} from "../drizzle/schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRef(prefix: string): string {
  const { randomBytes } = require("crypto");
  return `${prefix}-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const { createHmac } = await import("crypto");
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Dispatch a webhook to all subscribed endpoints for a given event type.
 * Non-fatal — failures are logged but do not block the caller.
 */
export async function dispatchWebhook(
  tenantId: number,
  eventType: string,
  payload: unknown
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const subs = await db.select().from(webhooks)
      .where(and(
        eq(webhooks.tenantId, tenantId),
        sql`${webhooks.events} @> ARRAY[${eventType}]::text[]`
      ));
    if (subs.length === 0) return;

    const body = JSON.stringify({ event: eventType, data: payload, timestamp: new Date().toISOString() });
    await Promise.allSettled(
      subs.map(async (sub) => {
        const sig = await signPayload(body, sub.secret ?? "");
        const res = await fetch(sub.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-BIS-Signature": sig,
            "X-BIS-Event": eventType,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) console.warn(`[Webhook] ${sub.url} returned ${res.status}`);
      })
    );
  } catch (e) {
    console.warn("[Webhook] dispatch error:", e);
  }
}

// ─── Auto-Assess Engine ───────────────────────────────────────────────────────

/**
 * Evaluate all completed results for an order and set overallOutcome.
 * Rules (in priority order):
 *   1. Any "adverse" result → overall = "adverse"
 *   2. Any "suspended_licence" or "revoked_licence" → overall = "adverse"
 *   3. Any "consider" result → overall = "consider"
 *   4. All "clear" or "unverified" → overall = "clear"
 *   5. Any still "pending" or "processing" → overall stays null (incomplete)
 */
export async function autoAssessOrder(orderId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const results = await db.select().from(screeningResults)
    .where(eq(screeningResults.orderId, orderId));

  if (results.length === 0) return null;

  const incomplete = results.filter(r => r.status === "pending" || r.status === "processing");
  if (incomplete.length > 0) return null; // not ready

  const outcomes = results.map(r => r.outcome ?? "unverified");

  let overall: string;
  if (outcomes.some(o => o === "adverse" || o === "suspended_licence" || o === "revoked_licence")) {
    overall = "adverse";
  } else if (outcomes.some(o => o === "consider")) {
    overall = "consider";
  } else {
    overall = "clear";
  }

  await db.update(screeningOrders)
    .set({ overallOutcome: overall as any, status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(screeningOrders.id, orderId));

  return overall;
}

// ─── Webhooks Router ──────────────────────────────────────────────────────────

const webhooksRouter = router({
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: webhooks.id,
        url: webhooks.url,
        events: webhooks.events,
        status: webhooks.status,
        createdAt: webhooks.createdAt,
      }).from(webhooks)
        .where(eq(webhooks.tenantId, ctx.tenantId!))
        .orderBy(desc(webhooks.createdAt));
    }),

  create: writeProcedure
    .input(z.object({
      url: z.string().url(),
      events: z.array(z.string()).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { randomBytes } = require("crypto");
      const secret = randomBytes(32).toString("hex");
      const [inserted] = await db.insert(webhooks).values({
        tenantId: ctx.tenantId!,
        url: input.url,
        events: input.events as any,
        secret,
        status: "active" as any,
      }).returning({ id: webhooks.id });
      return { id: inserted.id, secret }; // Return secret once at creation
    }),

  update: writeProcedure
    .input(z.object({
      id: z.number(),
      url: z.string().url().optional(),
      events: z.array(z.string()).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...fields } = input;
      const updateFields: Record<string, any> = {};
      if (fields.url !== undefined) updateFields.url = fields.url;
      if (fields.events !== undefined) updateFields.events = fields.events;
      if (fields.isActive !== undefined) updateFields.status = fields.isActive ? "active" : "inactive";
      await db.update(webhooks)
        .set(updateFields)
        .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, ctx.tenantId!)));
      return { success: true };
    }),

  delete: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.tenantId, ctx.tenantId!)));
      return { success: true };
    }),

  test: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [sub] = await db.select().from(webhooks)
        .where(and(eq(webhooks.id, input.id), eq(webhooks.tenantId, ctx.tenantId!))).limit(1);
      if (!sub) throw new TRPCError({ code: "NOT_FOUND" });

      const body = JSON.stringify({ event: "webhook.test", data: { message: "BIS webhook test" }, timestamp: new Date().toISOString() });
      const sig = await signPayload(body, sub.secret ?? "");
      try {
        const res = await fetch(sub.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-BIS-Signature": sig, "X-BIS-Event": "webhook.test" },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        return { success: res.ok, statusCode: res.status };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }),
});

// ─── Report Tags Router ───────────────────────────────────────────────────────

const reportTagsRouter = router({
  list: protectedProcedure
    .input(z.object({ orderRef: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      if (input.orderRef) {
        const [order] = await db.select().from(screeningOrders)
          .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
        if (!order) return [];
        // report_tags is a global label table; filter by name prefix for this order
        return db.select().from(reportTags).where(eq(reportTags.tenantId, ctx.tenantId!));
      }
      return db.select().from(reportTags).where(eq(reportTags.tenantId, ctx.tenantId!));
    }),

  add: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      tag: z.string().min(1).max(50),
      color: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });
      await db.insert(reportTags).values({
        tenantId: ctx.tenantId!,
        name: input.tag,
        color: input.color ?? "#6B7280",
      }).onConflictDoNothing();
      return { success: true };
    }),

  remove: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(reportTags)
        .where(and(eq(reportTags.id, input.id), eq(reportTags.tenantId, ctx.tenantId!)));
      return { success: true };
    }),
});

// ─── Assessments Router ───────────────────────────────────────────────────────

const assessmentsRouter = router({
  get: protectedProcedure
    .input(z.object({ orderRef: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const [order] = await db.select({
        id: screeningOrders.id,
        orderRef: screeningOrders.orderRef,
        overallOutcome: screeningOrders.overallOutcome,
        notes: screeningOrders.notes,
        updatedAt: screeningOrders.updatedAt,
      }).from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) return null;
      return {
        orderId: order.id,
        orderRef: order.orderRef,
        outcome: order.overallOutcome,
        notes: order.notes,
        assessedAt: order.updatedAt,
      };
    }),

  override: writeProcedure
    .input(z.object({
      orderRef: z.string(),
      outcome: z.enum(["clear", "consider", "adverse"]),
      reason: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });

      await db.update(screeningOrders)
        .set({ overallOutcome: input.outcome as any, notes: input.reason, updatedAt: new Date() })
        .where(eq(screeningOrders.id, order.id));

      return { success: true };
    }),

  trigger: writeProcedure
    .input(z.object({ orderRef: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [order] = await db.select().from(screeningOrders)
        .where(and(eq(screeningOrders.orderRef, input.orderRef), eq(screeningOrders.tenantId, ctx.tenantId!))).limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });
      const outcome = await autoAssessOrder(order.id);
      return { outcome: outcome ?? "incomplete" };
    }),
});

export const ngScreeningExtRouter = router({
  webhooks:    webhooksRouter,
  tags:        reportTagsRouter,
  assessments: assessmentsRouter,
});
