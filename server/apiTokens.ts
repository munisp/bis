// server/apiTokens.ts
// Node.js BFF — tRPC router for developer API token management.
//
// Responsibilities (BFF layer only):
//   - CRUD for api_tokens table (create, list, revoke, update)
//   - Delegates token validation to Go gateway (apitoken/middleware.go)
//   - Delegates usage logging to Rust event processor (api_usage.rs)
//   - Delegates analytics aggregation to Python risk engine (api_analytics.py)
//   - Exposes usage stats by proxying the Python analytics endpoint
//
// Token lifecycle:
//   1. User creates token via trpc.apiTokens.create → BFF inserts row, returns plaintext ONCE
//   2. Developer uses token in Authorization: Bearer <token> on /api/v1/* routes
//   3. Go gateway validates hash, enforces rate limit via Redis, publishes to Kafka
//   4. Rust event processor consumes Kafka, writes token_usage_log + updates usageCount
//   5. Python analytics engine aggregates usage_log for billing and anomaly detection
//   6. Developer views stats via trpc.apiTokens.usageStats → BFF proxies Python analytics

import crypto from "crypto";
import { z } from "zod";
import { router, protectedProcedure, writeProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { apiTokens, tokenUsageLog } from "../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken(): { token: string; prefix: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const prefix = `bisk_live_${raw.slice(0, 8)}`;
  const token = `${prefix}_${raw.slice(8)}`;
  return { token, prefix };
}

const ANALYTICS_URL = process.env.RISK_ENGINE_URL ?? "http://localhost:8082";
const GATEWAY_KEY = process.env.BIS_GATEWAY_KEY ?? "dev-gateway-key-change-in-prod";

async function fetchAnalytics(path: string): Promise<unknown> {
  try {
    const res = await fetch(`${ANALYTICS_URL}${path}`, {
      headers: { "X-BIS-Key": GATEWAY_KEY },
    });
    if (!res.ok) throw new Error(`Analytics ${res.status}`);
    return res.json();
  } catch {
    return null;
  }
}

// ─── Available scopes (mirrors Go apitoken/middleware.go) ─────────────────────

export const AVAILABLE_SCOPES = [
  "investigations:read",
  "investigations:write",
  "kyc:read",
  "kyc:write",
  "alerts:read",
  "alerts:write",
  "reports:read",
  "reports:write",
  "screening:read",
  "screening:write",
  "field_agents:read",
  "field_agents:write",
  "audit:read",
  "data_sources:read",
  "admin:read",
  "admin:write",
] as const;

// ─── Router ───────────────────────────────────────────────────────────────────

export const apiTokensRouter = router({

  /** List API tokens visible to the current user */
  list: protectedProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      limit: z.number().min(1).max(250).default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };

      const conditions = [];
      if (input.tenantId !== undefined) {
        conditions.push(eq(apiTokens.tenantId, input.tenantId));
      } else if (ctx.user!.role !== "admin") {
        conditions.push(eq(apiTokens.createdBy, ctx.user!.id));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [items, countResult] = await Promise.all([
        db.select({
          id: apiTokens.id,
          tenantId: apiTokens.tenantId,
          name: apiTokens.name,
          prefix: apiTokens.prefix,
          scopes: apiTokens.scopes,
          rateLimit: apiTokens.rateLimit,
          usageCount: apiTokens.usageCount,
          lastUsedAt: apiTokens.lastUsedAt,
          expiresAt: apiTokens.expiresAt,
          active: apiTokens.active,
          createdBy: apiTokens.createdBy,
          createdAt: apiTokens.createdAt,
          updatedAt: apiTokens.updatedAt,
          // Never expose tokenHash
        }).from(apiTokens).where(where)
          .orderBy(desc(apiTokens.createdAt))
          .limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(apiTokens).where(where),
      ]);

      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  /** Create a new API token — returns the plaintext token ONCE */
  create: writeProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      tenantId: z.number().optional(),
      scopes: z.array(z.string()).default([]),
      rateLimit: z.number().min(1).max(10000).default(60),
      expiresAt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const { token, prefix } = generateToken();
      const tokenHash = hashToken(token);

      const [created] = await db.insert(apiTokens).values({
        name: input.name,
        tenantId: input.tenantId,
        prefix,
        tokenHash,
        scopes: input.scopes,
        rateLimit: input.rateLimit,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        createdBy: ctx.user!.id,
      }).returning({
        id: apiTokens.id,
        name: apiTokens.name,
        prefix: apiTokens.prefix,
        scopes: apiTokens.scopes,
        rateLimit: apiTokens.rateLimit,
        expiresAt: apiTokens.expiresAt,
        active: apiTokens.active,
        createdAt: apiTokens.createdAt,
      });

      // Return the plaintext token exactly once — it cannot be recovered
      return { ...created, plaintextToken: token };
    }),

  /** Revoke (deactivate) a token */
  revoke: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const [existing] = await db.select().from(apiTokens).where(eq(apiTokens.id, input.id)).limit(1);
      if (!existing) throw new Error("Token not found");
      if (existing.createdBy !== ctx.user!.id && ctx.user!.role !== "admin") {
        throw new Error("Forbidden: you cannot revoke this token");
      }

      await db.update(apiTokens)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(apiTokens.id, input.id));

      return { success: true };
    }),

  /** Update token name, scopes, or rate limit */
  update: writeProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      scopes: z.array(z.string()).optional(),
      rateLimit: z.number().min(1).max(10000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const [existing] = await db.select().from(apiTokens).where(eq(apiTokens.id, input.id)).limit(1);
      if (!existing) throw new Error("Token not found");
      if (existing.createdBy !== ctx.user!.id && ctx.user!.role !== "admin") {
        throw new Error("Forbidden");
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.scopes !== undefined) updates.scopes = input.scopes;
      if (input.rateLimit !== undefined) updates.rateLimit = input.rateLimit;

      await db.update(apiTokens).set(updates as any).where(eq(apiTokens.id, input.id));
      return { success: true };
    }),

  /** Per-token usage stats — proxied from Python analytics engine */
  usageStats: protectedProcedure
    .input(z.object({
      tokenId: z.number(),
      days: z.number().default(30),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return null;

      const [existing] = await db.select().from(apiTokens).where(eq(apiTokens.id, input.tokenId)).limit(1);
      if (!existing) throw new Error("Token not found");
      if (existing.createdBy !== ctx.user!.id && ctx.user!.role !== "admin") {
        throw new Error("Forbidden");
      }

      // Try Python analytics engine first (rich stats)
      const analytics = await fetchAnalytics(
        `/api/analytics/tokens/${input.tokenId}/summary?days=${input.days}`
      );
      if (analytics) return analytics;

      // Fallback: direct DB query (Rust event processor may not be running in dev)
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const [stats] = await db.select({
        total: sql<number>`count(*)`,
        avgLatency: sql<number>`avg("latencyMs")`,
      }).from(tokenUsageLog)
        .where(and(
          eq(tokenUsageLog.tokenId, input.tokenId),
          sql`"createdAt" >= ${since}`,
        ));

      const epRows = await db.select({
        endpoint: tokenUsageLog.endpoint,
        method: tokenUsageLog.method,
        count: sql<number>`count(*)`,
      }).from(tokenUsageLog)
        .where(and(eq(tokenUsageLog.tokenId, input.tokenId), sql`"createdAt" >= ${since}`))
        .groupBy(tokenUsageLog.endpoint, tokenUsageLog.method)
        .orderBy(desc(sql`count(*)`))
        .limit(10);

      return {
        token_id: input.tokenId,
        token_name: existing.name,
        total_requests: Number(stats?.total ?? 0),
        avg_latency_ms: Number(stats?.avgLatency ?? 0),
        period_days: input.days,
        top_endpoints: epRows,
      };
    }),

  /** Timeseries from Python analytics engine */
  timeseries: protectedProcedure
    .input(z.object({
      tokenId: z.number(),
      days: z.number().default(7),
      granularity: z.enum(["hour", "day"]).default("day"),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];

      const [existing] = await db.select().from(apiTokens).where(eq(apiTokens.id, input.tokenId)).limit(1);
      if (!existing) throw new Error("Token not found");
      if (existing.createdBy !== ctx.user!.id && ctx.user!.role !== "admin") {
        throw new Error("Forbidden");
      }

      const data = await fetchAnalytics(
        `/api/analytics/tokens/${input.tokenId}/timeseries?days=${input.days}&granularity=${input.granularity}`
      );
      return data ?? [];
    }),

  /** Anomaly detection from Python analytics engine */
  anomalies: protectedProcedure
    .input(z.object({ tokenId: z.number(), days: z.number().default(30) }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return null;

      const [existing] = await db.select().from(apiTokens).where(eq(apiTokens.id, input.tokenId)).limit(1);
      if (!existing) throw new Error("Token not found");
      if (existing.createdBy !== ctx.user!.id && ctx.user!.role !== "admin") {
        throw new Error("Forbidden");
      }

      return fetchAnalytics(`/api/analytics/tokens/${input.tokenId}/anomalies?days=${input.days}`);
    }),

  /** Platform-wide stats (admin only) */
  platformStats: adminProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ input }) => {
      return fetchAnalytics(`/api/analytics/platform/overview?days=${input.days}`);
    }),

  /** List available scopes */
  availableScopes: protectedProcedure.query(() => AVAILABLE_SCOPES),
});
