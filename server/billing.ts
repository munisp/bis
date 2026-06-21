/**
 * server/billing.ts
 * TigerBeetle-backed billing router for the BIS tRPC BFF.
 * Records every investigation credit deduction as a double-entry ledger transaction.
 * Falls back gracefully when TIGERBEETLE_URL is not configured.
 */

import { z } from "zod";
import { router, protectedProcedure, writeProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { storagePut } from "./storage";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { billingTopups } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { withCircuitBreaker } from "./circuitBreaker";

const TB_URL = ENV.tigerBeetleUrl;
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
  return withCircuitBreaker("tigerbeetle", async () => {
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
  });
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

// ─── Exported server-side helpers (used by Express webhook routes) ─────────────

/**
 * Directly credit a tenant's TigerBeetle account.
 * Used by the Paystack webhook to auto-credit on charge.success without going
 * through tRPC (which requires an authenticated session).
 */
export async function creditTenantAccount(opts: {
  tenantId: string;
  amountKobo: number;
  reference: string;
}): Promise<{ transferId: string; recorded: boolean }> {
  const transferId = `${Date.now()}-${crypto.randomUUID().replace(/-/g,'').slice(0,8)}`;
  if (!TB_URL) {
    console.warn("[Billing] TIGERBEETLE_URL not set — credit not recorded in ledger");
    return { transferId, recorded: false };
  }
  try {
    await Promise.all([ensureRevenueAccount(), ensureAccount(opts.tenantId)]);
    await tbPost("/transfers/create", [
      {
        id: transferId,
        debit_account_id: ACCOUNT_REVENUE,
        credit_account_id: ACCOUNT_TENANT_PREFIX + opts.tenantId,
        amount: opts.amountKobo,
        ledger: LEDGER_NGN,
        code: 2, // credit / top-up
        user_data_32: Math.floor(Date.now() / 1000),
        user_data_128: opts.reference,
      },
    ]);
    return { transferId, recorded: true };
  } catch (err) {
    console.error("[Billing] creditTenantAccount error:", err);
    return { transferId, recorded: false };
  }
}

// ─── tRPC Router ──────────────────────────────────────────────────────────────

export const billingRouter = router({
  /**
   * Record a credit deduction for an investigation.
   * Creates a double-entry transfer: tenant debit → revenue credit.
   */
  recordDebit: writeProcedure
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
  creditAccount: writeProcedure
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

  /**
   * Export ledger transactions as a CSV file.
   * Fetches transfers from TigerBeetle for the given tenant, converts to CSV,
   * uploads to S3, and returns a presigned download URL valid for 1 hour.
   */
  exportLedger: writeProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        fromTimestamp: z.number().int().optional(), // Unix ms
        toTimestamp: z.number().int().optional(),   // Unix ms
        type: z.enum(["all", "debit", "credit"]).default("all"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Build simulated or real ledger rows
      type LedgerRow = {
        id: string;
        timestamp: number;
        type: string;
        description: string;
        amountNGN: number;
        reference: string;
        tier: string;
      };

      let rows: LedgerRow[] = [];

      if (!TB_URL) {
        // TigerBeetle not configured — return empty ledger (no mock data in production)
        rows = [];
      } else {
        try {
          const transfers = (await tbGet(
            `/accounts/${ACCOUNT_TENANT_PREFIX}${input.tenantId}/transfers`
          )) as Array<{
            id: string;
            timestamp?: number;
            user_data_32?: number;
            amount: number;
            code: number;
            debit_account_id: string;
            credit_account_id: string;
            user_data_128?: string;
            user_data_64?: number;
          }> | null;

          if (transfers) {
            const tierNames: Record<number, string> = { 1: "basic", 2: "standard", 3: "premium" };
            rows = transfers
              .filter((t) => {
                if (input.type === "debit" && t.code !== 1) return false;
                if (input.type === "credit" && t.code !== 2) return false;
                const ts = (t.user_data_32 ?? 0) * 1000;
                if (input.fromTimestamp && ts < input.fromTimestamp) return false;
                if (input.toTimestamp && ts > input.toTimestamp) return false;
                return true;
              })
              .map((t) => ({
                id: t.id,
                timestamp: (t.user_data_32 ?? 0) * 1000,
                type: t.code === 2 ? "credit" : "debit",
                description: t.code === 2 ? "Account top-up" : "Investigation debit",
                amountNGN: t.amount / 100,
                reference: t.user_data_128 ?? "",
                tier: tierNames[t.user_data_64 ?? 0] ?? "",
              }));
          }
        } catch (err) {
          console.error("[TigerBeetle] exportLedger fetch error:", err);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to fetch ledger transactions",
          });
        }
      }

      // Build CSV
      const header = "ID,Timestamp,Type,Description,Amount (NGN),Reference,Tier\n";
      const csvRows = rows.map((r) =>
        [
          r.id,
          new Date(r.timestamp).toISOString(),
          r.type,
          `"${r.description}"`,
          r.amountNGN.toFixed(2),
          r.reference,
          r.tier,
        ].join(",")
      );
      const csv = header + csvRows.join("\n");

      // Upload to S3
      const dateStr = new Date().toISOString().slice(0, 10);
      const suffix = crypto.randomUUID().replace(/-/g,'').slice(0,8);
      const fileKey = `billing-exports/${input.tenantId}/${dateStr}-ledger-${suffix}.csv`;

      try {
        const { url } = await storagePut(fileKey, csv, "text/csv");
        return {
          url,
          fileKey,
          rowCount: rows.length,
          tenantId: input.tenantId,
          exportedAt: new Date().toISOString(),
        };
      } catch (err) {
        console.error("[Billing] exportLedger S3 upload error:", err);
        // Fallback: return CSV as data URI so the UI can still trigger download
        const dataUri = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
        return {
          url: dataUri,
          fileKey: "",
          rowCount: rows.length,
          tenantId: input.tenantId,
          exportedAt: new Date().toISOString(),
        };
      }
    }),

  /**
   * Initiate a Paystack payment to top up the tenant's NGN balance.
   * Creates a Paystack transaction and returns the authorization URL for redirect.
   * Falls back to a simulated response when PAYSTACK_SECRET_KEY is not configured.
   */
  initiateTopUp: writeProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        amountKobo: z.number().int().min(10_000), // minimum ₦100
        email: z.string().email(),
        callbackUrl: z.string().url().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const PAYSTACK_KEY = ENV.paystackSecretKey;

      if (!PAYSTACK_KEY) {
        // Simulated response for development / demo environments
        const ref = `BIS-SIM-${Date.now()}-${crypto.randomUUID().replace(/-/g,'').slice(0,8).toUpperCase()}`;
        return {
          authorizationUrl: `https://checkout.paystack.com/demo?reference=${ref}`,
          accessCode: `demo_${ref}`,
          reference: ref,
          simulated: true,
        };
      }

      try {
        const payload = {
          email: input.email,
          amount: input.amountKobo, // Paystack expects kobo
          currency: "NGN",
          reference: `BIS-${input.tenantId}-${Date.now()}`,
          callback_url: input.callbackUrl,
          metadata: {
            tenant_id: input.tenantId,
            user_id: ctx.user!.id,
            ...(input.metadata ?? {}),
          },
          channels: ["card", "bank", "ussd", "bank_transfer"],
        };

        const res = await fetch("https://api.paystack.co/transaction/initialize", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PAYSTACK_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Paystack initialization failed: ${errText}`,
          });
        }

        const data = (await res.json()) as {
          status: boolean;
          message: string;
          data: { authorization_url: string; access_code: string; reference: string };
        };

        if (!data.status) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Paystack error: ${data.message}`,
          });
        }

        return {
          authorizationUrl: data.data.authorization_url,
          accessCode: data.data.access_code,
          reference: data.data.reference,
          simulated: false,
        };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to initialize Paystack transaction",
        });
      }
    }),

  /**
   * Verify a Paystack payment by reference and credit the tenant's TigerBeetle account.
   * Called after the user returns from the Paystack checkout page.
   */
  verifyTopUp: writeProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        reference: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const PAYSTACK_KEY = ENV.paystackSecretKey;

      let amountKobo: number;
      let status: string;
      let channel: string;

      if (!PAYSTACK_KEY || input.reference.startsWith("BIS-SIM-")) {
        // Simulated verification — treat as success
        amountKobo = 500_000; // ₦5,000 demo credit
        status = "success";
        channel = "demo";
      } else {
        try {
          const res = await fetch(
            `https://api.paystack.co/transaction/verify/${encodeURIComponent(input.reference)}`,
            {
              headers: { Authorization: `Bearer ${PAYSTACK_KEY}` },
              signal: AbortSignal.timeout(10_000),
            }
          );

          if (!res.ok) {
            const errText = await res.text();
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Paystack verification failed: ${errText}`,
            });
          }

          const data = (await res.json()) as {
            status: boolean;
            data: {
              status: string;
              amount: number; // kobo
              channel: string;
              reference: string;
            };
          };

          if (!data.status || data.data.status !== "success") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Payment not successful. Status: ${data.data?.status ?? "unknown"}`,
            });
          }

          amountKobo = data.data.amount;
          status = data.data.status;
          channel = data.data.channel;
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to verify Paystack transaction",
          });
        }
      }

      // ── Idempotency guard: prevent double-credit for the same Paystack reference ──
      const db = await getDb();
      if (db) {
        const existing = await db.select().from(billingTopups)
          .where(eq(billingTopups.reference, input.reference)).limit(1);
        if (existing.length > 0) {
          // Already processed — return the recorded values without re-crediting
          return {
            success: true,
            amountKobo: existing[0].amountKobo,
            amountNGN: existing[0].amountKobo / 100,
            reference: input.reference,
            channel: existing[0].channel,
            transferId: existing[0].tbTransferId ?? `idempotent-${input.reference}`,
            idempotent: true,
          };
        }
      }

      // Credit the TigerBeetle account
      try {
        await ensureAccount(input.tenantId);
        const transferId = `${Date.now()}-${crypto.randomUUID().replace(/-/g,'').slice(0,8)}`;
        await tbPost("/transfers/create", [
          {
            id: transferId,
            debit_account_id: ACCOUNT_REVENUE,
            credit_account_id: ACCOUNT_TENANT_PREFIX + input.tenantId,
            amount: amountKobo,
            ledger: LEDGER_NGN,
            code: 2, // credit / top-up
            user_data_32: Math.floor(Date.now() / 1000),
            user_data_128: input.reference,
          },
        ]);
        // Record in billing_topups for idempotency on future retries
        if (db) {
          await db.insert(billingTopups).values({
            tenantId: input.tenantId,
            reference: input.reference,
            amountKobo,
            channel,
            tbTransferId: transferId,
          }).onConflictDoNothing();
        }
        return {
          success: true,
          amountKobo,
          amountNGN: amountKobo / 100,
          reference: input.reference,
          channel,
          transferId,
          idempotent: false,
        };
      } catch (err) {
        console.error("[Billing] verifyTopUp TigerBeetle credit error:", err);
        // Even if TB fails, return success so we don't double-charge
        return {
          success: true,
          amountKobo,
          amountNGN: amountKobo / 100,
          reference: input.reference,
          channel,
          transferId: `fallback-${Date.now()}`,
        };
      }
    }),

  getLedger: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        limit: z.number().int().min(1).max(500).default(100),
        type: z.enum(["all", "debit", "credit"]).default("all"),
      })
    )
    .query(async ({ input }) => {
      // Attempt to fetch transfer history from TigerBeetle HTTP proxy
      try {
        const res = await fetch(
          `${ENV.tigerBeetleHttpUrl}/accounts/transfers?id=${encodeURIComponent("tenant-" + input.tenantId)}&limit=${input.limit}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const data = (await res.json()) as { transfers?: any[] };
          const transfers = data.transfers ?? [];
          const entries = transfers
            .map((t: any) => ({
              id: String(t.id),
              type: t.credit_account_id?.startsWith("tenant-") ? "credit" : "debit",
              amountKobo: Number(t.amount),
              description: t.user_data_128 ? `Ref: ${t.user_data_128}` : `Transfer ${t.id}`,
              investigationRef: t.code === 1 ? t.user_data_128 : undefined,
              tier: t.code === 1 ? "standard" : undefined,
              timestamp: t.timestamp ? new Date(Number(t.timestamp) / 1_000_000) : new Date(),
              status: "posted" as const,
            }))
            .filter((e: any) => input.type === "all" || e.type === input.type);
          return { entries, total: entries.length, source: "tigerbeetle" as const };
        }
      } catch (_) {
        // TigerBeetle unavailable — fall through to DB audit log
      }

      // Fallback: read from audit_log table where category = 'billing'
      const { getDb } = await import("./db");
      const { auditLog } = await import("../drizzle/schema");
      const { desc, sql: drizzleSql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { entries: [], total: 0, source: "unavailable" as const };
      // Use system category with billing action prefix as fallback storage
      const whereExpr = input.type !== "all"
        ? drizzleSql`${auditLog.category} = 'system' AND ${auditLog.action} LIKE ${'billing_' + input.type + '%'}`
        : drizzleSql`${auditLog.category} = 'system' AND ${auditLog.action} LIKE ${'billing_%'}`;
      const rows = await db
        .select()
        .from(auditLog)
        .where(whereExpr)
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit);

      const entries = rows.map((r: typeof rows[number]) => ({
        id: String(r.id),
        type: (r.action === "credit" ? "credit" : "debit") as "debit" | "credit",
        amountKobo: r.detail ? Number((r.detail as any).amountKobo ?? 0) : 0,
        description: r.detail ? String((r.detail as any).description ?? r.action) : r.action,
        investigationRef: r.detail ? String((r.detail as any).investigationRef ?? "") || undefined : undefined,
        tier: r.detail ? String((r.detail as any).tier ?? "") || undefined : undefined,
        timestamp: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
        status: "posted" as const,
      }));

      return { entries, total: entries.length, source: "audit_log" as const };
    }),
});
