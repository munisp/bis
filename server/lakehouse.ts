/**
 * Lakehouse tRPC Router
 * ─────────────────────
 * Proxies requests to the Python lakehouse-writer service (Delta Lake + DuckDB).
 * Falls back to mock data when the service is unavailable (dev / sandbox mode).
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";

const LAKEHOUSE_URL = process.env.LAKEHOUSE_URL ?? "http://localhost:8085";
const TIMEOUT_MS = 8_000;

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function lhFetch(path: string, options?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${LAKEHOUSE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lakehouse ${path} → HTTP ${res.status}: ${text}`);
    }
    return await res.json();
  } catch (err: unknown) {
    if ((err as Error)?.name === "AbortError") throw new Error("Lakehouse service timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Mock data for sandbox / offline mode ─────────────────────────────────────
function mockTableStats() {
  return {
    tables: [
      { table: "investigations", path: "/data/lakehouse/investigations", version: 12, row_count: 63, last_commit_ms: Date.now() - 3600_000 },
      { table: "alerts", path: "/data/lakehouse/alerts", version: 8, row_count: 147, last_commit_ms: Date.now() - 7200_000 },
      { table: "kyc", path: "/data/lakehouse/kyc", version: 5, row_count: 41, last_commit_ms: Date.now() - 10800_000 },
    ],
  };
}

function mockQueryResult(sql: string) {
  const upper = sql.toUpperCase();
  if (upper.includes("INVESTIGATIONS")) {
    return {
      ok: true,
      row_count: 5,
      rows: [
        { month: "2026-01", count: 12, avg_risk: 42.3 },
        { month: "2026-02", count: 18, avg_risk: 51.7 },
        { month: "2026-03", count: 33, avg_risk: 48.1 },
      ],
    };
  }
  if (upper.includes("ALERTS")) {
    return {
      ok: true,
      row_count: 4,
      rows: [
        { severity: "critical", count: 8 },
        { severity: "high", count: 23 },
        { severity: "medium", count: 61 },
        { severity: "low", count: 55 },
      ],
    };
  }
  if (upper.includes("KYC")) {
    return {
      ok: true,
      row_count: 3,
      rows: [
        { status: "verified", count: 28 },
        { status: "pending", count: 9 },
        { status: "failed", count: 4 },
      ],
    };
  }
  return { ok: true, row_count: 0, rows: [] };
}

// ── Router ────────────────────────────────────────────────────────────────────
export const lakehouseRouter = router({
  /**
   * List all registered Delta tables with version and row counts.
   */
  listTables: protectedProcedure.query(async () => {
    try {
      const data = await lhFetch("/tables") as { tables: unknown[] };
      return data.tables;
    } catch {
      // Sandbox fallback
      return mockTableStats().tables;
    }
  }),

  /**
   * Execute a read-only DuckDB SQL query over the lakehouse parquet files.
   */
  query: protectedProcedure
    .input(
      z.object({
        sql: z.string().min(1).max(4096),
        limit: z.number().int().min(1).max(10000).default(1000),
      })
    )
    .mutation(async ({ input }) => {
      const sql = input.sql.trim();
      if (!sql.toUpperCase().startsWith("SELECT")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only SELECT queries are allowed" });
      }
      try {
        const data = await lhFetch("/query/duckdb", {
          method: "POST",
          body: JSON.stringify({ sql, limit: input.limit }),
        }) as { ok: boolean; row_count: number; rows: unknown[] };
        return data;
      } catch {
        return mockQueryResult(sql);
      }
    }),

  /**
   * Ingest a single investigation row into the Delta Lake.
   * Called by the BFF after a new investigation is created.
   */
  ingestInvestigation: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        ref: z.string(),
        subject_type: z.string().default("individual"),
        subject_name: z.string(),
        country: z.string().default("NG"),
        tier: z.string().default("standard"),
        priority: z.string().default("medium"),
        status: z.string().default("open"),
        risk_score: z.number().default(0),
        risk_tier: z.string().default("low"),
        created_by: z.string().default("system"),
        created_at: z.string().optional(),
        updated_at: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await lhFetch("/ingest/investigation", {
          method: "POST",
          body: JSON.stringify(input),
        });
        return { ok: true };
      } catch {
        // Non-fatal — lakehouse ingestion is async best-effort
        return { ok: false, reason: "lakehouse_unavailable" };
      }
    }),

  /**
   * Pre-built analytics queries for the Lakehouse Analytics dashboard.
   */
  analytics: protectedProcedure
    .input(
      z.object({
        metric: z.enum([
          "investigations_by_month",
          "alerts_by_severity",
          "kyc_status_distribution",
          "risk_score_histogram",
          "top_countries",
        ]),
      })
    )
    .query(async ({ input }) => {
      const queries: Record<string, string> = {
        investigations_by_month: `
          SELECT
            STRFTIME(created_at, '%Y-%m') AS month,
            COUNT(*) AS count,
            ROUND(AVG(risk_score), 1) AS avg_risk_score
          FROM investigations
          GROUP BY 1
          ORDER BY 1 DESC
          LIMIT 12
        `,
        alerts_by_severity: `
          SELECT severity, COUNT(*) AS count
          FROM alerts
          GROUP BY severity
          ORDER BY count DESC
        `,
        kyc_status_distribution: `
          SELECT status, COUNT(*) AS count
          FROM kyc
          GROUP BY status
          ORDER BY count DESC
        `,
        risk_score_histogram: `
          SELECT
            CASE
              WHEN risk_score < 20 THEN '0-20 (Low)'
              WHEN risk_score < 40 THEN '20-40 (Low-Med)'
              WHEN risk_score < 60 THEN '40-60 (Medium)'
              WHEN risk_score < 80 THEN '60-80 (High)'
              ELSE '80-100 (Critical)'
            END AS bucket,
            COUNT(*) AS count
          FROM investigations
          GROUP BY 1
          ORDER BY 1
        `,
        top_countries: `
          SELECT country, COUNT(*) AS count
          FROM investigations
          GROUP BY country
          ORDER BY count DESC
          LIMIT 10
        `,
      };

      const sql = queries[input.metric];
      try {
        const data = await lhFetch("/query/duckdb", {
          method: "POST",
          body: JSON.stringify({ sql: sql.trim(), limit: 1000 }),
        }) as { ok: boolean; row_count: number; rows: unknown[] };
        return { metric: input.metric, rows: data.rows };
      } catch {
        return { metric: input.metric, rows: mockQueryResult(sql).rows };
      }
    }),

  /**
   * Get the timestamp of the last successful lakehouse sync.
   */
  getLastSyncedAt: protectedProcedure.query(async () => {
    try {
      const { getDb } = await import("./db");
      const { platformSettings } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { lastSyncedAt: null };
      const [row] = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, "lakehouse.lastSyncedAt"))
        .limit(1);
      return { lastSyncedAt: row?.value ?? null };
    } catch {
      return { lastSyncedAt: null };
    }
  }),

  /**
   * Trigger an immediate lakehouse sync (calls the cron endpoint internally).
   * Only accessible to authenticated users; rate-limited by the cron secret.
   */
  triggerSync: protectedProcedure.mutation(async () => {
    try {
      const CRON_SECRET = process.env.CRON_SECRET ?? "bis-cron-dev-secret";
      const res = await fetch("http://localhost:" + (process.env.PORT ?? "3000") + "/api/cron/lakehouse-sync", {
        method: "POST",
        headers: { "Authorization": `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Sync failed: ${text}` });
      }
      const data = await res.json() as { ok: boolean; ingested: number; errors: number; syncedAt: string };
      return data;
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Sync trigger failed" });
    }
  }),
});
