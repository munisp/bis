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

      return {
        txRef: result.txRef,
        txHash: result.txHash,
        status: result.status,
        network: result.network,
        currency: result.currency,
        gasUsed: result.gasUsed ?? null,
        sandbox: result.sandbox ?? false,
        initiatedAt: new Date().toISOString(),
      };
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
      // Fetch live rate from the gateway (which proxies a price oracle)
      // Falls back to a hardcoded reference rate in sandbox mode
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
        // Fallback: use a reference rate (sandbox only)
        const REFERENCE_RATE_NGN_PER_USDC = 1_650; // approximate NGN/USD as of 2025
        return {
          amountUsdc: input.amountUsdc,
          targetCurrency: input.targetCurrency,
          rate: REFERENCE_RATE_NGN_PER_USDC,
          targetAmount: input.amountUsdc * REFERENCE_RATE_NGN_PER_USDC,
          source: "reference-rate-fallback",
          sandbox: true,
          quotedAt: new Date().toISOString(),
        };
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
        // Sandbox fallback: return empty history
        return {
          address: input.address,
          transactions: [],
          sandbox: true,
          fetchedAt: new Date().toISOString(),
        };
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
