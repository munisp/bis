/**
 * Payment Rails tRPC Router
 *
 * Exposes live transfer status, batch queue depth, and TigerBeetle account
 * balances to the React frontend via tRPC.
 *
 * Architecture (1B payments lessons):
 *   - Transfers are written to TigerBeetle in batches of 8,190
 *   - Status lifecycle: pending → posted | voided
 *   - Accounts hold balances in kobo (1 NGN = 100 kobo)
 *   - Queue depth = number of transfers awaiting the next batch flush
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure, writeProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { transactions, frozenAccounts, auditLog, exportSchedules } from "../drizzle/schema";
import { desc, eq, sql, and, gte, lt, or, ilike, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { storagePut } from "./storage";
import { ENV } from "./_core/env";
import { initiateInterBankTransfer, pollTransferStatus, getActiveRail } from "./mojaloop";
import { publishPaymentEvent } from "./dapr";
import { fluvioPublishPaymentEvent, fluvioCheckVelocity } from "./fluvio";
import { startPaymentTransferWorkflow } from "./temporal";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TransferStatus = "pending" | "posted" | "voided" | "failed" | "reversed";

export interface TransferSummary {
  id: string;
  txRef: string;
  status: TransferStatus;
  amount: number;       // in kobo
  currency: string;
  originatorName: string | null;
  beneficiaryName: string | null;
  idempotencyKey: string | null;
  tigerBeetleId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueueStats {
  pendingCount: number;
  postedLast24h: number;
  failedLast24h: number;
  reversedLast24h: number;
  avgProcessingMs: number;
  batchSize: number;        // TigerBeetle optimal batch = 8,190
  estimatedTps: number;     // based on last 1-minute window
}

export interface AccountBalance {
  accountId: string;
  accountName: string;
  debitsPending: number;    // kobo
  debitsPosted: number;     // kobo
  creditsPending: number;   // kobo
  creditsPosted: number;    // kobo
  netBalance: number;       // kobo (creditsPosted - debitsPosted)
  currency: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function mapStatus(s: string): TransferStatus {
  const map: Record<string, TransferStatus> = {
    completed: "posted",
    failed: "failed",
    reversed: "reversed",
    blocked: "voided",
    pending: "pending",
    under_review: "pending",
    flagged: "pending",
  };
  return map[s] ?? "pending";
}

// ── Router ─────────────────────────────────────────────────────────────────────

export const paymentRailsRouter = router({
  /**
   * List recent transfers with optional status filter and pagination.
   * Returns transfers in descending order of creation time.
   */
  /**
   * POST /paymentRails/initiateTransfer — create a new payment transfer
   */
  initiateTransfer: writeProcedure
    .input(
      z.object({
        originatorAccountId: z.string().min(1),
        beneficiaryAccountId: z.string().min(1),
        beneficiaryName: z.string().min(1).max(128),
        amount: z.number().positive(), // NGN
        currency: z.string().default("NGN"),
        narration: z.string().max(256).optional(),
        reference: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const txRef = input.reference ?? `TXN-${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      const amountKobo = Math.round(input.amount * 100);

      // ── Idempotency: if a transaction with this reference already exists, return it ──
      if (input.reference) {
        const [existing] = await db.select().from(transactions)
          .where(eq(transactions.txRef, input.reference)).limit(1);
        if (existing) {
          return { success: true, txRef: existing.txRef, id: existing.id, status: existing.status as any, rail: getActiveRail(), idempotent: true };
        }
      }

      // ── Fluvio velocity pre-flight gate ──────────────────────────────────────
      // Query the sliding-window velocity processor before submitting to the rail.
      // A BLOCK decision means the account has exceeded its transaction velocity
      // threshold (e.g., >10 transfers in 60 s or >₦5M in 5 min) and the transfer
      // is rejected before any money moves.
      const tenantId = String((ctx.user as { tenantId?: string | number } | null)?.tenantId ?? "default");
      const velocityDecision = await fluvioCheckVelocity({
        account_id: input.originatorAccountId,
        amount_kobo: Math.round(input.amount * 100),
        currency: input.currency,
        tenant_id: tenantId,
      });
      if (velocityDecision.decision === "block") {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: velocityDecision.reason ?? "Transfer blocked by velocity control — please try again later",
        });
      }

      // Initiate via Mojaloop → NIBSS NIP → Sandbox
      let externalRef: string | undefined;
      let finalStatus: "pending" | "completed" | "failed" = "pending";
      const activeRail = getActiveRail();
      try {
        const railResult = await initiateInterBankTransfer({
          txRef,
          originatorAccount: input.originatorAccountId,
          originatorName: input.originatorAccountId,
          beneficiaryAccount: input.beneficiaryAccountId,
          beneficiaryName: input.beneficiaryName,
          beneficiaryBankCode: (input as any).beneficiaryBankCode ?? "000",
          amountKobo,
          currency: input.currency,
          narration: input.narration,
        });
        externalRef = railResult.externalRef;
        finalStatus = railResult.status === "completed" ? "completed" : "pending";
      } catch (err) {
        console.error(`[PaymentRails] ${activeRail} initiation failed for ${txRef}:`, err);
        // Store as failed rather than silently dropping
        finalStatus = "failed";
      }

      const dbStatus = finalStatus === "completed" ? "completed" as const :
                       finalStatus === "failed"    ? "failed" as const :
                                                     "pending" as const;

      const [created] = await db
        .insert(transactions)
        .values({
          txRef,
          type: "nip" as const,
          status: dbStatus,
          amount: amountKobo,
          currency: input.currency,
          originatorName: input.originatorAccountId,
          originatorAccount: input.originatorAccountId,
          beneficiaryAccount: input.beneficiaryAccountId,
          beneficiaryName: input.beneficiaryName,
          narration: input.narration ?? undefined,
          tigerBeetleId: externalRef ?? undefined,
        })
        .returning();
      // Dapr pub/sub: publish payment event (non-blocking)
      publishPaymentEvent({ eventType: "initiated", txRef, amountKobo, currency: input.currency, rail: activeRail }).catch(() => {});
      // Fluvio velocity processor: publish payment event for sliding-window velocity checks (non-blocking)
      fluvioPublishPaymentEvent({
        event_type: "initiated",
        tx_ref: txRef,
        account_id: input.originatorAccountId,
        amount_kobo: amountKobo,
        currency: input.currency,
        rail: activeRail,
        tenant_id: tenantId,
      }).catch(() => {});
      // Temporal saga: start PaymentTransferWorkflow for retry, timeout escalation, and compensation.
      // Only start the saga for pending transfers — completed/failed transfers don't need it.
      // Non-blocking: a Temporal outage must not block the payment response.
      if (dbStatus === "pending") {
        startPaymentTransferWorkflow({
          txRef,
          transactionId: created.id,
          originatorAccountId: input.originatorAccountId,
          beneficiaryAccountId: input.beneficiaryAccountId,
          beneficiaryName: input.beneficiaryName,
          amountKobo,
          currency: input.currency,
          rail: activeRail,
          narration: input.narration,
        }).catch(err => {
          console.warn(`[Temporal] PaymentTransferWorkflow start failed for ${txRef} (non-fatal):`, err);
        });
      }
      return { success: true, txRef, id: created.id, status: dbStatus, rail: activeRail };
    }),

  listTransfers: protectedProcedure
    .input(z.object({
      status: z.enum(["all", "pending", "posted", "voided", "failed", "reversed"]).default("all"),
      limit: z.number().min(1).max(200).default(50),
      cursor: z.string().optional(), // last transfer ID for cursor pagination
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Map TigerBeetle status back to DB status values
      const statusMap: Record<string, string[]> = {
        pending: ["pending", "under_review", "flagged"],
        posted: ["completed"],
        voided: ["blocked"],
        failed: ["failed"],
        reversed: ["reversed"],
      };

      const dbStatuses = input.status === "all" ? null : statusMap[input.status] ?? null;

      const rows = await db.select({
        id: transactions.id,
        txRef: transactions.txRef,
        status: transactions.status,
        amount: transactions.amount,
        currency: transactions.currency,
        originatorName: transactions.originatorName,
        beneficiaryName: transactions.beneficiaryName,
        idempotencyKey: transactions.idempotencyKey,
        tigerBeetleId: transactions.tigerBeetleId,
        createdAt: transactions.createdAt,
        updatedAt: transactions.updatedAt,
      })
        .from(transactions)
        .where(
          dbStatuses
            ? sql`${transactions.status} IN (${sql.join(dbStatuses.map(s => sql`${s}`), sql`, `)})`
            : undefined
        )
        .orderBy(desc(transactions.createdAt))
        .limit(input.limit + 1); // fetch one extra to determine if there's a next page

      const hasMore = rows.length > input.limit;
      const items = rows.slice(0, input.limit).map(r => ({
        ...r,
        status: mapStatus(r.status ?? "pending"),
        amount: r.amount ?? 0,
      }));

      return {
        items,
        hasMore,
        nextCursor: hasMore ? items[items.length - 1]?.txRef ?? null : null,
      };
    }),

  /**
   * Get a single transfer by ID.
   */
  getTransfer: protectedProcedure
    .input(z.object({ txRef: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [row] = await db.select().from(transactions)
        .where(eq(transactions.txRef, input.txRef))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });

      return {
        ...row,
        status: mapStatus(row.status ?? "pending"),
      };
    }),

  /**
   * Queue and batch statistics for the payment pipeline.
   * Reflects the 1B payments lesson: monitor batch depth and TPS in real time.
   */
  getQueueStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last1min = new Date(now.getTime() - 60 * 1000);

    const [pendingResult] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`${transactions.status} IN ('pending', 'under_review', 'flagged')`);

    const [postedResult] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(
        eq(transactions.status, "completed"),
        gte(transactions.createdAt, last24h)
      ));

    const [failedResult] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(
        eq(transactions.status, "failed"),
        gte(transactions.createdAt, last24h)
      ));

    const [reversedResult] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(
        eq(transactions.status, "reversed"),
        gte(transactions.createdAt, last24h)
      ));

    // TPS estimate: count completed transactions in last 60 seconds
    const [tpsResult] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(
        eq(transactions.status, "completed"),
        gte(transactions.createdAt, last1min)
      ));

    const pendingCount = Number(pendingResult?.count ?? 0);
    const postedLast24h = Number(postedResult?.count ?? 0);
    const failedLast24h = Number(failedResult?.count ?? 0);
    const reversedLast24h = Number(reversedResult?.count ?? 0);
    const tpsCount = Number(tpsResult?.count ?? 0);

    return {
      pendingCount,
      postedLast24h,
      failedLast24h,
      reversedLast24h,
      avgProcessingMs: pendingCount > 0 ? 12 : 0, // Estimated from TigerBeetle batch latency
      batchSize: 8190,                              // TigerBeetle MaxBatchSize
      estimatedTps: Math.round(tpsCount / 60),      // Transfers per second in last minute
    } satisfies QueueStats;
  }),

  /**
   * Get account balances from the transactions table.
   * Aggregates debits and credits per originator/beneficiary account.
   *
   * Note: In production, this would query TigerBeetle directly via the Go
   * payment-rails service. Here we derive balances from the MySQL transactions table.
   */
  getAccountBalances: protectedProcedure
    .input(z.object({
      accountIds: z.array(z.string()).max(50).optional(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Aggregate debits (originator) per account
      const debits = await db.select({
        accountId: transactions.originatorAccount,
        accountName: transactions.originatorName,
        totalDebits: sql<number>`sum(${transactions.amount})`,
        pendingDebits: sql<number>`sum(case when ${transactions.status} in ('pending','under_review','flagged') then ${transactions.amount} else 0 end)`,
        postedDebits: sql<number>`sum(case when ${transactions.status} = 'completed' then ${transactions.amount} else 0 end)`,
        currency: transactions.currency,
      })
        .from(transactions)
        .where(sql`${transactions.originatorAccount} IS NOT NULL`)
        .groupBy(transactions.originatorAccount, transactions.originatorName, transactions.currency)
        .limit(input.limit);

      // Aggregate credits (beneficiary) per account
      const credits = await db.select({
        accountId: transactions.beneficiaryAccount,
        accountName: transactions.beneficiaryName,
        totalCredits: sql<number>`sum(${transactions.amount})`,
        pendingCredits: sql<number>`sum(case when ${transactions.status} in ('pending','under_review','flagged') then ${transactions.amount} else 0 end)`,
        postedCredits: sql<number>`sum(case when ${transactions.status} = 'completed' then ${transactions.amount} else 0 end)`,
        currency: transactions.currency,
      })
        .from(transactions)
        .where(sql`${transactions.beneficiaryAccount} IS NOT NULL`)
        .groupBy(transactions.beneficiaryAccount, transactions.beneficiaryName, transactions.currency)
        .limit(input.limit);

      // Merge debit and credit maps
      const balanceMap = new Map<string, AccountBalance>();

      for (const d of debits) {
        if (!d.accountId) continue;
        balanceMap.set(d.accountId, {
          accountId: d.accountId,
          accountName: d.accountName ?? d.accountId,
          debitsPending: Number(d.pendingDebits ?? 0),
          debitsPosted: Number(d.postedDebits ?? 0),
          creditsPending: 0,
          creditsPosted: 0,
          netBalance: -Number(d.postedDebits ?? 0),
          currency: d.currency ?? "NGN",
        });
      }

      for (const c of credits) {
        if (!c.accountId) continue;
        const existing = balanceMap.get(c.accountId);
        if (existing) {
          existing.creditsPending = Number(c.pendingCredits ?? 0);
          existing.creditsPosted = Number(c.postedCredits ?? 0);
          existing.netBalance = existing.creditsPosted - existing.debitsPosted;
        } else {
          balanceMap.set(c.accountId, {
            accountId: c.accountId,
            accountName: c.accountName ?? c.accountId,
            debitsPending: 0,
            debitsPosted: 0,
            creditsPending: Number(c.pendingCredits ?? 0),
            creditsPosted: Number(c.postedCredits ?? 0),
            netBalance: Number(c.postedCredits ?? 0),
            currency: c.currency ?? "NGN",
          });
        }
      }

      const balances = Array.from(balanceMap.values())
        .sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));

      return { balances, totalAccounts: balanceMap.size };
    }),

  /**
   * Search transfers by txRef, originator name, beneficiary name, or account number.
   * Debounced on the frontend; returns up to 30 matches.
   */
  searchTransfers: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(128),
      limit: z.number().min(1).max(50).default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const q = `%${input.query}%`;
      const rows = await db.select({
        id: transactions.id,
        txRef: transactions.txRef,
        status: transactions.status,
        amount: transactions.amount,
        currency: transactions.currency,
        originatorName: transactions.originatorName,
        originatorAccount: transactions.originatorAccount,
        beneficiaryName: transactions.beneficiaryName,
        beneficiaryAccount: transactions.beneficiaryAccount,
        idempotencyKey: transactions.idempotencyKey,
        tigerBeetleId: transactions.tigerBeetleId,
        createdAt: transactions.createdAt,
        updatedAt: transactions.updatedAt,
      })
        .from(transactions)
        .where(or(
          ilike(transactions.txRef, q),
          ilike(transactions.originatorName, q),
          ilike(transactions.beneficiaryName, q),
          ilike(transactions.originatorAccount, q),
          ilike(transactions.beneficiaryAccount, q),
        ))
        .orderBy(desc(transactions.createdAt))
        .limit(input.limit);
      return {
        items: rows.map(r => ({ ...r, status: mapStatus(r.status ?? "pending"), amount: r.amount ?? 0 })),
        query: input.query,
      };
    }),

  /**
   * Get full account detail: balance summary + recent transfer history + daily chart series.
   * Used by the /payment-rails/accounts/:accountId detail page.
   */
  getAccountDetail: protectedProcedure
    .input(z.object({
      accountId: z.string().min(1).max(64),
      historyLimit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [debitRow] = await db.select({
        accountName: transactions.originatorName,
        postedDebits: sql<number>`coalesce(sum(case when ${transactions.status} = 'completed' then ${transactions.amount} else 0 end), 0)`,
        pendingDebits: sql<number>`coalesce(sum(case when ${transactions.status} in ('pending','under_review','flagged') then ${transactions.amount} else 0 end), 0)`,
        currency: transactions.currency,
      })
        .from(transactions)
        .where(eq(transactions.originatorAccount, input.accountId))
        .groupBy(transactions.originatorName, transactions.currency)
        .limit(1);

      const [creditRow] = await db.select({
        accountName: transactions.beneficiaryName,
        postedCredits: sql<number>`coalesce(sum(case when ${transactions.status} = 'completed' then ${transactions.amount} else 0 end), 0)`,
        pendingCredits: sql<number>`coalesce(sum(case when ${transactions.status} in ('pending','under_review','flagged') then ${transactions.amount} else 0 end), 0)`,
        currency: transactions.currency,
      })
        .from(transactions)
        .where(eq(transactions.beneficiaryAccount, input.accountId))
        .groupBy(transactions.beneficiaryName, transactions.currency)
        .limit(1);

      if (!debitRow && !creditRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }

      const accountName = debitRow?.accountName ?? creditRow?.accountName ?? input.accountId;
      const currency = debitRow?.currency ?? creditRow?.currency ?? "NGN";
      const debitsPosted = Number(debitRow?.postedDebits ?? 0);
      const creditsPosted = Number(creditRow?.postedCredits ?? 0);
      const debitsPending = Number(debitRow?.pendingDebits ?? 0);
      const creditsPending = Number(creditRow?.pendingCredits ?? 0);

      const history = await db.select({
        txRef: transactions.txRef,
        status: transactions.status,
        amount: transactions.amount,
        currency: transactions.currency,
        originatorName: transactions.originatorName,
        originatorAccount: transactions.originatorAccount,
        beneficiaryName: transactions.beneficiaryName,
        beneficiaryAccount: transactions.beneficiaryAccount,
        createdAt: transactions.createdAt,
        idempotencyKey: transactions.idempotencyKey,
      })
        .from(transactions)
        .where(or(
          eq(transactions.originatorAccount, input.accountId),
          eq(transactions.beneficiaryAccount, input.accountId),
        ))
        .orderBy(desc(transactions.createdAt))
        .limit(input.historyLimit);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const dailySeries = await db.select({
        day: sql<string>`DATE(${transactions.createdAt})`,
        credits: sql<number>`coalesce(sum(case when ${transactions.beneficiaryAccount} = ${input.accountId} and ${transactions.status} = 'completed' then ${transactions.amount} else 0 end), 0)`,
        debits: sql<number>`coalesce(sum(case when ${transactions.originatorAccount} = ${input.accountId} and ${transactions.status} = 'completed' then ${transactions.amount} else 0 end), 0)`,
      })
        .from(transactions)
        .where(and(
          gte(transactions.createdAt, thirtyDaysAgo),
          or(
            eq(transactions.originatorAccount, input.accountId),
            eq(transactions.beneficiaryAccount, input.accountId),
          )
        ))
        .groupBy(sql`DATE(${transactions.createdAt})`)
        .orderBy(sql`DATE(${transactions.createdAt})`);

      return {
        accountId: input.accountId,
        accountName,
        currency,
        balance: {
          debitsPosted,
          creditsPosted,
          debitsPending,
          creditsPending,
          net: creditsPosted - debitsPosted,
        },
        history: history.map(r => ({ ...r, status: mapStatus(r.status ?? "pending"), amount: r.amount ?? 0 })),
        dailySeries: dailySeries.map(d => ({
          day: d.day,
          credits: Number(d.credits),
          debits: Number(d.debits),
          net: Number(d.credits) - Number(d.debits),
        })),
      };
    }),

  /**
   * Freeze an account — blocks all pending transfers from/to this account.
   * Admin-only. Flags all pending/under_review transactions as blocked.
   */
  freezeAccount: adminProcedure
    .input(z.object({
      accountId: z.string().min(1).max(64),
      accountName: z.string().max(255).optional(),
      reason: z.string().min(1).max(512),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const result = await db
        .update(transactions)
        .set({ status: "blocked", updatedAt: new Date() })
        .where(and(
          sql`${transactions.status} IN ('pending', 'under_review')`,
          or(
            eq(transactions.originatorAccount, input.accountId),
            eq(transactions.beneficiaryAccount, input.accountId),
          )
        ));
      const affected = (result as any).rowsAffected ?? 0;
      // Write audit log entry
      await db.insert(frozenAccounts).values({
        accountId: input.accountId,
        accountName: input.accountName ?? null,
        reason: input.reason,
        frozenBy: ctx.user.id,
        frozenByName: ctx.user.name ?? ctx.user.email ?? "Admin",
        affectedTransactions: affected,
        frozenAt: new Date(),
      });
      // Publish freeze event to Dapr pub/sub for AML/compliance engine (non-blocking)
      const { publishAmlAlert } = await import("./dapr");
      publishAmlAlert({
        alertId: 0,
        alertType: "account_frozen",
        riskScore: 100,
        subjectRef: input.accountId,
        transactionRef: `freeze-${input.accountId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
      return {
        accountId: input.accountId,
        frozenAt: new Date(),
        reason: input.reason,
        affectedTransactions: affected,
      };
    }),

  /**
   * Get freeze history for an account.
   */
  getFreezeHistory: protectedProcedure
    .input(z.object({
      accountId: z.string().min(1).max(64),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db
        .select()
        .from(frozenAccounts)
        .where(eq(frozenAccounts.accountId, input.accountId))
        .orderBy(desc(frozenAccounts.frozenAt))
        .limit(input.limit);
      return { events: rows, accountId: input.accountId };
    }),

  /**
   * Unfreeze an account — admin only.
   * Records the unfreeze event on the existing freeze log entry.
   */
  unfreezeAccount: adminProcedure
    .input(z.object({
      accountId: z.string().min(1).max(64),
      notes: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Mark the most recent freeze event as unfrozen
      const [latest] = await db
        .select({ id: frozenAccounts.id })
        .from(frozenAccounts)
        .where(and(eq(frozenAccounts.accountId, input.accountId), sql`${frozenAccounts.unfrozenAt} IS NULL`))
        .orderBy(desc(frozenAccounts.frozenAt))
        .limit(1);
      if (latest) {
        await db
          .update(frozenAccounts)
          .set({
            unfrozenAt: new Date(),
            unfrozenBy: ctx.user.id,
            unfrozenByName: ctx.user.name ?? ctx.user.email ?? "Admin",
            notes: input.notes ?? null,
          })
          .where(eq(frozenAccounts.id, latest.id));
      }
      // Publish unfreeze event to Dapr pub/sub for AML/compliance engine (non-blocking)
      const { publishAmlAlert } = await import("./dapr");
      publishAmlAlert({
        alertId: 0,
        alertType: "account_unfrozen",
        riskScore: 0,
        subjectRef: input.accountId,
        transactionRef: `unfreeze-${input.accountId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
      return { accountId: input.accountId, unfrozenAt: new Date() };
    }),

  /**
   * Export transfers to CSV and return a signed S3 URL.
   * Applies the same status/search filters as listTransfers.
   * Limited to 10,000 rows per export to avoid memory pressure.
   */
  exportTransfers: adminProcedure
    .input(z.object({
      status: z.enum(["all", "pending", "posted", "voided", "failed", "reversed"]).default("all"),
      search: z.string().max(100).optional(),
      accountId: z.string().max(64).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: ReturnType<typeof and>[] = [];
      if (input.status !== "all") {
        const statusMap: Record<string, string[]> = {
          pending: ["pending", "under_review", "flagged"],
          posted: ["completed"],
          voided: ["blocked"],
          failed: ["failed"],
          reversed: ["reversed"],
        };
        const dbStatuses = statusMap[input.status] ?? [];
        if (dbStatuses.length > 0) {
          conditions.push(sql`${transactions.status} IN (${sql.join(dbStatuses.map(s => sql`${s}`), sql`, `)})`);
        }
      }
      if (input.search && input.search.length >= 2) {
        const q = `%${input.search}%`;
        conditions.push(or(
          ilike(transactions.txRef, q),
          ilike(transactions.originatorName, q),
          ilike(transactions.beneficiaryName, q),
          ilike(transactions.originatorAccount, q),
          ilike(transactions.beneficiaryAccount, q),
        ));
      }
      if (input.accountId) {
        conditions.push(or(
          eq(transactions.originatorAccount, input.accountId),
          eq(transactions.beneficiaryAccount, input.accountId),
        ));
      }

      const rows = await db
        .select({
          txRef: transactions.txRef,
          type: transactions.type,
          status: transactions.status,
          amount: transactions.amount,
          currency: transactions.currency,
          originatorName: transactions.originatorName,
          originatorAccount: transactions.originatorAccount,
          originatorBank: transactions.originatorBank,
          beneficiaryName: transactions.beneficiaryName,
          beneficiaryAccount: transactions.beneficiaryAccount,
          beneficiaryBank: transactions.beneficiaryBank,
          purposeCode: transactions.purposeCode,
          amlRiskLevel: transactions.amlRiskLevel,
          amlScore: transactions.amlScore,
          idempotencyKey: transactions.idempotencyKey,
          tigerBeetleId: transactions.tigerBeetleId,
          createdAt: transactions.createdAt,
          updatedAt: transactions.updatedAt,
        })
        .from(transactions)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(transactions.createdAt))
        .limit(10_000);

      // Build CSV
      const headers = [
        "txRef", "type", "status", "amount", "currency",
        "originatorName", "originatorAccount", "originatorBank",
        "beneficiaryName", "beneficiaryAccount", "beneficiaryBank",
        "purposeCode", "amlRiskLevel", "amlScore",
        "idempotencyKey", "tigerBeetleId", "createdAt", "updatedAt",
      ] as const;
      const escape = (v: unknown): string => {
        if (v === null || v === undefined) return "";
        const s = String(v instanceof Date ? v.toISOString() : v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };
      const csvLines = [
        headers.join(","),
        ...rows.map(r => headers.map(h => escape(r[h as keyof typeof r])).join(",")),
      ];
      const csvContent = csvLines.join("\n");

      // Upload to S3
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      const fileKey = `exports/transfers-${ts}-${suffix}.csv`;
      const { url } = await storagePut(fileKey, csvContent, "text/csv");

      return {
        url,
        fileKey,
        rowCount: rows.length,
        exportedAt: new Date(),
        filters: { status: input.status, search: input.search ?? null, accountId: input.accountId ?? null },
      };
    }),

  /**
   * Reverse a posted transfer (admin only).
   */
  reverseTransfer: adminProcedure
    .input(z.object({
      txRef: z.string().min(1),
      reason: z.string().min(5).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [tx] = await db.select().from(transactions).where(eq(transactions.txRef, input.txRef)).limit(1);
      if (!tx) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });
      if (tx.status !== "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "Only completed transfers can be reversed" });
      const reversalRef = `REV-${input.txRef}-${Date.now()}`;
      await db.transaction(async (trx) => {
        await trx.update(transactions)
          .set({ status: "reversed" as any, updatedAt: new Date() })
          .where(eq(transactions.txRef, input.txRef));
        await trx.insert(transactions).values({
          txRef: reversalRef,
          type: tx.type,
          amount: tx.amount,
          currency: tx.currency,
          originatorName: tx.beneficiaryName ?? "Unknown",
          originatorAccount: tx.beneficiaryAccount,
          beneficiaryName: tx.originatorName ?? "Unknown",
          beneficiaryAccount: tx.originatorAccount,
          status: "completed" as any,
          narration: `Reversal of ${input.txRef}: ${input.reason}`,
          idempotencyKey: `reversal-${input.txRef}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
      await db.insert(auditLog).values({
        userId: ctx.user.id,
        action: "transfer.reversed",
        targetRef: input.txRef,
        detail: { reason: input.reason, reversalRef },
        category: "financial" as any,
        result: "success" as any,
        createdAt: new Date(),
      }).catch(() => {});
      // Publish reversal event to Dapr pub/sub and Fluvio velocity processor (non-blocking)
      publishPaymentEvent({ eventType: "reversed", txRef: input.txRef, amountKobo: tx.amount ?? 0, currency: tx.currency ?? "NGN", rail: "reversal" }).catch(() => {});
      fluvioPublishPaymentEvent({
        event_type: "reversed",
        tx_ref: input.txRef,
        account_id: tx.originatorAccount ?? "",
        amount_kobo: tx.amount ?? 0,
        currency: tx.currency ?? "NGN",
        rail: "reversal",
        tenant_id: String((ctx.user as { tenantId?: string | number } | null)?.tenantId ?? "default"),
      }).catch(() => {});
      return { reversalRef, originalTxRef: input.txRef };
    }),

  /**
   * List all currently frozen accounts.
   */
  listFrozenAccounts: adminProcedure
    .input(z.object({
      includeUnfrozen: z.boolean().default(false),
      cursor: z.number().default(0),
      limit: z.number().min(1).max(100).default(25),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { rows: [], nextCursor: null };
      const limit = input?.limit ?? 25;
      const cursor = input?.cursor ?? 0;
      const conditions = input?.includeUnfrozen ? undefined : isNull(frozenAccounts.unfrozenAt);
      const rows = await db.select().from(frozenAccounts)
        .where(conditions)
        .orderBy(desc(frozenAccounts.frozenAt))
        .limit(limit + 1)
        .offset(cursor);
      const hasMore = rows.length > limit;
      return { rows: rows.slice(0, limit), nextCursor: hasMore ? cursor + limit : null };
    }),

  /**
   * Bulk unfreeze multiple accounts.
   */
  bulkUnfreeze: adminProcedure
    .input(z.object({
      accountIds: z.array(z.string()).min(1).max(50),
      reason: z.string().min(5).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const now = new Date();
      await db.update(frozenAccounts)
        .set({ unfrozenAt: now, notes: input.reason, unfrozenBy: ctx.user.id })
        .where(and(
          inArray(frozenAccounts.accountId, input.accountIds),
          isNull(frozenAccounts.unfrozenAt)
        ));
      return { unfrozen: input.accountIds.length, at: now };
    }),

  /**
   * Create a recurring export schedule.
   */
  createExportSchedule: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      schedule: z.enum(["daily", "weekly", "monthly"]),
      filters: z.object({
        status: z.string().optional(),
        accountId: z.string().optional(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const cronMap = { daily: "0 2 * * *", weekly: "0 2 * * 1", monthly: "0 2 1 * *" };
      const [row] = await db.insert(exportSchedules).values({
        name: input.name,
        exportType: "transfers",
        format: "csv",
        cronExpression: cronMap[input.schedule],
        filters: input.filters ?? {},
        userId: ctx.user.id,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();
      return row;
    }),

  /**
   * List export schedules.
   */
  listExportSchedules: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(exportSchedules)
      .where(eq(exportSchedules.exportType, "transfers"))
      .orderBy(desc(exportSchedules.createdAt));
  }),

  /**
   * Get batch processing monitor stats.
   */
  getBatchMonitor: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last1h = new Date(now.getTime() - 60 * 60 * 1000);
    const [total24h] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions).where(gte(transactions.createdAt, last24h));
    const [total1h] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions).where(gte(transactions.createdAt, last1h));
    const [reversed24h] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions).where(and(
        gte(transactions.createdAt, last24h),
        eq(transactions.status, "reversed" as any)
      ));
    const [failed24h] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions).where(and(
        gte(transactions.createdAt, last24h),
        eq(transactions.status, "failed")
      ));
    const batchSize = 8190;
    const tps1h = Math.round(Number(total1h?.count ?? 0) / 3600);
    const batchSaturation = Math.min(100, Math.round((tps1h / (batchSize / 60)) * 100));
    return {
      last24h: Number(total24h?.count ?? 0),
      last1h: Number(total1h?.count ?? 0),
      tps: tps1h,
      reversed24h: Number(reversed24h?.count ?? 0),
      failed24h: Number(failed24h?.count ?? 0),
      batchSize,
      batchSaturation,
      maxThroughput: "8,190 transfers/batch",
    };
  }),

  /**
   * Get archival tier statistics (delegates to archivalRouter.getTierConfig).
   * Exposed here so the Payment Rails page can show tiering status.
   */
  getArchivalStats: adminProcedure.query(async () => {
    const { TIERS } = await import("./archival");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const now = new Date();
    const hotCutoff = new Date(now.getTime() - TIERS.HOT.maxAgeDays * 24 * 60 * 60 * 1000);
    const warmCutoff = new Date(now.getTime() - TIERS.WARM.maxAgeDays * 24 * 60 * 60 * 1000);

    const [hotCount] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(gte(transactions.createdAt, hotCutoff));

    const [warmCount] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(
        lt(transactions.createdAt, hotCutoff),
        gte(transactions.createdAt, warmCutoff)
      ));

    const [coldCount] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(lt(transactions.createdAt, warmCutoff));

    return {
      tiers: {
        hot: { ...TIERS.HOT, count: Number(hotCount?.count ?? 0) },
        warm: { ...TIERS.WARM, count: Number(warmCount?.count ?? 0) },
        cold: { ...TIERS.COLD, count: Number(coldCount?.count ?? 0) },
      },
      nextArchivalRun: "02:00 UTC daily",
    };
  }),

  /**
   * Transfer analytics: daily/weekly/monthly NGN volume, count, and status breakdown.
   * Used by the /payment-rails/analytics dashboard.
   */
  getTransferAnalytics: protectedProcedure
    .input(z.object({
      period: z.enum(["daily", "weekly", "monthly"]).default("daily"),
      days: z.number().min(7).max(365).default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      // Get all transactions in the period
      const rows = await db
        .select({
          createdAt: transactions.createdAt,
          amount: transactions.amount,
          currency: transactions.currency,
          status: transactions.status,
          amlScore: transactions.amlScore,
        })
        .from(transactions)
        .where(gte(transactions.createdAt, since))
        .orderBy(transactions.createdAt);

      // Group by period bucket
      const buckets: Record<string, { date: string; volume: number; count: number; flagged: number; blocked: number; avgRisk: number; riskSum: number }> = {};

      for (const row of rows) {
        const d = new Date(row.createdAt);
        let key: string;
        if (input.period === "daily") {
          key = d.toISOString().slice(0, 10);
        } else if (input.period === "weekly") {
          // ISO week: Monday-based
          const day = d.getDay() || 7;
          const monday = new Date(d);
          monday.setDate(d.getDate() - day + 1);
          key = monday.toISOString().slice(0, 10);
        } else {
          key = d.toISOString().slice(0, 7); // YYYY-MM
        }

        if (!buckets[key]) {
          buckets[key] = { date: key, volume: 0, count: 0, flagged: 0, blocked: 0, avgRisk: 0, riskSum: 0 };
        }
        const amountNgn = (row.amount ?? 0) / 100; // kobo → NGN
        buckets[key].volume += amountNgn;
        buckets[key].count += 1;
        if (row.status === "flagged") buckets[key].flagged += 1;
        if (row.status === "blocked") buckets[key].blocked += 1;
        buckets[key].riskSum += (row.amlScore ?? 0);
      }

      const series = Object.values(buckets)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(b => ({
          ...b,
          avgRisk: b.count > 0 ? Math.round(b.riskSum / b.count) : 0,
          riskSum: undefined,
        }));

      // Overall stats
      const totalVolume = rows.reduce((s, r) => s + (r.amount ?? 0) / 100, 0);
      const totalCount = rows.length;
      const flaggedCount = rows.filter(r => r.status === "flagged").length;
      const blockedCount = rows.filter(r => r.status === "blocked").length;
      const avgRiskScore = totalCount > 0
        ? Math.round(rows.reduce((s, r) => s + (r.amlScore ?? 0), 0) / totalCount)
        : 0;

      // Currency breakdown
      const byCurrency: Record<string, number> = {};
      for (const r of rows) {
        const ccy = r.currency ?? "NGN";
        byCurrency[ccy] = (byCurrency[ccy] ?? 0) + (r.amount ?? 0) / 100;
      }

      return {
        series,
        summary: { totalVolume, totalCount, flaggedCount, blockedCount, avgRiskScore },
        byCurrency,
        period: input.period,
        days: input.days,
      };
    }),

  /**
   * Payment reconciliation: compare expected vs actual settled transfers.
   * Identifies mismatches, pending settlements, and failed reversals.
   */
  getReconciliationReport: adminProcedure
    .input(z.object({
      date: z.string().optional(), // YYYY-MM-DD, defaults to yesterday
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const targetDate = input.date ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const dayStart = new Date(`${targetDate}T00:00:00.000Z`);
      const dayEnd = new Date(`${targetDate}T23:59:59.999Z`);

      const dayTxns = await db
        .select()
        .from(transactions)
        .where(and(gte(transactions.createdAt, dayStart), lt(transactions.createdAt, dayEnd)))
        .orderBy(transactions.createdAt);

      const posted = dayTxns.filter(t => t.status === "completed");
      const pending = dayTxns.filter(t => t.status === "pending");
      const failed = dayTxns.filter(t => t.status === "failed");
      const reversed = dayTxns.filter(t => t.status === "reversed");
      const flagged = dayTxns.filter(t => t.status === "flagged");
      const blocked = dayTxns.filter(t => t.status === "blocked");

      const totalSettled = posted.reduce((s: number, t: typeof dayTxns[0]) => s + (t.amount ?? 0) / 100, 0);
      const totalPending = pending.reduce((s: number, t: typeof dayTxns[0]) => s + (t.amount ?? 0) / 100, 0);
      const totalFailed = failed.reduce((s: number, t: typeof dayTxns[0]) => s + (t.amount ?? 0) / 100, 0);
      const totalReversed = reversed.reduce((s: number, t: typeof dayTxns[0]) => s + (t.amount ?? 0) / 100, 0);

      // Settlement rate
      const settlementRate = dayTxns.length > 0
        ? Math.round((posted.length / dayTxns.length) * 100)
        : 100;

      // Identify mismatches: transactions that should have settled but are still pending >1h
      const oneHourAgo = new Date(Date.now() - 3600000);
      const stalePending = pending.filter(t => new Date(t.createdAt) < oneHourAgo);

      return {
        date: targetDate,
        summary: {
          total: dayTxns.length,
          posted: posted.length,
          pending: pending.length,
          failed: failed.length,
          reversed: reversed.length,
          flagged: flagged.length,
          blocked: blocked.length,
          settlementRate,
        },
        volumes: {
          settled: totalSettled,
          pending: totalPending,
          failed: totalFailed,
          reversed: totalReversed,
        },
        stalePending: stalePending.map(t => ({
          id: t.id,
          txRef: t.txRef,
          amount: (t.amount ?? 0) / 100,
          currency: t.currency,
          originatorName: t.originatorName,
          beneficiaryName: t.beneficiaryName,
          createdAt: t.createdAt,
          ageMinutes: Math.round((Date.now() - new Date(t.createdAt).getTime()) / 60000),
        })),
        flaggedTransactions: flagged.slice(0, 20).map(t => ({
          id: t.id,
          txRef: t.txRef,
          amount: (t.amount ?? 0) / 100,
          currency: t.currency,
          riskScore: t.amlScore,
          originatorName: t.originatorName,
          beneficiaryName: t.beneficiaryName,
        })),
      };
    }),

  /**
   * NIP Name Enquiry — resolve a 10-digit NUBAN account number to account holder name.
   * Checks our own transactions table first, then falls back to a deterministic mock
   * that simulates the NIBSS NIP name-enquiry API response.
   * In production: POST to GATEWAY_SANDBOX/nip/name-enquiry with bankCode + accountNumber.
   */
  lookupAccount: protectedProcedure
    .input(z.object({
      accountNumber: z.string().min(10).max(10).regex(/^\d{10}$/, 'Must be a 10-digit NUBAN'),
      bankCode: z.string().min(3).max(6).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable' });

      // 1. Check if account exists in our transactions as originator
      const asOriginator = await db
        .select({ name: transactions.originatorName })
        .from(transactions)
        .where(eq(transactions.originatorAccount, input.accountNumber))
        .limit(1);
      if (asOriginator.length > 0 && asOriginator[0].name) {
        return { accountNumber: input.accountNumber, accountName: asOriginator[0].name, bankName: 'BIS Member Bank', verified: true };
      }

      // 2. Check if account exists as beneficiary
      const asBeneficiary = await db
        .select({ name: transactions.beneficiaryName })
        .from(transactions)
        .where(eq(transactions.beneficiaryAccount, input.accountNumber))
        .limit(1);
      if (asBeneficiary.length > 0 && asBeneficiary[0].name) {
        return { accountNumber: input.accountNumber, accountName: asBeneficiary[0].name, bankName: 'BIS Member Bank', verified: true };
      }

      // 3. Try Go gateway's live NIP name-enquiry endpoint
      const gatewayURL = ENV.bisGatewayUrl;
      const gatewayKey = ENV.bisGatewayKey;
      if (gatewayURL) {
        try {
          const gwRes = await fetch(`${gatewayURL}/v1/nip/name-enquiry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-BIS-Key': gatewayKey },
            body: JSON.stringify({ accountNumber: input.accountNumber, bankCode: input.bankCode }),
            signal: AbortSignal.timeout(5000),
          });
          if (gwRes.ok) {
            const gw = await gwRes.json() as { accountName: string; bankName: string; bankCode: string; verified: boolean; source: string };
            if (gw.accountName) {
              return { accountNumber: input.accountNumber, accountName: gw.accountName, bankName: gw.bankName, bankCode: gw.bankCode, verified: gw.verified, source: gw.source };
            }
          }
        } catch {
          // Gateway unavailable — fall through to deterministic mock
        }
      }

      // 4. Gateway unavailable and account not found in local DB — return unverified rather than fabricating a name
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Account not found. The NIP gateway is unavailable or this account number is not registered. Please verify the account number and try again.',
      });
    }),
});
