/**
 * search.ts — Cross-entity full-text search via OpenSearch
 *
 * Proxies to the Go gateway's /v1/search endpoint which fans out to three
 * OpenSearch indices: bis-investigations, bis-alerts, bis-kyc.
 *
 * Falls back gracefully when the gateway is unavailable (dev mode).
 */

import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { ENV } from "./_core/env";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchHit {
  _index: string;
  [key: string]: unknown;
}

export interface SearchResult {
  total: number;
  hits: SearchHit[];
  maxScore: number;
}

export interface CrossEntitySearchResponse {
  "bis-investigations": SearchResult;
  "bis-alerts": SearchResult;
  "bis-kyc": SearchResult;
}

// ─── Gateway helper ───────────────────────────────────────────────────────────

const GATEWAY_URL = ENV.bisGatewayUrl ?? ENV.gatewayUrl ?? "http://localhost:8081";
const GATEWAY_KEY = ENV.bisGatewayKey ?? "dev-gateway-key-change-in-prod";

async function gatewaySearch(payload: {
  query: string;
  indices?: string[];
  tenantId: string;
  from?: number;
  size?: number;
}): Promise<CrossEntitySearchResponse> {
  const resp = await fetch(`${GATEWAY_URL}/v1/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BIS-Key": GATEWAY_KEY,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Gateway search failed: ${resp.status} ${text}`);
  }

  return resp.json() as Promise<CrossEntitySearchResponse>;
}

function emptySearchResponse(): CrossEntitySearchResponse {
  const empty: SearchResult = { total: 0, hits: [], maxScore: 0 };
  return {
    "bis-investigations": empty,
    "bis-alerts": empty,
    "bis-kyc": empty,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

// ─── Document Indexing Helper ─────────────────────────────────────────────────

/**
 * Index a document into OpenSearch via the Go gateway.
 * Non-fatal: failures are logged but do not break the main flow.
 */
export async function indexDocument(
  index: "bis-investigations" | "bis-alerts" | "bis-kyc",
  id: string,
  doc: Record<string, unknown>,
  tenantId: string,
): Promise<void> {
  try {
    const resp = await fetch(`${GATEWAY_URL}/v1/search/index`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BIS-Key": GATEWAY_KEY,
      },
      body: JSON.stringify({ index, id, doc: { ...doc, tenantId }, tenantId }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.warn(`[OpenSearch] Index ${index}/${id} failed: ${resp.status} ${text}`);
    }
  } catch (err) {
    console.warn(`[OpenSearch] Index ${index}/${id} error:`, err);
  }
}

export const searchRouter = router({
  /**
   * cross: Full-text search across investigations, alerts, and KYC records.
   * Tenant-scoped: only returns documents belonging to the caller's tenant.
   */
  cross: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        indices: z
          .array(z.enum(["bis-investigations", "bis-alerts", "bis-kyc"]))
          .optional(),
        from: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = String(ctx.user.tenantId ?? ctx.user.id);

      try {
        const results = await gatewaySearch({
          query: input.query,
          indices: input.indices,
          tenantId,
          from: input.from,
          size: input.size,
        });
        return results;
      } catch (err) {
        // Fail open in dev mode — return empty results rather than crashing
        if (process.env.NODE_ENV !== "production") {
          return emptySearchResponse();
        }
        throw err;
      }
    }),

  /**
   * investigations: Search only the investigations index.
   */
  investigations: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        from: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = String(ctx.user.tenantId ?? ctx.user.id);

      try {
        const results = await gatewaySearch({
          query: input.query,
          indices: ["bis-investigations"],
          tenantId,
          from: input.from,
          size: input.size,
        });
        return results["bis-investigations"];
      } catch {
        return { total: 0, hits: [], maxScore: 0 } as SearchResult;
      }
    }),

  /**
   * alerts: Search only the AML alerts index.
   */
  alerts: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        from: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = String(ctx.user.tenantId ?? ctx.user.id);

      try {
        const results = await gatewaySearch({
          query: input.query,
          indices: ["bis-alerts"],
          tenantId,
          from: input.from,
          size: input.size,
        });
        return results["bis-alerts"];
      } catch {
        return { total: 0, hits: [], maxScore: 0 } as SearchResult;
      }
    }),

  /**
   * kyc: Search only the KYC records index.
   */
  kyc: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        from: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = String(ctx.user.tenantId ?? ctx.user.id);

      try {
        const results = await gatewaySearch({
          query: input.query,
          indices: ["bis-kyc"],
          tenantId,
          from: input.from,
          size: input.size,
        });
        return results["bis-kyc"];
      } catch {
        return { total: 0, hits: [], maxScore: 0 } as SearchResult;
      }
    }),
});
