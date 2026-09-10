/**
 * Fail-closed commercial billing router.
 *
 * TigerBeetle is the authoritative prepaid-credit ledger. Paystack is only a
 * payment rail: it can never credit a tenant until a server-created payment
 * intent is re-verified and its deterministic ledger transfer is committed.
 */

import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { router, protectedProcedure, writeProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { storagePut } from "./storage";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { billingTopups, tigerbeetleTransfers } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { withCircuitBreaker } from "./circuitBreaker";
import { settlePaystackPayment, startPaystackTopup } from "./billingSettlement";
import { commercialBillingRouter } from "./billingCommercial";

const ACCOUNT_REVENUE = "1";
const ACCOUNT_TENANT_PREFIX = "10000";
const LEDGER_NGN = 566;

const TIER_AMOUNTS = {
  basic: 50_000,
  standard: 150_000,
  premium: 500_000,
} as const;
type Tier = keyof typeof TIER_AMOUNTS;

function unavailable(message: string): TRPCError {
  return new TRPCError({ code: "SERVICE_UNAVAILABLE", message });
}

function tigerBeetleUrl(): string {
  if (!ENV.tigerBeetleUrl) throw unavailable("TigerBeetle is not configured; commercial ledger operations are disabled");
  return ENV.tigerBeetleUrl.replace(/\/$/, "");
}

function deterministicTopupTransferId(reference: string): string {
  return createHash("sha256").update(`bis:paystack-topup:v2:${reference}`).digest("hex").slice(0, 32);
}

function deterministicDebitTransferId(input: { tenantId: string; investigationId: string; tier: Tier; amountKobo: number }): string {
  return createHash("sha256")
    .update(`bis:investigation-debit:v2:${input.tenantId}:${input.investigationId}:${input.tier}:${input.amountKobo}`)
    .digest("hex")
    .slice(0, 32);
}

export function assertBillingTenantAccess(contextTenantId: number | null, requestedTenantId: string): void {
  if (!/^[1-9]\d*$/.test(requestedTenantId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A canonical tenant identifier is required" });
  }
  if (contextTenantId !== null && String(contextTenantId) !== requestedTenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cross-tenant billing access is denied" });
  }
}

export function assertVerifiedTopupBinding(input: {
  expectedReference: string;
  expectedTenantId: string;
  verifiedReference: string;
  verifiedTenantId?: string;
}): void {
  if (input.verifiedReference !== input.expectedReference) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Paystack reference mismatch" });
  }
  // The v2 flow binds a payment to a server-created intent. Webhook metadata is
  // deliberately not an authority; retaining this helper prevents legacy routes
  // from accidentally accepting a mismatched binding.
  if (input.verifiedTenantId !== input.expectedTenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "The verified payment is not bound to this tenant" });
  }
}

export const __billingInternals = {
  deterministicTopupTransferId,
  deterministicDebitTransferId,
  tierAmounts: TIER_AMOUNTS,
};

async function tbPost(path: string, payload: unknown): Promise<void> {
  const baseUrl = tigerBeetleUrl();
  let response: Response;
  try {
    response = await withCircuitBreaker("tigerbeetle", () => fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    }));
  } catch {
    throw unavailable("TigerBeetle is unavailable; the ledger operation was not finalized");
  }
  if (!response.ok) throw unavailable("TigerBeetle rejected the ledger operation; reconciliation is required");
}

async function tbGet(path: string): Promise<unknown> {
  const baseUrl = tigerBeetleUrl();
  let response: Response;
  try {
    response = await withCircuitBreaker("tigerbeetle", () => fetch(`${baseUrl}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    }));
  } catch {
    throw unavailable("TigerBeetle is unavailable; no ledger balance can be represented");
  }
  if (!response.ok) throw unavailable("TigerBeetle rejected the ledger query");
  try {
    return await response.json();
  } catch {
    throw unavailable("TigerBeetle returned an invalid ledger response");
  }
}

async function ensureLedgerAccounts(tenantId: string): Promise<void> {
  await tbPost("/accounts/create", [
    { id: ACCOUNT_REVENUE, ledger: LEDGER_NGN, code: 2, flags: 0 },
    { id: `${ACCOUNT_TENANT_PREFIX}${tenantId}`, ledger: LEDGER_NGN, code: 1, flags: 0, user_data_128: tenantId },
  ]);
}

/**
 * Legacy server helper retained for webhook-reconciliation callers. It cannot
 * credit arbitrary amounts: the authoritative Paystack transaction and the
 * server-created payment intent must agree exactly.
 */
export async function creditTenantAccount(opts: { tenantId: string; amountKobo: number; reference: string }): Promise<{ transferId: string; recorded: true }> {
  const settled = await settlePaystackPayment(opts.reference);
  if (String(settled.tenantId) !== opts.tenantId || settled.amountKobo !== opts.amountKobo) {
    throw new TRPCError({ code: "CONFLICT", message: "Payment settlement differs from the requested tenant or amount" });
  }
  return { transferId: settled.transferId, recorded: true };
}

export const billingRouter = router({
  commercial: commercialBillingRouter,

  recordDebit: writeProcedure
    .input(z.object({
      tenantId: z.string().regex(/^[1-9]\d*$/),
      investigationId: z.string().min(1).max(128),
      tier: z.enum(["basic", "standard", "premium"]).default("basic"),
      amountKobo: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      assertBillingTenantAccess(ctx.tenantId, input.tenantId);
      const tier = input.tier as Tier;
      const amount = input.amountKobo ?? TIER_AMOUNTS[tier];
      if (amount !== TIER_AMOUNTS[tier]) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Investigation tier pricing is server controlled" });
      }
      const transferId = deterministicDebitTransferId({ tenantId: input.tenantId, investigationId: input.investigationId, tier, amountKobo: amount });
      const db = await getDb();
      if (!db) throw unavailable("Durable ledger reconciliation storage is unavailable");

      const [claim] = await db.insert(tigerbeetleTransfers).values({
        transferId,
        debitAccountId: `${ACCOUNT_TENANT_PREFIX}${input.tenantId}`,
        creditAccountId: ACCOUNT_REVENUE,
        amount,
        ledger: LEDGER_NGN,
        code: 1,
        tenantId: ctx.tenantId,
        txRef: input.investigationId,
        userData: { investigationId: input.investigationId, tier },
      }).onConflictDoNothing().returning();

      if (!claim) {
        const [existing] = await db.select().from(tigerbeetleTransfers).where(eq(tigerbeetleTransfers.transferId, transferId));
        if (!existing) throw new TRPCError({ code: "CONFLICT", message: "Ledger debit claim could not be recovered" });
        if (!existing.reconciledAt) {
          return { transferId, tenantId: input.tenantId, investigationId: input.investigationId, tier, amountKobo: amount, amountNGN: amount / 100, recorded: false, idempotent: true, pendingReconciliation: true };
        }
        return { transferId, tenantId: input.tenantId, investigationId: input.investigationId, tier, amountKobo: amount, amountNGN: amount / 100, recorded: true, idempotent: true, pendingReconciliation: false };
      }

      await ensureLedgerAccounts(input.tenantId);
      await tbPost("/transfers/create", [{
        id: transferId,
        debit_account_id: `${ACCOUNT_TENANT_PREFIX}${input.tenantId}`,
        credit_account_id: ACCOUNT_REVENUE,
        amount,
        ledger: LEDGER_NGN,
        code: 1,
        flags: 0,
        user_data_128: input.investigationId,
        user_data_64: { basic: 1, standard: 2, premium: 3 }[tier],
      }]);
      const result = await db.update(tigerbeetleTransfers).set({ reconciledAt: new Date() }).where(eq(tigerbeetleTransfers.transferId, transferId)).returning();
      if (result.length !== 1) throw unavailable("Ledger debit was accepted but reconciliation state requires operator recovery");
      return { transferId, tenantId: input.tenantId, investigationId: input.investigationId, tier, amountKobo: amount, amountNGN: amount / 100, recorded: true, idempotent: false };
    }),

  getBalance: protectedProcedure
    .input(z.object({ tenantId: z.string().regex(/^[1-9]\d*$/) }))
    .query(async ({ input, ctx }) => {
      assertBillingTenantAccess(ctx.tenantId, input.tenantId);
      const account = await tbGet(`/accounts/${ACCOUNT_TENANT_PREFIX}${input.tenantId}`) as { credits_posted?: number; debits_posted?: number } | null;
      const creditsPosted = account?.credits_posted ?? 0;
      const debitsPosted = account?.debits_posted ?? 0;
      const balanceKobo = creditsPosted - debitsPosted;
      if (!Number.isSafeInteger(balanceKobo) || balanceKobo < 0) throw unavailable("TigerBeetle returned an invalid posted balance");
      return { tenantId: input.tenantId, balanceKobo, balanceNGN: balanceKobo / 100, available: true };
    }),

  // Direct mutation of customer credit is intentionally disabled. A Paystack
  // settlement or approved four-eyes recovery workflow is required instead.
  creditAccount: writeProcedure
    .input(z.object({ tenantId: z.string().regex(/^[1-9]\d*$/), amountKobo: z.number().int().positive(), reference: z.string().min(1).max(255) }))
    .mutation(async ({ input, ctx }) => {
      assertBillingTenantAccess(ctx.tenantId, input.tenantId);
      throw new TRPCError({ code: "FORBIDDEN", message: "Direct crediting is disabled; use verified payment settlement or four-eyes recovery" });
    }),

  getTierPricing: protectedProcedure.query(() => Object.entries(TIER_AMOUNTS).map(([tier, amountKobo]) => ({ tier, amountKobo, amountNGN: amountKobo / 100, currency: "NGN" }))),

  initiateTopUp: writeProcedure
    .input(z.object({
      tenantId: z.string().regex(/^[1-9]\d*$/),
      amountKobo: z.number().int().min(10_000),
      email: z.string().email().max(320),
      callbackUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      assertBillingTenantAccess(ctx.tenantId, input.tenantId);
      const result = await startPaystackTopup({
        tenantId: Number(input.tenantId),
        initiatedBy: ctx.user!.id,
        amountKobo: input.amountKobo,
        email: input.email,
        callbackUrl: input.callbackUrl,
      });
      return { ...result, simulated: false };
    }),

  verifyTopUp: writeProcedure
    .input(z.object({ tenantId: z.string().regex(/^[1-9]\d*$/), reference: z.string().regex(/^BIS-TOP-[A-Z0-9]{24}$/) }))
    .mutation(async ({ input, ctx }) => {
      assertBillingTenantAccess(ctx.tenantId, input.tenantId);
      const result = await settlePaystackPayment(input.reference);
      if (String(result.tenantId) !== input.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "The payment intent belongs to a different tenant" });
      return { success: true, amountKobo: result.amountKobo, amountNGN: result.amountKobo / 100, reference: input.reference, transferId: result.transferId, idempotent: result.idempotent, channel: "paystack_verified" };
    }),

  exportLedger: writeProcedure
    .input(z.object({ tenantId: z.string().regex(/^[1-9]\d*$/), fromTimestamp: z.number().int().optional(), toTimestamp: z.number().int().optional(), type: z.enum(["all", "debit", "credit"]).default("all") }))
    .mutation(async ({ input, ctx }) => {
      assertBillingTenantAccess(ctx.tenantId, input.tenantId);
      const transfers = await tbGet(`/accounts/${ACCOUNT_TENANT_PREFIX}${input.tenantId}/transfers`) as Array<{ id: string; timestamp?: number; amount: number; code: number; user_data_128?: string; user_data_64?: number }> | null;
      const tierNames: Record<number, string> = { 1: "basic", 2: "standard", 3: "premium" };
      const rows = (transfers ?? []).filter((transfer) => {
        if (input.type === "debit" && transfer.code !== 1) return false;
        if (input.type === "credit" && transfer.code !== 2) return false;
        const timestamp = (transfer.timestamp ?? 0) * 1000;
        return (!input.fromTimestamp || timestamp >= input.fromTimestamp) && (!input.toTimestamp || timestamp <= input.toTimestamp);
      }).map((transfer) => [transfer.id, new Date((transfer.timestamp ?? 0) * 1000).toISOString(), transfer.code === 2 ? "credit" : "debit", (transfer.amount / 100).toFixed(2), transfer.user_data_128 ?? "", tierNames[transfer.user_data_64 ?? 0] ?? ""]);
      const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
      const csv = ["ID,Timestamp,Type,Amount (NGN),Reference,Tier", ...rows.map((row) => row.map((value) => escape(String(value))).join(","))].join("\n");
      const key = `billing-exports/${input.tenantId}/${new Date().toISOString().slice(0, 10)}-${randomUUID()}.csv`;
      try {
        const { url } = await storagePut(key, csv, "text/csv");
        return { url, fileKey: key, rowCount: rows.length, tenantId: input.tenantId, exportedAt: new Date().toISOString() };
      } catch {
        throw unavailable("Ledger export storage is unavailable; no unsigned fallback was generated");
      }
    }),

  getLedger: protectedProcedure
    .input(z.object({ tenantId: z.string().regex(/^[1-9]\d*$/), limit: z.number().int().min(1).max(500).default(100), type: z.enum(["all", "debit", "credit"]).default("all") }))
    .query(async ({ input, ctx }) => {
      assertBillingTenantAccess(ctx.tenantId, input.tenantId);
      const transfers = await tbGet(`/accounts/${ACCOUNT_TENANT_PREFIX}${input.tenantId}/transfers?limit=${input.limit}`) as Array<{ id: string; amount: number; code: number; timestamp?: number; user_data_128?: string }> | null;
      const entries = (transfers ?? []).map((transfer) => ({
        id: String(transfer.id),
        type: transfer.code === 2 ? "credit" as const : "debit" as const,
        amountKobo: Number(transfer.amount),
        description: transfer.code === 2 ? "Verified payment credit" : "Investigation debit",
        investigationRef: transfer.code === 1 ? transfer.user_data_128 : undefined,
        timestamp: new Date((transfer.timestamp ?? 0) / 1_000_000),
        status: "posted" as const,
      })).filter((entry) => input.type === "all" || entry.type === input.type);
      return { entries, total: entries.length, source: "tigerbeetle" as const };
    }),
});
