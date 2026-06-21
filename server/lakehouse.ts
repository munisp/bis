/**
 * Lakehouse tRPC Router
 * ─────────────────────
 * Proxies requests to the Python lakehouse-writer service (Delta Lake + DuckDB).
 * When the service is unavailable, returns empty results with a service_unavailable
 * flag rather than fabricating mock data.
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";

const LAKEHOUSE_URL = ENV.lakehouseUrl;
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

// ── Router ────────────────────────────────────────────────────────────────────
export const lakehouseRouter = router({
  /**
   * List all registered Delta tables with version and row counts.
   * Returns empty array with service_unavailable flag when service is down.
   */
  listTables: protectedProcedure.query(async () => {
    try {
      const data = await lhFetch("/tables") as { tables: unknown[] };
      return { tables: data.tables, service_available: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[Lakehouse] listTables unavailable:", msg);
      return { tables: [], service_available: false, reason: msg.slice(0, 200) };
    }
  }),

  /**
   * Execute a read-only DuckDB SQL query over the lakehouse parquet files.
   * Returns empty result with service_unavailable flag when service is down.
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
        return { ...data, service_available: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[Lakehouse] query unavailable:", msg);
        return { ok: false, row_count: 0, rows: [], service_available: false, reason: msg.slice(0, 200) };
      }
    }),

  /**
   * Ingest a single investigation row into the Delta Lake.
   * Called by the BFF after a new investigation is created.
   * Non-fatal — lakehouse ingestion is async best-effort.
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
        return { ok: true, service_available: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[Lakehouse] ingestInvestigation unavailable:", msg);
        return { ok: false, service_available: false, reason: "lakehouse_unavailable" };
      }
    }),

  /**
   * Pre-built analytics queries for the Lakehouse Analytics dashboard.
   * Returns empty rows with service_unavailable flag when service is down.
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
        return { metric: input.metric, rows: data.rows, service_available: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[Lakehouse] analytics unavailable:", msg);
        return { metric: input.metric, rows: [], service_available: false, reason: msg.slice(0, 200) };
      }
    }),
});
