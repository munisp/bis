/**
 * server/stablecoin.ts — BIS Stablecoin Router (tRPC)
 *
 * Provides tRPC procedures for stablecoin (USDC, cUSD, eNaira CBDC) operations:
 *   - transfer:    Initiate a stablecoin transfer via the Go gateway
 *   - balance:     Query wallet balance on a given network
 *   - history:     Retrieve on-chain transaction history for a wallet
 *   - quote:       Get a real-time NGN/USDC exchange rate quote
 *
 * All calls are proxied through the BIS Go API Gateway which handles:
 *   - Wallet signing (server-side, keys never reach the BFF)
 *   - AML/sanctions screening before submission
 *   - On-chain confirmation polling
 *   - Kafka event publishing for audit trail
 *
 * Supported networks:
 *   ethereum  — USDC (ERC-20, Circle)
 *   celo      — cUSD (Celo Dollar, Mento)
 *   polygon   — USDC (Polygon PoS bridge)
 *   nigeria   — eNaira (CBN CBDC — sandbox only)
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import { TRPCError } from "@trpc/server";
import { publishStablecoinEvent } from "./dapr";
import { getDb } from "./db";

// ─── Config ───────────────────────────────────────────────────────────────────

const GATEWAY_URL = ENV.bisGatewayUrl ?? ENV.gatewayUrl ?? "http://localhost:8081";
const GATEWAY_KEY = ENV.bisGatewayKey ?? "dev-gateway-key-change-in-prod";

const SUPPORTED_CURRENCIES = ["USDC", "cUSD", "eNaira"] as const;
const SUPPORTED_NETWORKS = ["ethereum", "celo", "polygon", "nigeria"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gatewayPost<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${GATEWAY_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BIS-Key": GATEWAY_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `Gateway error ${resp.status}: ${text}`,
    });
  }

  return resp.json() as Promise<T>;
}

async function gatewayGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${GATEWAY_URL}${path}`, {
    method: "GET",
    headers: {
      "X-BIS-Key": GATEWAY_KEY,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `Gateway error ${resp.status}: ${text}`,
    });
  }

  return resp.json() as Promise<T>;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const stablecoinRouter = router({
  /**
   * Initiate a stablecoin transfer.
   * Returns a txRef and initial status (pending | confirmed | failed).
   */
  transfer: protectedProcedure
    .input(
      z.object({
        txRef: z.string().min(1).max(64),
        fromAddress: z.string().min(10).max(100),
        toAddress: z.string().min(10).max(100),
        /** Amount in the smallest denomination (6 decimal places for USDC/cUSD) */
        amountUnits: z.string().regex(/^\d+$/, "Must be a non-negative integer string"),
        currency: z.enum(SUPPORTED_CURRENCIES),
        network: z.enum(SUPPORTED_NETWORKS),
        narration: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // ── Idempotency guard: prevent duplicate chain transfers for the same txRef ──
      const db = await getDb();
      if (db) {
        const { transactions } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [existing] = await db.select().from(transactions)
          .where(eq(transactions.txRef, input.txRef)).limit(1);
        if (existing) {
          return {
            txRef: existing.txRef,
            txHash: (existing as any).tigerBeetleId ?? "",
            status: existing.status,
            network: input.network,
            currency: input.currency,
            gasUsed: null,
            sandbox: false,
            initiatedAt: existing.createdAt?.toISOString() ?? new Date().toISOString(),
            idempotent: true,
          };
        }
      }

      const result = await gatewayPost<{
        txRef: string;
        txHash: string;
        status: string;
        network: string;
        currency: string;
        gasUsed?: string;
        sandbox?: boolean;
      }>("/v1/stablecoin/transfer", {
        ...input,
        initiatedBy: ctx.user.id,
      });

      const transferResult = {
        txRef: result.txRef,
        txHash: result.txHash,
        status: result.status,
        network: result.network,
        currency: result.currency,
        gasUsed: result.gasUsed ?? null,
        sandbox: result.sandbox ?? false,
        initiatedAt: new Date().toISOString(),
      };
      // Publish stablecoin transfer event to Dapr pub/sub for AML monitoring
      publishStablecoinEvent({ eventType: "transfer_initiated", txRef: result.txRef, network: result.network, currency: result.currency, amountUnits: input.amountUnits, status: result.status, actorId: ctx.user.id, tenantId: ctx.tenantId ?? undefined,
       }).catch(e => console.warn("[Stablecoin] Dapr publish failed:", e));

      // Persist the transfer record for idempotency and audit
      if (db) {
        const { transactions } = await import("../drizzle/schema");
        await db.insert(transactions).values({
          txRef: result.txRef,
          type: "stablecoin" as any,
          status: result.status === "confirmed" ? "completed" : "pending",
          amount: parseInt(input.amountUnits, 10),
          currency: input.currency,
          originatorAccount: input.fromAddress,
          originatorName: `user:${ctx.user.id}`,
          beneficiaryAccount: input.toAddress,
          beneficiaryName: input.toAddress,
          narration: input.narration ?? `Stablecoin transfer on ${input.network}`,
          tigerBeetleId: result.txHash,
        }).onConflictDoNothing();
      }

      return transferResult;
    }),

  /**
   * Query the stablecoin balance for a wallet address.
   */
  balance: protectedProcedure
    .input(
      z.object({
        address: z.string().min(10).max(100),
        currency: z.enum(SUPPORTED_CURRENCIES).default("USDC"),
        network: z.enum(SUPPORTED_NETWORKS).default("ethereum"),
      })
    )
    .query(async ({ input }) => {
      const result = await gatewayGet<{
        address: string;
        currency: string;
        network: string;
        balance: string;
        sandbox?: boolean;
      }>(
        `/v1/stablecoin/balance/${encodeURIComponent(input.address)}?currency=${input.currency}&network=${input.network}`
      );

      return {
        address: result.address,
        currency: result.currency,
        network: result.network,
        /** Balance as a 6-decimal string, e.g. "1000000" = 1 USDC */
        balance: result.balance,
        /** Human-readable balance, e.g. "1.000000" */
        balanceFormatted: formatStablecoinAmount(result.balance, result.currency),
        sandbox: result.sandbox ?? false,
        queriedAt: new Date().toISOString(),
      };
    }),

  /**
   * Get a real-time NGN/USDC exchange rate quote.
   * Returns the rate and estimated NGN equivalent for a given USDC amount.
   */
  quote: protectedProcedure
    .input(
      z.object({
        amountUsdc: z.number().positive(),
        targetCurrency: z.string().default("NGN"),
      })
    )
    .query(async ({ input }) => {
      // Fetch a live rate from the gateway price oracle.
      try {
        const result = await gatewayGet<{
          rate: number;
          source: string;
          sandbox?: boolean;
        }>(`/v1/stablecoin/quote?amount=${input.amountUsdc}&target=${input.targetCurrency}`);

        return {
          amountUsdc: input.amountUsdc,
          targetCurrency: input.targetCurrency,
          rate: result.rate,
          targetAmount: input.amountUsdc * result.rate,
          source: result.source,
          sandbox: result.sandbox ?? false,
          quotedAt: new Date().toISOString(),
        };
      } catch {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Live stablecoin quote is unavailable; no reference rate was substituted." });
      }
    }),

  /**
   * Retrieve on-chain transaction history for a wallet address.
   */
  history: protectedProcedure
    .input(
      z.object({
        address: z.string().min(10).max(100),
        currency: z.enum(SUPPORTED_CURRENCIES).default("USDC"),
        network: z.enum(SUPPORTED_NETWORKS).default("ethereum"),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const result = await gatewayGet<{
          transactions: Array<{
            txHash: string;
            from: string;
            to: string;
            amount: string;
            currency: string;
            network: string;
            status: string;
            blockNumber?: number;
            timestamp?: string;
          }>;
          sandbox?: boolean;
        }>(
          `/v1/stablecoin/history/${encodeURIComponent(input.address)}?currency=${input.currency}&network=${input.network}&limit=${input.limit}`
        );

        return {
          address: input.address,
          transactions: result.transactions.map((tx) => ({
            ...tx,
            amountFormatted: formatStablecoinAmount(tx.amount, tx.currency),
          })),
          sandbox: result.sandbox ?? false,
          fetchedAt: new Date().toISOString(),
        };
      } catch {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "On-chain transaction history is unavailable; an empty history was not substituted." });
      }
    }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a stablecoin amount from smallest denomination to human-readable.
 * USDC and cUSD use 6 decimal places; eNaira uses 2.
 */
function formatStablecoinAmount(units: string, currency: string): string {
  const decimals = currency === "eNaira" ? 2 : 6;
  const divisor = Math.pow(10, decimals);
  const amount = Number(units) / divisor;
  return amount.toFixed(decimals);
}
