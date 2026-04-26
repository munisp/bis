import { z } from "zod";
import { router, protectedProcedure, writeProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import {
  transactions, amlRules, amlAlerts, swiftMessages, sepaPayments, travelRuleRecords, cases, alertRules,
} from "../drizzle/schema";
import { eq, desc, and, gte, lte, like, or, sql, count, sum } from "drizzle-orm";

// ─── AML Auto-Escalation ─────────────────────────────────────────────────────
/**
 * When an AML alert is created and the triggering rule has autoEscalate=true,
 * automatically create a Case in the case management system.
 */
async function autoEscalateToCase(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, alert: {
  id: number;
  alertRef: string;
  riskLevel: string;
  title: string;
  description: string;
  transactionId?: number | null;
  investigationId?: number | null;
}, createdBy: number): Promise<void> {
  try {
    const caseRef = `CASE-AML-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const priority = alert.riskLevel === "critical" ? "critical" : alert.riskLevel === "high" ? "high" : "medium";
    await db.insert(cases).values({
      ref: caseRef,
      title: `[AUTO-ESCALATED] ${alert.title}`,
      type: "aml",
      status: "open",
      priority: priority as any,
      summary: `Automatically escalated from AML alert ${alert.alertRef}. ${alert.description}`,
      legalBasis: "MLPA 2011 s.6 — Suspicious Transaction Reporting",
      regulatoryFramework: "NFIU/CBN AML/CFT Framework 2022",
      riskScore: alert.riskLevel === "critical" ? 90 : alert.riskLevel === "high" ? 70 : 50,
      createdBy,
      investigationRefs: alert.investigationId ? [String(alert.investigationId)] : [],
    });
  } catch (err) {
    // Non-blocking: log but don't fail the alert creation
    console.error("[AML AutoEscalate] Failed to create case:", err);
  }
}

// ─── AML Engine (Rust microservice, port 8095) ────────────────────────────────
const AML_ENGINE_URL = process.env.BIS_AML_ENGINE_URL ?? "http://localhost:8095";
async function callAmlEngine(path: string, body: unknown): Promise<unknown> {
  try {
    const res = await fetch(`${AML_ENGINE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`AML engine HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null; // graceful degradation — engine offline
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function txRef(): string {
  return `TXN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
function amlAlertRef(): string {
  return `AML-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}
function uetrGen(): string {
  const hex = () => Math.random().toString(16).slice(2, 10);
  return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-${hex().slice(0, 4)}-${hex()}${hex().slice(0, 4)}`;
}

function scoreTransaction(tx: {
  amount: number; currency: string; originatorCountry: string; beneficiaryCountry: string;
  type: string; narration?: string | null;
}): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 0;
  const HIGH_RISK = ["AF", "BY", "CF", "CG", "CU", "ER", "IR", "KP", "LY", "ML", "MM", "NI", "RU", "SO", "SS", "SY", "VE", "YE", "ZW"];
  if (HIGH_RISK.includes(tx.originatorCountry)) { flags.push("high_risk_originator_country"); score += 35; }
  if (HIGH_RISK.includes(tx.beneficiaryCountry)) { flags.push("high_risk_beneficiary_country"); score += 35; }
  if (tx.currency === "NGN" && tx.amount >= 4_900_000 && tx.amount < 5_000_000) { flags.push("potential_structuring"); score += 40; }
  if (tx.currency === "NGN" && tx.amount >= 5_000_000) { flags.push("large_cash_transaction"); score += 20; }
  if (tx.type === "cash_deposit" || tx.type === "cash_withdrawal") { flags.push("cash_transaction"); score += 10; }
  if (tx.narration && /shell|offshore|nominee|bearer|crypto|bitcoin/i.test(tx.narration)) { flags.push("suspicious_narration"); score += 25; }
  if (tx.type === "fx_conversion" && tx.amount > 50000) { flags.push("large_fx_conversion"); score += 15; }
  return { score: Math.min(score, 100), flags };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const amlRouter = router({
  transactions: router({
    list: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        status: z.string().optional(),
        riskLevel: z.string().optional(),
        type: z.string().optional(),
        search: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        minAmount: z.number().optional(),
        maxAmount: z.number().optional(),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const conditions = [];
        if (input.status) conditions.push(eq(transactions.status, input.status as any));
        if (input.riskLevel) conditions.push(eq(transactions.amlRiskLevel, input.riskLevel as any));
        if (input.type) conditions.push(eq(transactions.type, input.type as any));
        if (input.search) {
          conditions.push(or(
            like(transactions.originatorName, `%${input.search}%`),
            like(transactions.beneficiaryName, `%${input.search}%`),
            like(transactions.txRef, `%${input.search}%`),
          )!);
        }
        if (input.dateFrom) conditions.push(gte(transactions.createdAt, new Date(input.dateFrom)));
        if (input.dateTo) conditions.push(lte(transactions.createdAt, new Date(input.dateTo)));
        if (input.minAmount !== undefined) conditions.push(gte(transactions.amount, input.minAmount));
        if (input.maxAmount !== undefined) conditions.push(lte(transactions.amount, input.maxAmount));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          db.select().from(transactions).where(where).orderBy(desc(transactions.createdAt)).limit(input.limit).offset(input.offset),
          db.select({ total: count() }).from(transactions).where(where),
        ]);
        return { items: rows, total };
      }),

    get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const db = await getDb();
        if (!db) throw new Error("Database unavailable");
      const [row] = await db.select().from(transactions).where(eq(transactions.id, input.id));
      return row ?? null;
    }),

    create: writeProcedure
      .input(z.object({
        type: z.enum(["wire_transfer", "cash_deposit", "cash_withdrawal", "cheque", "rtgs", "nip",
          "swift_mt103", "swift_mt202", "sepa_credit", "sepa_debit", "internal_transfer",
          "trade_settlement", "fx_conversion", "card_payment", "mobile_money"]),
        amount: z.number().positive(),
        currency: z.string().length(3).default("NGN"),
        originatorName: z.string().min(2),
        originatorAccount: z.string().optional(),
        originatorBank: z.string().optional(),
        originatorCountry: z.string().length(2).default("NG"),
        beneficiaryName: z.string().min(2),
        beneficiaryAccount: z.string().optional(),
        beneficiaryBank: z.string().optional(),
        beneficiaryCountry: z.string().length(2).default("NG"),
        purposeCode: z.string().optional(),
        narration: z.string().optional(),
        valueDate: z.string().optional(),
        investigationId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const { score, flags } = scoreTransaction({
          amount: input.amount, currency: input.currency,
          originatorCountry: input.originatorCountry, beneficiaryCountry: input.beneficiaryCountry,
          type: input.type, narration: input.narration,
        });
        const riskLevel = score >= 70 ? "critical" : score >= 50 ? "high" : score >= 25 ? "medium" : "low";
        const status = score >= 70 ? "flagged" : "completed";
        const [tx] = await db.insert(transactions).values({
          txRef: txRef(), type: input.type, status: status as any,
          amount: input.amount, currency: input.currency,
          amountUsd: input.currency === "USD" ? input.amount : input.currency === "NGN" ? input.amount / 1600 : undefined,
          originatorName: input.originatorName, originatorAccount: input.originatorAccount,
          originatorBank: input.originatorBank, originatorCountry: input.originatorCountry,
          beneficiaryName: input.beneficiaryName, beneficiaryAccount: input.beneficiaryAccount,
          beneficiaryBank: input.beneficiaryBank, beneficiaryCountry: input.beneficiaryCountry,
          purposeCode: input.purposeCode, narration: input.narration,
          amlRiskLevel: riskLevel as any, amlScore: score, amlFlags: flags,
          flaggedAt: score >= 50 ? new Date() : undefined,
          flaggedBy: score >= 50 ? ctx.user.id : undefined,
          investigationId: input.investigationId,
          valueDate: input.valueDate ? new Date(input.valueDate) : new Date(),
        }).returning();
        if (score >= 50 && flags.length > 0) {
          const [newAlert] = await db.insert(amlAlerts).values({
            alertRef: amlAlertRef(), transactionId: tx.id, status: "open",
            riskLevel: riskLevel as any,
            title: `${riskLevel.toUpperCase()} Risk: ${input.originatorName} → ${input.beneficiaryName}`,
            description: `Transaction ${tx.txRef} triggered: ${flags.join(", ")}. Amount: ${input.currency} ${input.amount.toLocaleString()}`,
            triggeredValue: input.amount, investigationId: input.investigationId,
          }).returning();
          // Auto-escalation: if risk is critical or high, check enabled alertRules with autoEscalate=true
          if (score >= 70) {
            const autoEscRules = await db.select().from(alertRules).where(
              and(eq(alertRules.enabled, true), eq(alertRules.autoEscalate, true))
            );
            if (autoEscRules.length > 0) {
              await autoEscalateToCase(db, {
                id: newAlert.id,
                alertRef: newAlert.alertRef,
                riskLevel: riskLevel,
                title: newAlert.title ?? `AML Alert ${newAlert.alertRef}`,
                description: newAlert.description ?? ``,
                transactionId: tx.id,
                investigationId: input.investigationId,
              }, ctx.user.id);
            }
          }
        }
        return tx;
      }),

    flag: writeProcedure
      .input(z.object({ id: z.number(), reason: z.string().min(10) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [tx] = await db.update(transactions)
          .set({ status: "flagged", flaggedAt: new Date(), flaggedBy: ctx.user.id, updatedAt: new Date() })
          .where(eq(transactions.id, input.id)).returning();
        await db.insert(amlAlerts).values({
          alertRef: amlAlertRef(), transactionId: tx.id, status: "open", riskLevel: "high",
          title: `Manually Flagged: ${tx.originatorName} → ${tx.beneficiaryName}`,
          description: input.reason, triggeredValue: tx.amount,
        });
        return tx;
      }),

    clear: writeProcedure
      .input(z.object({ id: z.number(), notes: z.string().optional() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [tx] = await db.update(transactions)
          .set({ status: "completed", amlRiskLevel: "low", updatedAt: new Date() })
          .where(eq(transactions.id, input.id)).returning();
        return tx;
      }),

    stats: protectedProcedure.query(async () => {
      const db = await getDb();
        if (!db) throw new Error("Database unavailable");
      const [totals] = await db.select({
        total: count(),
        totalAmount: sum(transactions.amount),
        flagged: sql<number>`count(*) filter (where ${transactions.status} = 'flagged')`,
        highRisk: sql<number>`count(*) filter (where ${transactions.amlRiskLevel} in ('high','critical'))`,
      }).from(transactions);
      return {
        total: Number(totals.total), totalAmount: Number(totals.totalAmount ?? 0),
        flagged: Number(totals.flagged), highRisk: Number(totals.highRisk),
      };
    }),

    // ─── AML Engine (Rust) direct screening ──────────────────────────────────────────
    screenWithEngine: writeProcedure
      .input(z.object({
        type: z.string(),
        amount: z.number().positive(),
        currency: z.string().length(3).default("NGN"),
        originatorName: z.string(),
        originatorAccount: z.string().optional(),
        originatorCountry: z.string().length(2).default("NG"),
        beneficiaryName: z.string(),
        beneficiaryAccount: z.string().optional(),
        beneficiaryCountry: z.string().length(2).default("NG"),
        narration: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const engineResult = await callAmlEngine("/v1/screen", {
          transaction_type: input.type,
          amount: input.amount,
          currency: input.currency,
          originator_name: input.originatorName,
          originator_account: input.originatorAccount,
          originator_country: input.originatorCountry,
          beneficiary_name: input.beneficiaryName,
          beneficiary_account: input.beneficiaryAccount,
          beneficiary_country: input.beneficiaryCountry,
          narration: input.narration,
        });
        // Fall back to local scoring if engine is offline
        const localResult = scoreTransaction({
          amount: input.amount, currency: input.currency,
          originatorCountry: input.originatorCountry, beneficiaryCountry: input.beneficiaryCountry,
          type: input.type, narration: input.narration,
        });
        return {
          engineResult,
          localScore: localResult.score,
          localFlags: localResult.flags,
          engineOnline: engineResult !== null,
          riskLevel: localResult.score >= 70 ? "critical" : localResult.score >= 50 ? "high" : localResult.score >= 25 ? "medium" : "low",
        };
      }),

    engineHealth: protectedProcedure.query(async () => {
      try {
        const res = await fetch(`${AML_ENGINE_URL}/health`, { signal: AbortSignal.timeout(3_000) });
        const data = await res.json();
        return { online: res.ok, ...data };
      } catch {
        return { online: false, status: "unreachable" };
      }
    }),
  }),

  alerts: router({
    list: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(250).default(50), offset: z.number().default(0),
        status: z.string().optional(), riskLevel: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
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

    review: writeProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["under_review", "escalated", "cleared", "filed", "false_positive"]),
        notes: z.string().optional(),
        investigationId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [alert] = await db.update(amlAlerts)
          .set({ status: input.status, reviewedBy: ctx.user.id, reviewedAt: new Date(), reviewNotes: input.notes, investigationId: input.investigationId, updatedAt: new Date() })
          .where(eq(amlAlerts.id, input.id)).returning();
        return alert;
      }),

    stats: protectedProcedure.query(async () => {
      const db = await getDb();
        if (!db) throw new Error("Database unavailable");
      const [totals] = await db.select({
        total: count(),
        open: sql<number>`count(*) filter (where ${amlAlerts.status} = 'open')`,
        escalated: sql<number>`count(*) filter (where ${amlAlerts.status} = 'escalated')`,
        cleared: sql<number>`count(*) filter (where ${amlAlerts.status} = 'cleared')`,
        critical: sql<number>`count(*) filter (where ${amlAlerts.riskLevel} = 'critical')`,
      }).from(amlAlerts);
      return {
        total: Number(totals.total), open: Number(totals.open),
        escalated: Number(totals.escalated), cleared: Number(totals.cleared), critical: Number(totals.critical),
      };
    }),
  }),

  rules: router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
        if (!db) throw new Error("Database unavailable");
      return db.select().from(amlRules).orderBy(desc(amlRules.createdAt));
    }),

    create: adminProcedure
      .input(z.object({
        name: z.string().min(3), description: z.string().optional(),
        ruleType: z.enum(["threshold", "velocity", "structuring", "round_trip", "layering",
          "high_risk_country", "pep_transaction", "sanctions_match", "unusual_pattern"]),
        threshold: z.number().optional(), currency: z.string().length(3).default("NGN"),
        windowHours: z.number().default(24),
        riskLevel: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [rule] = await db.insert(amlRules).values({ ...input, createdBy: ctx.user.id }).returning();
        return rule;
      }),

    toggle: adminProcedure
      .input(z.object({ id: z.number(), enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [rule] = await db.update(amlRules).set({ enabled: input.enabled, updatedAt: new Date() }).where(eq(amlRules.id, input.id)).returning();
        return rule;
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        await db.delete(amlRules).where(eq(amlRules.id, input.id));
        return { success: true };
      }),
  }),

  swift: router({
    list: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(250).default(50), offset: z.number().default(0),
        status: z.string().optional(), messageType: z.string().optional(), search: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const conditions = [];
        if (input.status) conditions.push(eq(swiftMessages.status, input.status as any));
        if (input.messageType) conditions.push(eq(swiftMessages.messageType, input.messageType as any));
        if (input.search) {
          conditions.push(or(
            like(swiftMessages.senderBic, `%${input.search}%`),
            like(swiftMessages.receiverBic, `%${input.search}%`),
            like(swiftMessages.uetr, `%${input.search}%`),
          )!);
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          db.select().from(swiftMessages).where(where).orderBy(desc(swiftMessages.createdAt)).limit(input.limit).offset(input.offset),
          db.select({ total: count() }).from(swiftMessages).where(where),
        ]);
        return { items: rows, total };
      }),

    create: writeProcedure
      .input(z.object({
        messageType: z.enum(["MT103", "MT202", "MT202COV", "MT199", "MT299", "MT900", "MT910", "MT940", "MT950"]),
        senderBic: z.string().min(8).max(11), receiverBic: z.string().min(8).max(11),
        amount: z.number().positive(), currency: z.string().length(3),
        valueDate: z.string().optional(), orderingCustomer: z.string().optional(),
        beneficiaryCustomer: z.string().optional(), remittanceInfo: z.string().optional(),
        rawMessage: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [msg] = await db.insert(swiftMessages).values({
          uetr: uetrGen(), messageType: input.messageType, status: "received",
          senderBic: input.senderBic, receiverBic: input.receiverBic,
          amount: input.amount, currency: input.currency,
          valueDate: input.valueDate ? new Date(input.valueDate) : new Date(),
          orderingCustomer: input.orderingCustomer, beneficiaryCustomer: input.beneficiaryCustomer,
          remittanceInfo: input.remittanceInfo, rawMessage: input.rawMessage,
          parsedFields: { field20: Date.now().toString(36).toUpperCase() },
          complianceStatus: "pending",
        }).returning();
        return msg;
      }),

    updateCompliance: writeProcedure
      .input(z.object({
        id: z.number(),
        complianceStatus: z.enum(["pending", "cleared", "blocked", "escalated"]),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const newStatus = input.complianceStatus === "cleared" ? "completed" : input.complianceStatus === "blocked" ? "rejected" : "pending_compliance";
        const [msg] = await db.update(swiftMessages)
          .set({ complianceStatus: input.complianceStatus, complianceNotes: input.notes, status: newStatus as any, updatedAt: new Date() })
          .where(eq(swiftMessages.id, input.id)).returning();
        return msg;
      }),
  }),

  sepa: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(250).default(50), offset: z.number().default(0), status: z.string().optional() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const where = input.status ? eq(sepaPayments.status, input.status as any) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          db.select().from(sepaPayments).where(where).orderBy(desc(sepaPayments.createdAt)).limit(input.limit).offset(input.offset),
          db.select({ total: count() }).from(sepaPayments).where(where),
        ]);
        return { items: rows, total };
      }),

    create: writeProcedure
      .input(z.object({
        paymentType: z.enum(["credit_transfer", "direct_debit", "instant_credit"]),
        amount: z.number().positive(), currency: z.string().length(3).default("EUR"),
        debtorName: z.string().min(2), debtorIban: z.string().min(15).max(34),
        debtorBic: z.string().optional(), creditorName: z.string().min(2),
        creditorIban: z.string().min(15).max(34), creditorBic: z.string().optional(),
        remittanceInfo: z.string().optional(), executionDate: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const endToEndId = `E2E-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const [payment] = await db.insert(sepaPayments).values({
          endToEndId, ...input,
          executionDate: input.executionDate ? new Date(input.executionDate) : new Date(),
        }).returning();
        return payment;
      }),

    settle: writeProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [payment] = await db.update(sepaPayments)
          .set({ status: "settled", settlementDate: new Date() })
          .where(eq(sepaPayments.id, input.id)).returning();
        return payment;
      }),
  }),

  travelRule: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(250).default(50), offset: z.number().default(0), status: z.string().optional() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const where = input.status ? eq(travelRuleRecords.status, input.status as any) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          db.select().from(travelRuleRecords).where(where).orderBy(desc(travelRuleRecords.createdAt)).limit(input.limit).offset(input.offset),
          db.select({ total: count() }).from(travelRuleRecords).where(where),
        ]);
        return { items: rows, total };
      }),

    create: writeProcedure
      .input(z.object({
        transactionId: z.number().optional(), thresholdAmount: z.number().default(1000),
        currency: z.string().length(3).default("USD"),
        originatorName: z.string().min(2), originatorAccount: z.string().optional(),
        originatorAddress: z.string().optional(), originatorCountry: z.string().length(2).optional(),
        originatorDob: z.string().optional(), originatorId: z.string().optional(),
        beneficiaryName: z.string().min(2), beneficiaryAccount: z.string().optional(),
        beneficiaryAddress: z.string().optional(), beneficiaryCountry: z.string().length(2).optional(),
        vasp: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const ref = `TR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
        const [record] = await db.insert(travelRuleRecords).values({ recordRef: ref, ...input, status: "pending" }).returning();
        return record;
      }),

    send: writeProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [record] = await db.update(travelRuleRecords).set({ status: "sent", sentAt: new Date() }).where(eq(travelRuleRecords.id, input.id)).returning();
        return record;
      }),

    acknowledge: writeProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [record] = await db.update(travelRuleRecords).set({ status: "acknowledged", acknowledgedAt: new Date() }).where(eq(travelRuleRecords.id, input.id)).returning();
        return record;
      }),
  }),
});
