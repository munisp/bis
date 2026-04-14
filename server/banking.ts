/**
 * Banking Domain Routers
 * - Trade Finance (Letters of Credit)
 * - Correspondent Banking + Nostro Accounts
 * - Evidence Chain of Custody
 * - Regulatory Reports (CTR, STR, goAML, NFIU, CBN)
 */
import { z } from "zod";
import { router, protectedProcedure, writeProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import {
  lettersOfCredit, correspondentBanks, nostroAccounts,
  evidenceItems, regulatoryReports,
} from "../drizzle/schema";
import { eq, desc, and, ilike, gte, lte, sql, count, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";


// ─── Helpers ──────────────────────────────────────────────────────────────────

function lcRef(): string {
  return `LC-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
function evidenceRef(): string {
  return `EVD-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
function reportRef(): string {
  return `RPT-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// ─── Trade Finance Router ─────────────────────────────────────────────────────

export const tradeFinanceRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().default(50),
      offset: z.number().default(0),
      status: z.string().optional(),
      lcType: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.status) conditions.push(eq(lettersOfCredit.status, input.status as any));
      if (input.lcType) conditions.push(eq(lettersOfCredit.type, input.lcType as any));
      if (input.search) {
        conditions.push(or(
          ilike(lettersOfCredit.lcRef, `%${input.search}%`),
          ilike(lettersOfCredit.applicantName, `%${input.search}%`),
          ilike(lettersOfCredit.beneficiaryName, `%${input.search}%`),
        )!);
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(lettersOfCredit).where(where).orderBy(desc(lettersOfCredit.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(lettersOfCredit).where(where),
      ]);
      return { items: rows, total };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [row] = await db.select().from(lettersOfCredit).where(eq(lettersOfCredit.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "LC not found" });
      return row;
    }),

  create: writeProcedure
    .input(z.object({
      lcType: z.enum(["sight", "usance", "deferred", "revolving", "standby"]),
      applicantName: z.string().min(1),
      applicantAccount: z.string().optional(),
      applicantCountry: z.string().length(2).default("NG"),
      beneficiaryName: z.string().min(1),
      beneficiaryAccount: z.string().optional(),
      beneficiaryCountry: z.string().length(2),
      beneficiaryBankBic: z.string().optional(),
      amount: z.number().positive(),
      currency: z.string().length(3).default("USD"),
      expiryDate: z.string(),
      goodsDescription: z.string().optional(),
      portOfLoading: z.string().optional(),
      portOfDischarge: z.string().optional(),
      incoterms: z.string().optional(),
      documents: z.array(z.string()).optional(),
      specialConditions: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [lc] = await db.insert(lettersOfCredit).values({
        lcRef: lcRef(),
        type: input.lcType,
        status: "draft",
        applicantName: input.applicantName,
        applicantBank: input.applicantAccount ?? "BIS Bank",
        applicantCountry: input.applicantCountry,
        beneficiaryName: input.beneficiaryName,
        beneficiaryBank: input.beneficiaryBankBic,
        beneficiaryCountry: input.beneficiaryCountry,
        amount: input.amount,
        currency: input.currency,
        expiryDate: new Date(input.expiryDate),
        goodsDescription: input.goodsDescription,
        portOfLoading: input.portOfLoading,
        portOfDischarge: input.portOfDischarge,
        issuingBank: "BIS Financial Intelligence",
        documents: input.documents ?? [],
        createdBy: ctx.user.id,
      }).returning();
      return lc;
    }),

  updateStatus: writeProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["draft", "issued", "advised", "confirmed", "amended", "presented", "accepted", "paid", "discrepant", "rejected", "expired", "cancelled"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [lc] = await db.update(lettersOfCredit)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(lettersOfCredit.id, input.id))
        .returning();
      return lc;
    }),

  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const [s] = await db.select({
      total: count(),
      issued: sql<number>`count(*) filter (where ${lettersOfCredit.status} = 'issued')`,
      utilized: sql<number>`count(*) filter (where ${lettersOfCredit.status} = 'utilized')`,
      expired: sql<number>`count(*) filter (where ${lettersOfCredit.status} = 'expired')`,
      totalValue: sql<number>`COALESCE(sum(${lettersOfCredit.amount}), 0)`,
    }).from(lettersOfCredit);
    return {
      total: Number(s.total),
      issued: Number(s.issued),
      utilized: Number(s.utilized),
      expired: Number(s.expired),
      totalValue: Number(s.totalValue),
    };
  }),
});

// ─── Correspondent Banking Router ─────────────────────────────────────────────

export const correspondentBankingRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().default(50),
      offset: z.number().default(0),
      status: z.string().optional(),
      country: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.status) conditions.push(eq(correspondentBanks.status, input.status as any));
      if (input.country) conditions.push(eq(correspondentBanks.country, input.country));
      if (input.search) {
        conditions.push(or(
          ilike(correspondentBanks.bankName, `%${input.search}%`),
          ilike(correspondentBanks.bic, `%${input.search}%`),
        )!);
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(correspondentBanks).where(where).orderBy(correspondentBanks.bankName).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(correspondentBanks).where(where),
      ]);
      return { items: rows, total };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [bank] = await db.select().from(correspondentBanks).where(eq(correspondentBanks.id, input.id));
      if (!bank) throw new TRPCError({ code: "NOT_FOUND", message: "Correspondent bank not found" });

      const nostros = await db.select().from(nostroAccounts)
        .where(eq(nostroAccounts.correspondentBankId, input.id));

      return { ...bank, nostroAccounts: nostros };
    }),

  create: adminProcedure
    .input(z.object({
      bankName: z.string().min(1),
      bic: z.string().min(8).max(11),
      country: z.string().length(2),
      city: z.string().optional(),
      riskRating: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      services: z.array(z.string()).optional(),
      currencies: z.array(z.string()).optional(),
      annualVolume: z.number().optional(),
      amlPolicyUrl: z.string().url().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [bank] = await db.insert(correspondentBanks).values({
        bankName: input.bankName,
        bic: input.bic.toUpperCase(),
        country: input.country,
        city: input.city,
        status: "active",
        riskRating: input.riskRating,
        services: input.services ?? [],
        currencies: input.currencies ?? [],
        annualVolume: input.annualVolume,
        amlPolicyUrl: input.amlPolicyUrl,
        notes: input.notes,
        relationshipSince: new Date(),
        nextReviewDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      }).returning();
      return bank;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      bankName: z.string().optional(),
      riskRating: z.string().optional(),
      status: z.enum(["active", "suspended", "terminated", "under_review"]).optional(),
      notes: z.string().optional(),
      amlPolicyUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { id, ...data } = input;
      const [bank] = await db.update(correspondentBanks)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(correspondentBanks.id, id))
        .returning();
      return bank;
    }),

  addNostroAccount: writeProcedure
    .input(z.object({
      correspondentBankId: z.number(),
      accountNumber: z.string().min(1),
      currency: z.string().length(3),
      balance: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [account] = await db.insert(nostroAccounts).values({
        accountNumber: input.accountNumber,
        currency: input.currency,
        correspondentBankId: input.correspondentBankId,
        balance: input.balance,
        lastReconciled: new Date(),
        status: "active",
      }).returning();
      return account;
    }),

  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const [s] = await db.select({
      total: count(),
      active: sql<number>`count(*) filter (where ${correspondentBanks.status} = 'active')`,
      suspended: sql<number>`count(*) filter (where ${correspondentBanks.status} = 'suspended')`,
      highRisk: sql<number>`count(*) filter (where ${correspondentBanks.riskRating} in ('high', 'critical'))`,
    }).from(correspondentBanks);
    return {
      total: Number(s.total),
      active: Number(s.active),
      suspended: Number(s.suspended),
      highRisk: Number(s.highRisk),
    };
  }),
});

// ─── Evidence Chain of Custody Router ────────────────────────────────────────

export const evidenceRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().default(50),
      offset: z.number().default(0),
      caseId: z.number().optional(),
      investigationId: z.number().optional(),
      type: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.caseId) conditions.push(eq(evidenceItems.caseId, input.caseId));
      if (input.investigationId) conditions.push(eq(evidenceItems.investigationId, input.investigationId));
      if (input.type) conditions.push(eq(evidenceItems.type, input.type as any));
      if (input.status) conditions.push(eq(evidenceItems.status, input.status as any));
      if (input.search) {
        conditions.push(or(
          ilike(evidenceItems.title, `%${input.search}%`),
          ilike(evidenceItems.evidenceRef, `%${input.search}%`),
        )!);
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(evidenceItems).where(where).orderBy(desc(evidenceItems.collectedAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(evidenceItems).where(where),
      ]);
      return { items: rows, total };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [row] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Evidence item not found" });
      return row;
    }),

  create: writeProcedure
    .input(z.object({
      caseId: z.number().optional(),
      investigationId: z.number().optional(),
      type: z.enum(["document", "photo", "video", "audio", "digital_artifact", "physical",
        "witness_statement", "financial_record", "communication_log", "other"]),
      title: z.string().min(1),
      description: z.string().optional(),
      fileUrl: z.string().url().optional(),
      fileHash: z.string().optional(),
      fileSize: z.number().optional(),
      mimeType: z.string().optional(),
      collectionLocation: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const initialCustody = [{
        timestamp: new Date().toISOString(),
        action: "collected",
        by: ctx.user.id,
        byName: ctx.user.name,
        notes: "Initial collection",
      }];

      const [item] = await db.insert(evidenceItems).values({
        evidenceRef: evidenceRef(),
        caseId: input.caseId,
        investigationId: input.investigationId,
        type: input.type,
        status: "collected",
        title: input.title,
        description: input.description,
        fileUrl: input.fileUrl,
        fileHash: input.fileHash,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        collectedBy: ctx.user.id,
        collectedAt: new Date(),
        collectionLocation: input.collectionLocation,
        chainOfCustody: initialCustody,
        integrityVerified: false,
      }).returning();
      return item;
    }),

  transferCustody: writeProcedure
    .input(z.object({
      id: z.number(),
      toStatus: z.enum(["in_transit", "secured", "analyzed", "submitted", "returned", "destroyed"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [current] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, input.id));
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Evidence item not found" });

      const existingChain = (current.chainOfCustody as any[]) ?? [];
      const newEntry = {
        timestamp: new Date().toISOString(),
        action: input.toStatus,
        by: ctx.user.id,
        byName: ctx.user.name,
        notes: input.notes ?? "",
      };

      const [updated] = await db.update(evidenceItems)
        .set({
          status: input.toStatus,
          chainOfCustody: [...existingChain, newEntry],
          updatedAt: new Date(),
        })
        .where(eq(evidenceItems.id, input.id))
        .returning();
      return updated;
    }),

  verifyIntegrity: writeProcedure
    .input(z.object({
      id: z.number(),
      computedHash: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [item] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, input.id));
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Evidence item not found" });

      // If hash provided, verify against stored hash
      const hashMatch = !input.computedHash || !item.fileHash || input.computedHash === item.fileHash;

      const [updated] = await db.update(evidenceItems)
        .set({
          integrityVerified: hashMatch,
          integrityVerifiedAt: new Date(),
          integrityVerifiedBy: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(evidenceItems.id, input.id))
        .returning();

      return { ...updated, hashMatch };
    }),

  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const [s] = await db.select({
      total: count(),
      collected: sql<number>`count(*) filter (where ${evidenceItems.status} = 'collected')`,
      secured: sql<number>`count(*) filter (where ${evidenceItems.status} = 'secured')`,
      analyzed: sql<number>`count(*) filter (where ${evidenceItems.status} = 'analyzed')`,
      integrityVerified: sql<number>`count(*) filter (where ${evidenceItems.integrityVerified} = true)`,
    }).from(evidenceItems);
    return {
      total: Number(s.total),
      collected: Number(s.collected),
      secured: Number(s.secured),
      analyzed: Number(s.analyzed),
      integrityVerified: Number(s.integrityVerified),
    };
  }),
});

// ─── Regulatory Reports Router ────────────────────────────────────────────────

export const regulatoryReportsRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().default(50),
      offset: z.number().default(0),
      type: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.type) conditions.push(eq(regulatoryReports.type, input.type as any));
      if (input.status) conditions.push(eq(regulatoryReports.status, input.status as any));
      if (input.search) {
        conditions.push(or(
          ilike(regulatoryReports.title, `%${input.search}%`),
          ilike(regulatoryReports.reportRef, `%${input.search}%`),
        )!);
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(regulatoryReports).where(where).orderBy(desc(regulatoryReports.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(regulatoryReports).where(where),
      ]);
      return { items: rows, total };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [row] = await db.select().from(regulatoryReports).where(eq(regulatoryReports.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      return row;
    }),

  create: writeProcedure
    .input(z.object({
      type: z.enum(["CTR", "STR", "goAML_XML", "NFIU_monthly", "CBN_quarterly",
        "FATF_travel_rule", "PEP_disclosure", "sanctions_screening", "annual_AML_report"]),
      title: z.string().min(1),
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      regulatorName: z.string().default("NFIU"),
      submissionDeadline: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const deadline = input.submissionDeadline
        ? new Date(input.submissionDeadline)
        : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

      const [report] = await db.insert(regulatoryReports).values({
        reportRef: reportRef(),
        type: input.type,
        status: "draft",
        title: input.title,
        periodStart: input.periodStart ? new Date(input.periodStart) : undefined,
        periodEnd: input.periodEnd ? new Date(input.periodEnd) : undefined,
        regulatorName: input.regulatorName,
        submissionDeadline: deadline,
        metadata: input.metadata ?? {},
        createdBy: ctx.user.id,
      }).returning();
      return report;
    }),

  transition: writeProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["draft", "generated", "reviewed", "submitted", "acknowledged", "rejected"]),
      fileUrl: z.string().url().optional(),
      acknowledgementRef: z.string().optional(),
      rejectionReason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const updates: Record<string, unknown> = {
        status: input.status,
        updatedAt: new Date(),
      };
      if (input.fileUrl) updates.fileUrl = input.fileUrl;
      if (input.acknowledgementRef) updates.acknowledgementRef = input.acknowledgementRef;
      if (input.rejectionReason) updates.rejectionReason = input.rejectionReason;
      if (input.status === "submitted") {
        updates.submittedAt = new Date();
        updates.submittedBy = ctx.user.id;
      }

      const [report] = await db.update(regulatoryReports)
        .set(updates as any)
        .where(eq(regulatoryReports.id, input.id))
        .returning();
      return report;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(regulatoryReports).where(eq(regulatoryReports.id, input.id));
      return { success: true };
    }),

  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const [s] = await db.select({
      total: count(),
      draft: sql<number>`count(*) filter (where ${regulatoryReports.status} = 'draft')`,
      submitted: sql<number>`count(*) filter (where ${regulatoryReports.status} = 'submitted')`,
      acknowledged: sql<number>`count(*) filter (where ${regulatoryReports.status} = 'acknowledged')`,
      overdue: sql<number>`count(*) filter (where ${regulatoryReports.submissionDeadline} < NOW() and ${regulatoryReports.status} not in ('submitted', 'acknowledged'))`,
    }).from(regulatoryReports);
    return {
      total: Number(s.total),
      draft: Number(s.draft),
      submitted: Number(s.submitted),
      acknowledged: Number(s.acknowledged),
      overdue: Number(s.overdue),
    };
  }),
});
