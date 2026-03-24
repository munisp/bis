/**
 * server/billing.ts
 * TigerBeetle-backed billing router for the BIS tRPC BFF.
 * Records every investigation credit deduction as a double-entry ledger transaction.
 * Falls back gracefully when TIGERBEETLE_URL is not configured.
 */

import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";

const TB_URL = process.env.TIGERBEETLE_URL ?? "";
const ACCOUNT_REVENUE = "1";
const ACCOUNT_TENANT_PREFIX = "10000";

// Ledger codes
const LEDGER_NGN = 566; // ISO 4217 numeric for NGN

// Investigation tier pricing in kobo (1 NGN = 100 kobo)
const TIER_AMOUNTS: Record<string, number> = {
  basic: 50_000,    // ₦500
  standard: 150_000, // ₦1,500
  premium: 500_000,  // ₦5,000
};

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function tbPost(path: string, payload: unknown): Promise<unknown> {
  if (!TB_URL) return null;
  const res = await fetch(`${TB_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`TigerBeetle POST ${path} returned ${res.status}`);
  }
  return res.json();
}

async function tbGet(path: string): Promise<unknown> {
  if (!TB_URL) return null;
  const res = await fetch(`${TB_URL}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`TigerBeetle GET ${path} returned ${res.status}`);
  }
  return res.json();
}

// ─── Account helpers ──────────────────────────────────────────────────────────

async function ensureAccount(tenantId: string): Promise<void> {
  await tbPost("/accounts/create", [
    {
      id: ACCOUNT_TENANT_PREFIX + tenantId,
      ledger: LEDGER_NGN,
      code: 1, // asset
      flags: 0,
      user_data_128: tenantId,
    },
  ]);
}

async function ensureRevenueAccount(): Promise<void> {
  await tbPost("/accounts/create", [
    {
      id: ACCOUNT_REVENUE,
      ledger: LEDGER_NGN,
      code: 2, // revenue
      flags: 0,
    },
  ]);
}

// ─── tRPC Router ──────────────────────────────────────────────────────────────

export const billingRouter = router({
  /**
   * Record a credit deduction for an investigation.
   * Creates a double-entry transfer: tenant debit → revenue credit.
   */
  recordDebit: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        investigationId: z.string().min(1),
        tier: z.enum(["basic", "standard", "premium"]).default("basic"),
        amountKobo: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const amount = input.amountKobo ?? TIER_AMOUNTS[input.tier] ?? TIER_AMOUNTS.basic;
      const transferId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

      if (!TB_URL) {
        console.log(
          `[TigerBeetle] (disabled) would record debit: tenant=${input.tenantId} ` +
            `inv=${input.investigationId} tier=${input.tier} amount=${amount}`
        );
        return {
          transferId,
          tenantId: input.tenantId,
          investigationId: input.investigationId,
          tier: input.tier,
          amountKobo: amount,
          amountNGN: amount / 100,
          recorded: false,
          reason: "TigerBeetle not configured",
        };
      }

      try {
        // Ensure both accounts exist (idempotent)
        await Promise.all([ensureRevenueAccount(), ensureAccount(input.tenantId)]);

        await tbPost("/transfers/create", [
          {
            id: transferId,
            debit_account_id: ACCOUNT_TENANT_PREFIX + input.tenantId,
            credit_account_id: ACCOUNT_REVENUE,
            amount,
            user_data_128: input.investigationId,
            user_data_64: { basic: 1, standard: 2, premium: 3 }[input.tier],
            user_data_32: Math.floor(Date.now() / 1000),
            ledger: LEDGER_NGN,
            code: 1, // investigation debit
            flags: 0,
          },
        ]);

        return {
          transferId,
          tenantId: input.tenantId,
          investigationId: input.investigationId,
          tier: input.tier,
          amountKobo: amount,
          amountNGN: amount / 100,
          recorded: true,
        };
      } catch (err) {
        console.error("[TigerBeetle] recordDebit error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to record ledger transaction",
        });
      }
    }),

  /**
   * Get the current posted balance for a tenant account (in kobo).
   */
  getBalance: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1) }))
    .query(async ({ input }) => {
      if (!TB_URL) {
        return { tenantId: input.tenantId, balanceKobo: 0, balanceNGN: 0, available: false };
      }

      try {
        const account = (await tbGet(
          `/accounts/${ACCOUNT_TENANT_PREFIX}${input.tenantId}`
        )) as {
          credits_posted?: number;
          debits_posted?: number;
        } | null;

        if (!account) {
          return { tenantId: input.tenantId, balanceKobo: 0, balanceNGN: 0, available: true };
        }

        const creditsPosted = account.credits_posted ?? 0;
        const debitsPosted = account.debits_posted ?? 0;
        const balanceKobo = Math.max(0, creditsPosted - debitsPosted);

        return {
          tenantId: input.tenantId,
          balanceKobo,
          balanceNGN: balanceKobo / 100,
          available: true,
        };
      } catch (err) {
        console.error("[TigerBeetle] getBalance error:", err);
        return { tenantId: input.tenantId, balanceKobo: 0, balanceNGN: 0, available: false };
      }
    }),

  /**
   * Credit a tenant account (top-up).
   */
  creditAccount: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        amountKobo: z.number().int().positive(),
        reference: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const transferId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

      if (!TB_URL) {
        return {
          transferId,
          tenantId: input.tenantId,
          amountKobo: input.amountKobo,
          amountNGN: input.amountKobo / 100,
          recorded: false,
        };
      }

      try {
        await Promise.all([ensureRevenueAccount(), ensureAccount(input.tenantId)]);

        // Credit top-up: revenue → tenant (reverse direction)
        await tbPost("/transfers/create", [
          {
            id: transferId,
            debit_account_id: ACCOUNT_REVENUE,
            credit_account_id: ACCOUNT_TENANT_PREFIX + input.tenantId,
            amount: input.amountKobo,
            user_data_128: input.reference ?? "",
            user_data_32: Math.floor(Date.now() / 1000),
            ledger: LEDGER_NGN,
            code: 2, // top-up credit
            flags: 0,
          },
        ]);

        return {
          transferId,
          tenantId: input.tenantId,
          amountKobo: input.amountKobo,
          amountNGN: input.amountKobo / 100,
          recorded: true,
        };
      } catch (err) {
        console.error("[TigerBeetle] creditAccount error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to record top-up transaction",
        });
      }
    }),

  /**
   * Get tier pricing table.
   */
  getTierPricing: protectedProcedure.query(() => {
    return Object.entries(TIER_AMOUNTS).map(([tier, amountKobo]) => ({
      tier,
      amountKobo,
      amountNGN: amountKobo / 100,
      currency: "NGN",
    }));
  }),
});
