import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, writeProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { sarFilings } from "../drizzle/schema";
import { eq, desc, and, like, or, count, sql, lte } from "drizzle-orm";

function sarRef(): string {
  const year = new Date().getFullYear();
  return `SAR-${year}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export const sarRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(250).default(50),
      offset: z.number().default(0),
      status: z.string().optional(),
      category: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const conditions = [];
      // Tenant isolation: non-admin users only see their own tenant's SAR filings
      if (ctx.tenantId !== null) conditions.push(eq(sarFilings.tenantId, ctx.tenantId));
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
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const conditions = [eq(sarFilings.id, input.id)];
      if (ctx.tenantId !== null) conditions.push(eq(sarFilings.tenantId, ctx.tenantId));
      const [row] = await db.select().from(sarFilings).where(and(...conditions));
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
        tenantId: ctx.tenantId ?? undefined,
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

  /**
   * GET /sar/getOverdue — SAR filings exceeding the 72-hour NFIU filing deadline.
   * CBN AML/CFT Regulations 2013 (as amended) require SARs within 72 hours of detection.
   */
  getOverdue: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { overdue: [], count: 0 };
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const overdue = await db
      .select()
      .from(sarFilings)
      .where(
        and(
          sql`${sarFilings.status} NOT IN ('filed', 'acknowledged', 'withdrawn')`,
          sql`${sarFilings.createdAt} < ${cutoff.toISOString()}`
        )
      )
      .orderBy(sarFilings.createdAt);
    return {
      overdue: overdue.map(s => ({
        id: s.id,
        sarRef: s.sarRef,
        title: s.title,
        status: s.status,
        subjectName: s.subjectName,
        createdAt: s.createdAt,
        hoursOverdue: Math.round((Date.now() - new Date(s.createdAt).getTime()) / 3600000 - 72),
        deadlineBreached: true,
      })),
      count: overdue.length,
    };
  }),

  /**
   * POST /sar/bulkFileOverdue — File all SAR filings that have breached the 72-hour NFIU deadline.
   * Returns a per-filing success/error summary with filed count and any errors.
   * Regulatory basis: CBN AML/CFT Regulations 2013 — SARs must be filed within 72 hours of detection.
   */
  bulkFileOverdue: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable' });
    const cutoff = new Date(Date.now() - 72 * 3600 * 1000);
    const overdueFilings = await db
      .select({ id: sarFilings.id, title: sarFilings.title, subjectName: sarFilings.subjectName, status: sarFilings.status })
      .from(sarFilings)
      .where(
        and(
          lte(sarFilings.createdAt, cutoff),
          sql`${sarFilings.status} NOT IN ('filed', 'acknowledged', 'withdrawn', 'rejected')`
        )
      );
    if (overdueFilings.length === 0) {
      return { filed: 0, errors: 0, results: [] as Array<{ id: number; title: string; success: boolean; error?: string }> };
    }
    const results: Array<{ id: number; title: string; success: boolean; error?: string }> = [];
    let filed = 0;
    let errors = 0;
    for (const filing of overdueFilings) {
      try {
        await db
          .update(sarFilings)
          .set({
            status: 'filed' as any,
            filedAt: new Date(),
            filedWith: 'NFIU',
            filingReference: `NFIU-BULK-${Date.now()}-${filing.id}`,
            updatedAt: new Date(),
          })
          .where(eq(sarFilings.id, filing.id));
        results.push({ id: filing.id, title: filing.title, success: true });
        filed++;
      } catch (err) {
        results.push({ id: filing.id, title: filing.title, success: false, error: String(err) });
        errors++;
      }
    }
    return { filed, errors, results };
  }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const tenantCondition = ctx.tenantId !== null ? eq(sarFilings.tenantId, ctx.tenantId) : undefined;
    const [totals] = await db.select({
      total: count(),
      draft: sql<number>`count(*) filter (where ${sarFilings.status} = 'draft')`,
      underReview: sql<number>`count(*) filter (where ${sarFilings.status} = 'under_review')`,
      approved: sql<number>`count(*) filter (where ${sarFilings.status} = 'approved')`,
      filed: sql<number>`count(*) filter (where ${sarFilings.status} = 'filed')`,
      acknowledged: sql<number>`count(*) filter (where ${sarFilings.status} = 'acknowledged')`,
    }).from(sarFilings).where(tenantCondition);
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
