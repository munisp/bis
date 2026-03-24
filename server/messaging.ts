/**
 * BIS Messaging Channels Router
 * ==============================
 * Full CRUD for messaging channels (WhatsApp, Telegram, USSD, SMS)
 * and incoming reports management.
 */
import { z } from "zod";
import { eq, desc, and, sql, count, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, writeProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import {
  messagingChannels,
  incomingReports,
} from "../drizzle/schema";

export const messagingRouter = router({
  // ─── Channels ─────────────────────────────────────────────────────────────

  listChannels: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return db.select().from(messagingChannels).orderBy(desc(messagingChannels.createdAt));
  }),

  createChannel: adminProcedure
    .input(z.object({
      channelType: z.enum(["whatsapp", "telegram", "ussd", "sms", "email"]),
      name: z.string().min(1).max(100),
      identifier: z.string().min(1).max(100),
      webhookUrl: z.string().url().optional(),
      apiKey: z.string().optional(),
      config: z.string().optional(),
      tenantId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [channel] = await db.insert(messagingChannels).values({
        ...input,
        createdBy: ctx.user.id,
      }).returning();
      return channel;
    }),

  updateChannel: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      identifier: z.string().min(1).max(100).optional(),
      status: z.enum(["active", "inactive", "error", "pending"]).optional(),
      webhookUrl: z.string().url().optional().nullable(),
      apiKey: z.string().optional().nullable(),
      config: z.string().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { id, ...updates } = input;
      const [updated] = await db
        .update(messagingChannels)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(messagingChannels.id, id))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Channel not found" });
      return updated;
    }),

  deleteChannel: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(messagingChannels).where(eq(messagingChannels.id, input.id));
      return { success: true };
    }),

  toggleChannel: adminProcedure
    .input(z.object({ id: z.number(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [updated] = await db
        .update(messagingChannels)
        .set({ status: input.active ? "active" : "inactive", updatedAt: new Date() })
        .where(eq(messagingChannels.id, input.id))
        .returning();
      return updated;
    }),

  // ─── Incoming Reports ──────────────────────────────────────────────────────

  listReports: protectedProcedure
    .input(z.object({
      channelId: z.number().optional(),
      status: z.enum(["new", "processing", "verified", "dismissed", "escalated"]).optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.channelId) conditions.push(eq(incomingReports.channelId, input.channelId));
      if (input.status) conditions.push(eq(incomingReports.status, input.status));

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(incomingReports)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(incomingReports.receivedAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() }).from(incomingReports)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);

      return { reports: rows, total };
    }),

  createReport: writeProcedure
    .input(z.object({
      channelId: z.number(),
      channelType: z.enum(["whatsapp", "telegram", "ussd", "sms", "email"]),
      sender: z.string().min(1).max(100),
      content: z.string().min(1),
      language: z.string().default("en"),
      attachmentCount: z.number().default(0),
      linkedSubjectRef: z.string().optional(),
      linkedInvestigationRef: z.string().optional(),
      metadata: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Simple keyword-based risk scoring
      const content = input.content.toLowerCase();
      const riskKeywords = ["fraud", "scam", "419", "stolen", "threat", "bribery", "corruption", "money laundering", "kidnap", "attack"];
      const hits = riskKeywords.filter(kw => content.includes(kw)).length;
      const riskScore = Math.min(hits * 15, 90);

      const [report] = await db.insert(incomingReports).values({
        ...input,
        riskScore,
        status: "new",
      }).returning();

      // Update channel stats
      await db.execute(
        sql`UPDATE messaging_channels SET "todayReports" = "todayReports" + 1, "totalReports" = "totalReports" + 1, "lastActivityAt" = NOW(), "updatedAt" = NOW() WHERE id = ${input.channelId}`
      );

      return report;
    }),

  updateReportStatus: writeProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["new", "processing", "verified", "dismissed", "escalated"]),
      linkedInvestigationRef: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [updated] = await db
        .update(incomingReports)
        .set({
          status: input.status,
          linkedInvestigationRef: input.linkedInvestigationRef,
          processedAt: ["verified", "dismissed", "escalated"].includes(input.status) ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(incomingReports.id, input.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      return updated;
    }),

  deleteReport: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(incomingReports).where(eq(incomingReports.id, input.id));
      return { success: true };
    }),

  // ─── Stats ────────────────────────────────────────────────────────────────

  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const [channelStats] = await db.select({
      totalChannels: count(),
      activeChannels: sql<number>`SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)`,
    }).from(messagingChannels);

    const [reportStats] = await db.select({
      totalReports: count(),
      newReports: sql<number>`SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END)`,
      verifiedReports: sql<number>`SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END)`,
      escalatedReports: sql<number>`SUM(CASE WHEN status = 'escalated' THEN 1 ELSE 0 END)`,
    }).from(incomingReports);

    return {
      totalChannels: channelStats?.totalChannels ?? 0,
      activeChannels: Number(channelStats?.activeChannels ?? 0),
      totalReports: reportStats?.totalReports ?? 0,
      newReports: Number(reportStats?.newReports ?? 0),
      verifiedReports: Number(reportStats?.verifiedReports ?? 0),
      escalatedReports: Number(reportStats?.escalatedReports ?? 0),
    };
  }),
});
