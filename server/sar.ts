import { z } from "zod";
import { router, protectedProcedure, writeProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { sarFilings } from "../drizzle/schema";
import { eq, desc, and, like, or, count, sql } from "drizzle-orm";

function sarRef(): string {
  const year = new Date().getFullYear();
  return `SAR-${year}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export const sarRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().default(50),
      offset: z.number().default(0),
      status: z.string().optional(),
      category: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const conditions = [];
      if (input.status) conditions.push(eq(sarFilings.status, input.status as any));
      if (input.category) conditions.push(eq(sarFilings.category, input.category as any));
      if (input.search) {
        conditions.push(or(
          like(sarFilings.subjectName, `%${input.search}%`),
          like(sarFilings.sarRef, `%${input.search}%`),
          like(sarFilings.title, `%${input.search}%`),
        )!);
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(sarFilings).where(where).orderBy(desc(sarFilings.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(sarFilings).where(where),
      ]);
      return { items: rows, total };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [row] = await db.select().from(sarFilings).where(eq(sarFilings.id, input.id));
      return row ?? null;
    }),

  create: writeProcedure
    .input(z.object({
      category: z.enum(["money_laundering", "terrorist_financing", "fraud", "corruption", "tax_evasion",
        "sanctions_evasion", "human_trafficking", "drug_trafficking", "cybercrime", "other"]),
      title: z.string().min(5),
      narrative: z.string().min(20),
      subjectName: z.string().min(2),
      subjectNin: z.string().optional(),
      subjectBvn: z.string().optional(),
      subjectDob: z.string().optional(),
      subjectAddress: z.string().optional(),
      subjectOccupation: z.string().optional(),
      suspiciousAmount: z.number().optional(),
      suspiciousCurrency: z.string().length(3).default("NGN"),
      activityStartDate: z.string().optional(),
      activityEndDate: z.string().optional(),
      relatedTransactions: z.array(z.any()).optional(),
      relatedInvestigationId: z.number().optional(),
      relatedGoamlFilingId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [sar] = await db.insert(sarFilings).values({
        sarRef: sarRef(),
        status: "draft",
        category: input.category,
        title: input.title,
        narrative: input.narrative,
        subjectName: input.subjectName,
        subjectNin: input.subjectNin,
        subjectBvn: input.subjectBvn,
        subjectDob: input.subjectDob,
        subjectAddress: input.subjectAddress,
        subjectOccupation: input.subjectOccupation,
        suspiciousAmount: input.suspiciousAmount,
        suspiciousCurrency: input.suspiciousCurrency,
        activityStartDate: input.activityStartDate ? new Date(input.activityStartDate) : undefined,
        activityEndDate: input.activityEndDate ? new Date(input.activityEndDate) : undefined,
        relatedTransactions: input.relatedTransactions,
        relatedInvestigationId: input.relatedInvestigationId,
        relatedGoamlFilingId: input.relatedGoamlFilingId,
        createdBy: ctx.user.id,
      }).returning();
      return sar;
    }),

  update: writeProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      narrative: z.string().optional(),
      subjectName: z.string().optional(),
      subjectNin: z.string().optional(),
      subjectBvn: z.string().optional(),
      subjectAddress: z.string().optional(),
      suspiciousAmount: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const { id, ...data } = input;
      const [sar] = await db.update(sarFilings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(sarFilings.id, id))
        .returning();
      return sar;
    }),

  // Lifecycle transitions
  submitForReview: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [sar] = await db.update(sarFilings)
        .set({ status: "under_review", updatedAt: new Date() })
        .where(and(eq(sarFilings.id, input.id), eq(sarFilings.status, "draft")))
        .returning();
      if (!sar) throw new Error("SAR not found or not in draft status");
      return sar;
    }),

  approve: adminProcedure
    .input(z.object({ id: z.number(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [sar] = await db.update(sarFilings)
        .set({ status: "approved", approvedBy: ctx.user.id, approvedAt: new Date(), reviewNotes: input.notes, updatedAt: new Date() })
        .where(eq(sarFilings.id, input.id))
        .returning();
      return sar;
    }),

  reject: adminProcedure
    .input(z.object({ id: z.number(), notes: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [sar] = await db.update(sarFilings)
        .set({ status: "rejected", reviewedBy: ctx.user.id, reviewedAt: new Date(), reviewNotes: input.notes, updatedAt: new Date() })
        .where(eq(sarFilings.id, input.id))
        .returning();
      return sar;
    }),

  file: adminProcedure
    .input(z.object({
      id: z.number(),
      filedWith: z.string().default("NFIU"),
      filingReference: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const ref = input.filingReference ?? `NFIU-${Date.now().toString(36).toUpperCase()}`;
      const [sar] = await db.update(sarFilings)
        .set({ status: "filed", filedAt: new Date(), filedWith: input.filedWith, filingReference: ref, updatedAt: new Date() })
        .where(and(eq(sarFilings.id, input.id), eq(sarFilings.status, "approved")))
        .returning();
      if (!sar) throw new Error("SAR not found or not approved");
      return sar;
    }),

  acknowledge: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [sar] = await db.update(sarFilings)
        .set({ status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date() })
        .where(eq(sarFilings.id, input.id))
        .returning();
      return sar;
    }),

  withdraw: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [sar] = await db.update(sarFilings)
        .set({ status: "withdrawn", updatedAt: new Date() })
        .where(eq(sarFilings.id, input.id))
        .returning();
      return sar;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.delete(sarFilings).where(eq(sarFilings.id, input.id));
      return { success: true };
    }),

  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const [totals] = await db.select({
      total: count(),
      draft: sql<number>`count(*) filter (where ${sarFilings.status} = 'draft')`,
      underReview: sql<number>`count(*) filter (where ${sarFilings.status} = 'under_review')`,
      approved: sql<number>`count(*) filter (where ${sarFilings.status} = 'approved')`,
      filed: sql<number>`count(*) filter (where ${sarFilings.status} = 'filed')`,
      acknowledged: sql<number>`count(*) filter (where ${sarFilings.status} = 'acknowledged')`,
    }).from(sarFilings);
    return {
      total: Number(totals.total),
      draft: Number(totals.draft),
      underReview: Number(totals.underReview),
      approved: Number(totals.approved),
      filed: Number(totals.filed),
      acknowledged: Number(totals.acknowledged),
    };
  }),
});
