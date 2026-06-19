/**
 * AML Transaction Monitoring Router
 * Full CRUD + risk scoring + alert generation for financial transactions
 */
import { z } from "zod";
import { router, protectedProcedure, writeProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { transactions, amlAlerts, amlRules } from "../drizzle/schema";
import { eq, desc, and, ilike, gte, lte, sql, count, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

function txRef(): string {
  return `TXN-${new Date().getFullYear()}-${crypto.randomUUID().replace(/-/g,'').slice(0,8).toUpperCase()}`;
}

function alertRef(): string {
  return `ALT-${new Date().getFullYear()}-${crypto.randomUUID().replace(/-/g,'').slice(0,8).toUpperCase()}`;
}

const HIGH_RISK_COUNTRIES = new Set([
  "AF", "BY", "CF", "CG", "CU", "ER", "IR", "KP", "LY", "ML",
  "MM", "NI", "RU", "SO", "SS", "SY", "VE", "YE", "ZW",
]);

const CTR_THRESHOLDS: Record<string, number> = {
  NGN: 5_000_000, USD: 10_000, EUR: 10_000, GBP: 10_000,
  GHS: 50_000, KES: 1_000_000, ZAR: 100_000,
};

function quickScore(data: {
  amount: number; currency: string; originatorCountry: string;
  beneficiaryCountry: string; narration?: string;
}): { score: number; flags: string[]; riskLevel: "low" | "medium" | "high" | "critical" } {
  let score = 0;
  const flags: string[] = [];

  if (HIGH_RISK_COUNTRIES.has(data.originatorCountry)) { score += 35; flags.push("high_risk_originator_country"); }
  if (HIGH_RISK_COUNTRIES.has(data.beneficiaryCountry)) { score += 35; flags.push("high_risk_beneficiary_country"); }

  const threshold = CTR_THRESHOLDS[data.currency] ?? 10_000;
  const lower = threshold * 0.95;
  if (data.amount >= lower && data.amount < threshold) { score += 45; flags.push("potential_structuring"); }
  if (data.amount >= 100_000 && data.amount % 10_000 === 0) { score += 10; flags.push("round_number"); }

  const narration = (data.narration ?? "").toLowerCase();
  const suspiciousKw = ["shell", "offshore", "nominee", "crypto", "hawala", "bearer"];
  if (suspiciousKw.some(kw => narration.includes(kw))) { score += 30; flags.push("suspicious_narration"); }

  score = Math.min(score, 100);
  const riskLevel = score < 25 ? "low" : score < 50 ? "medium" : score < 75 ? "high" : "critical";
  return { score, flags, riskLevel };
}

export const transactionsRouter = router({
  // ─── List Transactions ────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).default(50),
      offset: z.number().min(0).default(0),
      status: z.string().optional(),
      riskLevel: z.string().optional(),
      currency: z.string().optional(),
      search: z.string().optional(),
      minAmount: z.number().optional(),
      maxAmount: z.number().optional(),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.status) conditions.push(eq(transactions.status, input.status as any));
      if (input.riskLevel) conditions.push(eq(transactions.amlRiskLevel, input.riskLevel as any));
      if (input.currency) conditions.push(eq(transactions.currency, input.currency));
      if (input.minAmount !== undefined) conditions.push(gte(transactions.amount, input.minAmount));
      if (input.maxAmount !== undefined) conditions.push(lte(transactions.amount, input.maxAmount));
      if (input.fromDate) conditions.push(gte(transactions.valueDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(transactions.valueDate, new Date(input.toDate)));
      if (input.search) {
        conditions.push(or(
          ilike(transactions.txRef, `%${input.search}%`),
          ilike(transactions.originatorName, `%${input.search}%`),
          ilike(transactions.beneficiaryName, `%${input.search}%`),
          ilike(transactions.narration, `%${input.search}%`),
        )!);
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(transactions).where(where)
          .orderBy(desc(transactions.createdAt))
          .limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(transactions).where(where),
      ]);
      return { items: rows, total };
    }),

  // ─── Get Transaction ──────────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [row] = await db.select().from(transactions).where(eq(transactions.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
      return row;
    }),

  // ─── Create Transaction ───────────────────────────────────────────────────
  create: writeProcedure
    .input(z.object({
      txType: z.enum(["cash_deposit", "cash_withdrawal", "wire_transfer", "swift_mt103",
        "swift_mt202", "sepa_credit", "sepa_debit", "internal_transfer", "fx_conversion",
        "mobile_money", "rtgs", "nip", "cheque"]),
      amount: z.number().positive(),
      currency: z.string().length(3).default("NGN"),
      originatorName: z.string().min(1),
      originatorAccount: z.string().optional(),
      originatorBank: z.string().optional(),
      originatorCountry: z.string().length(2).default("NG"),
      beneficiaryName: z.string().min(1),
      beneficiaryAccount: z.string().optional(),
      beneficiaryBank: z.string().optional(),
      beneficiaryCountry: z.string().length(2).default("NG"),
      narration: z.string().optional(),
      purposeCode: z.string().optional(),
      valueDate: z.string().optional(),
      // Idempotency key (1B payments lesson): prevents double-posting on retries.
      // If provided and a transaction with this key already exists, return the existing record.
      idempotencyKey: z.string().min(8).max(256).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Idempotency deduplication: if key provided, return existing transaction if found
      if (input.idempotencyKey) {
        const [existing] = await db.select().from(transactions)
          .where(eq(transactions.idempotencyKey, input.idempotencyKey));
        if (existing) return existing; // deduplicated — return existing record
      }

      const { score, flags, riskLevel } = quickScore({
        amount: input.amount,
        currency: input.currency,
        originatorCountry: input.originatorCountry,
        beneficiaryCountry: input.beneficiaryCountry,
        narration: input.narration,
      });

      const [tx] = await db.insert(transactions).values({
        txRef: txRef(),
        idempotencyKey: input.idempotencyKey,
        type: input.txType as any,
        amount: input.amount,
        currency: input.currency,
        originatorName: input.originatorName,
        originatorAccount: input.originatorAccount,
        originatorBank: input.originatorBank,
        originatorCountry: input.originatorCountry,
        beneficiaryName: input.beneficiaryName,
        beneficiaryAccount: input.beneficiaryAccount,
        beneficiaryBank: input.beneficiaryBank,
        beneficiaryCountry: input.beneficiaryCountry,
        narration: input.narration,
        purposeCode: input.purposeCode,
        valueDate: input.valueDate ? new Date(input.valueDate) : new Date(),
        amlRiskLevel: riskLevel,
        amlScore: score,
        amlFlags: flags,
        flaggedAt: score >= 50 ? new Date() : undefined,
        flaggedBy: score >= 50 ? ctx.user.id : undefined,
        status: score >= 100 ? "blocked" : "pending",
      }).returning();

      // Auto-create AML alert if high risk
      if (score >= 50) {
        await db.insert(amlAlerts).values({
          alertRef: alertRef(),
          transactionId: tx.id,
          status: "open",
          riskLevel: riskLevel,
          title: `High-risk transaction: ${tx.txRef}`,
          description: `Transaction scored ${score}/100. Flags: ${flags.join(", ")}`,
          triggeredValue: input.amount,
        });
      }

      return tx;
    }),

  // ─── Update Transaction ───────────────────────────────────────────────────
  update: writeProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "completed", "failed", "reversed", "flagged", "blocked", "under_review"]).optional(),
      narration: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { id, ...data } = input;
      const [tx] = await db.update(transactions)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(transactions.id, id))
        .returning();
      if (!tx) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
      return tx;
    }),

  // ─── Flag Transaction ─────────────────────────────────────────────────────
  flag: writeProcedure
    .input(z.object({
      id: z.number(),
      reason: z.string().min(5),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [tx] = await db.update(transactions)
        .set({
          status: "under_review",
          flaggedAt: new Date(),
          flaggedBy: ctx.user.id,
          narration: input.reason,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, input.id))
        .returning();
      return tx;
    }),

  // ─── AML Alerts ───────────────────────────────────────────────────────────
  listAlerts: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(250).default(50),
      offset: z.number().default(0),
      status: z.string().optional(),
      riskLevel: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const conditions = [];
      if (input.status) conditions.push(eq(amlAlerts.status, input.status as any));
      if (input.riskLevel) conditions.push(eq(amlAlerts.riskLevel, input.riskLevel as any));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(amlAlerts).where(where).orderBy(desc(amlAlerts.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(amlAlerts).where(where),
      ]);
      return { items: rows, total };
    }),

  resolveAlert: writeProcedure
    .input(z.object({
      alertId: z.number(),
      resolution: z.enum(["escalated", "cleared", "filed", "false_positive"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [alert] = await db.update(amlAlerts)
        .set({
          status: input.resolution,
          reviewNotes: input.notes,
          reviewedBy: ctx.user.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(amlAlerts.id, input.alertId))
        .returning();
      return alert;
    }),

  // ─── Stats ────────────────────────────────────────────────────────────────
  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const [txStats] = await db.select({
      total: count(),
      highRisk: sql<number>`count(*) filter (where ${transactions.amlRiskLevel} in ('high', 'critical'))`,
      totalVolume: sql<string>`COALESCE(sum(${transactions.amount}), 0)`,
    }).from(transactions);

    const [alertStats] = await db.select({
      openAlerts: sql<number>`count(*) filter (where ${amlAlerts.status} = 'open')`,
      totalAlerts: count(),
    }).from(amlAlerts);

    return {
      transactions: {
        total: Number(txStats.total),
        highRisk: Number(txStats.highRisk),
        totalVolume: Number(txStats.totalVolume),
      },
      alerts: {
        open: Number(alertStats.openAlerts),
        total: Number(alertStats.totalAlerts),
      },
    };
  }),

  // ─── AML Rules CRUD ───────────────────────────────────────────────────────
  listRules: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return db.select().from(amlRules).orderBy(amlRules.id);
  }),

  createRule: adminProcedure
    .input(z.object({
      name: z.string().min(3),
      description: z.string(),
      ruleType: z.enum(["threshold", "velocity", "structuring", "round_trip", "layering",
        "high_risk_country", "pep_transaction", "sanctions_match", "unusual_pattern"]),
      threshold: z.number().optional(),
      currency: z.string().length(3).optional(),
      windowHours: z.number().optional(),
      riskLevel: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      enabled: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [rule] = await db.insert(amlRules).values({
        name: input.name,
        description: input.description,
        ruleType: input.ruleType,
        threshold: input.threshold,
        currency: input.currency,
        windowHours: input.windowHours,
        riskLevel: input.riskLevel,
        enabled: input.enabled,
        createdBy: ctx.user.id,
      }).returning();
      return rule;
    }),

  toggleRule: adminProcedure
    .input(z.object({ id: z.number(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [rule] = await db.update(amlRules)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(eq(amlRules.id, input.id))
        .returning();
      return rule;
    }),

  deleteRule: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(amlRules).where(eq(amlRules.id, input.id));
      return { success: true };
    }),
});
