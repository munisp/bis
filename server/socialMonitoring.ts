/**
 * BIS Social Monitoring Router
 * ==============================
 * Full CRUD for social monitor configurations and mentions.
 * Integrates with the Python risk engine for sentiment analysis.
 */
import { z } from "zod";
import { eq, desc, and, sql, count, gte, ilike, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, writeProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { socialMonitorConfigs, socialMentions } from "../drizzle/schema";

export const socialMonitoringRouter = router({
  // ─── Monitor Configs ───────────────────────────────────────────────────────

  listMonitors: protectedProcedure
    .input(z.object({
      isActive: z.boolean().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.isActive !== undefined) conditions.push(eq(socialMonitorConfigs.isActive, input.isActive));

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(socialMonitorConfigs)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(socialMonitorConfigs.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() }).from(socialMonitorConfigs)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);

      return { monitors: rows, total };
    }),

  getMonitor: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [monitor] = await db.select().from(socialMonitorConfigs).where(eq(socialMonitorConfigs.id, input.id));
      if (!monitor) throw new TRPCError({ code: "NOT_FOUND", message: "Monitor not found" });
      return monitor;
    }),

  createMonitor: writeProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      keywords: z.array(z.string()).min(1),
      platforms: z.array(z.enum(["twitter", "facebook", "instagram", "tiktok", "linkedin", "news", "whatsapp_group", "youtube"])).min(1),
      subjectRef: z.string().optional(),
      investigationRef: z.string().optional(),
      alertThreshold: z.number().min(0).max(100).default(60),
      tenantId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [monitor] = await db.insert(socialMonitorConfigs).values({
        name: input.name,
        keywords: JSON.stringify(input.keywords),
        platforms: JSON.stringify(input.platforms),
        subjectRef: input.subjectRef,
        investigationRef: input.investigationRef,
        alertThreshold: input.alertThreshold,
        tenantId: input.tenantId,
        createdBy: ctx.user.id,
      }).returning();
      return monitor;
    }),

  updateMonitor: writeProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      keywords: z.array(z.string()).optional(),
      platforms: z.array(z.string()).optional(),
      alertThreshold: z.number().min(0).max(100).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { id, keywords, platforms, ...rest } = input;
      const updates: Record<string, unknown> = { ...rest, updatedAt: new Date() };
      if (keywords) updates.keywords = JSON.stringify(keywords);
      if (platforms) updates.platforms = JSON.stringify(platforms);
      const [updated] = await db
        .update(socialMonitorConfigs)
        .set(updates)
        .where(eq(socialMonitorConfigs.id, id))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Monitor not found" });
      return updated;
    }),

  deleteMonitor: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(socialMentions).where(eq(socialMentions.monitorId, input.id));
      await db.delete(socialMonitorConfigs).where(eq(socialMonitorConfigs.id, input.id));
      return { success: true };
    }),

  // ─── Mentions ──────────────────────────────────────────────────────────────

  listMentions: protectedProcedure
    .input(z.object({
      monitorId: z.number().optional(),
      platform: z.enum(["twitter", "facebook", "instagram", "tiktok", "linkedin", "news", "whatsapp_group", "youtube"]).optional(),
      sentiment: z.enum(["positive", "neutral", "negative", "critical"]).optional(),
      isAcknowledged: z.boolean().optional(),
      search: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.monitorId) conditions.push(eq(socialMentions.monitorId, input.monitorId));
      if (input.platform) conditions.push(eq(socialMentions.platform, input.platform));
      if (input.sentiment) conditions.push(eq(socialMentions.sentiment, input.sentiment));
      if (input.isAcknowledged !== undefined) conditions.push(eq(socialMentions.isAcknowledged, input.isAcknowledged));
      if (input.search) {
        conditions.push(or(
          ilike(socialMentions.content, `%${input.search}%`),
          ilike(socialMentions.author, `%${input.search}%`),
        )!);
      }

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(socialMentions)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(socialMentions.publishedAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() }).from(socialMentions)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);

      return { mentions: rows, total };
    }),

  createMention: writeProcedure
    .input(z.object({
      monitorId: z.number(),
      platform: z.enum(["twitter", "facebook", "instagram", "tiktok", "linkedin", "news", "whatsapp_group", "youtube"]),
      content: z.string().min(1),
      author: z.string().min(1).max(100),
      authorHandle: z.string().optional(),
      externalUrl: z.string().url().optional(),
      sentiment: z.enum(["positive", "neutral", "negative", "critical"]).default("neutral"),
      riskScore: z.number().min(0).max(100).default(0),
      keywords: z.array(z.string()).default([]),
      engagementCount: z.number().default(0),
      isVerified: z.boolean().default(false),
      language: z.string().default("en"),
      publishedAt: z.date().default(() => new Date()),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { keywords, ...rest } = input;
      const [mention] = await db.insert(socialMentions).values({
        ...rest,
        keywords: JSON.stringify(keywords),
      }).returning();

      // Update monitor stats
      const isCritical = input.riskScore >= 75 || input.sentiment === "critical";
      await db.execute(
        sql`UPDATE social_monitor_configs SET "totalMentions" = "totalMentions" + 1, ${isCritical ? sql`"criticalMentions" = "criticalMentions" + 1,` : sql``} "lastMentionAt" = NOW(), "updatedAt" = NOW() WHERE id = ${input.monitorId}`
      );

      return mention;
    }),

  acknowledgeMention: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [updated] = await db
        .update(socialMentions)
        .set({ isAcknowledged: true, acknowledgedBy: ctx.user.id })
        .where(eq(socialMentions.id, input.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Mention not found" });
      return updated;
    }),

  deleteMention: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(socialMentions).where(eq(socialMentions.id, input.id));
      return { success: true };
    }),

  // ─── Stats ────────────────────────────────────────────────────────────────

  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const [monitorStats] = await db.select({
      totalMonitors: count(),
      activeMonitors: sql<number>`SUM(CASE WHEN "isActive" = true THEN 1 ELSE 0 END)`,
    }).from(socialMonitorConfigs);

    const [mentionStats] = await db.select({
      totalMentions: count(),
      criticalMentions: sql<number>`SUM(CASE WHEN sentiment = 'critical' THEN 1 ELSE 0 END)`,
      negativeMentions: sql<number>`SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END)`,
      unacknowledged: sql<number>`SUM(CASE WHEN "isAcknowledged" = false THEN 1 ELSE 0 END)`,
    }).from(socialMentions);

    return {
      totalMonitors: monitorStats?.totalMonitors ?? 0,
      activeMonitors: Number(monitorStats?.activeMonitors ?? 0),
      totalMentions: mentionStats?.totalMentions ?? 0,
      criticalMentions: Number(mentionStats?.criticalMentions ?? 0),
      negativeMentions: Number(mentionStats?.negativeMentions ?? 0),
      unacknowledged: Number(mentionStats?.unacknowledged ?? 0),
    };
  }),
});
