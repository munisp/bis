/**
 * Hot/Warm/Cold Data Tiering and Archival Job
 *
 * Lesson from 1B payments article (https://backend.how/posts/1b-payments-per-day/):
 * "Use a tiered storage strategy: hot (0–90 days), warm (90 days–1 year), cold (1–10 years)."
 *
 * Tier definitions:
 *   HOT  (0–90 days):    TigerBeetle ledger + MySQL (fast reads, full indexes)
 *   WARM (90d–1 year):   ClickHouse OLAP (analytical queries, compressed columnar)
 *   COLD (1–10 years):   S3 Parquet (regulatory retention, near-zero cost)
 *
 * This module implements:
 *   1. Tiering configuration constants
 *   2. A nightly archival job that moves aged transactions from MySQL → ClickHouse → S3
 *   3. A tRPC procedure to trigger archival manually (admin-only)
 *   4. Archival status tracking in the DB
 */
import { z } from "zod";
import { router, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { transactions } from "../drizzle/schema";
import { lt, and, isNull, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { storagePut } from "./storage";
import { createClient as createClickHouseClient } from "@clickhouse/client";
import { ENV } from "./_core/env";

/**
 * Get a ClickHouse client configured from ENV.
 * Returns null if CLICKHOUSE_URL is not set (dev/sandbox mode).
 */
function getClickHouseClient() {
  if (!ENV.clickhouseUrl || ENV.clickhouseUrl.includes("localhost")) {
    return null; // Not configured — fall back to S3 JSONL
  }
  return createClickHouseClient({
    url: ENV.clickhouseUrl,
    database: ENV.clickhouseDatabase,
    username: ENV.clickhouseUser,
    password: ENV.clickhousePassword,
    request_timeout: 60_000,
    compression: { request: true, response: true },
  });
}

// ─── Tiering constants ────────────────────────────────────────────────────────

export const TIERS = {
  /**
   * HOT tier: TigerBeetle + MySQL
   * Age: 0–90 days
   * Characteristics: O_DIRECT WAL, zero fsyncs, full indexes, sub-ms reads
   * Lesson: TigerBeetle achieves 48K sustained TPS because it never calls fsync —
   *         durability comes from O_DIRECT + circular WAL + checksums.
   */
  HOT: {
    name: "hot",
    maxAgeDays: 90,
    storage: ["tigerbeetle", "mysql"],
    readLatencyTarget: "< 1ms",
    description: "TigerBeetle ledger + MySQL (0–90 days)",
  },
  /**
   * WARM tier: ClickHouse OLAP
   * Age: 90 days – 1 year
   * Characteristics: columnar storage, 10:1 compression, fast aggregations
   * Lesson: Move aged data out of the transactional DB to keep hot-tier indexes small.
   *         ClickHouse can scan 1B rows/sec for analytical queries.
   */
  WARM: {
    name: "warm",
    minAgeDays: 90,
    maxAgeDays: 365,
    storage: ["clickhouse"],
    readLatencyTarget: "< 100ms",
    description: "ClickHouse OLAP (90 days – 1 year)",
  },
  /**
   * COLD tier: S3 Parquet
   * Age: 1–10 years
   * Characteristics: near-zero storage cost, Parquet columnar format, Athena queryable
   * Lesson: Regulatory retention (CBN requires 10 years for AML records).
   *         S3 + Athena costs ~$0.005/GB/month vs $0.10/GB for hot storage.
   */
  COLD: {
    name: "cold",
    minAgeDays: 365,
    maxAgeDays: 3650,
    storage: ["s3_parquet"],
    readLatencyTarget: "< 10s",
    description: "S3 Parquet (1–10 years)",
  },
} as const;

// ─── Archival job ─────────────────────────────────────────────────────────────

export interface ArchivalResult {
  tier: "warm" | "cold";
  rowsArchived: number;
  bytesWritten: number;
  s3Key?: string;
  durationMs: number;
  errors: string[];
}

/**
 * archiveToWarm moves transactions older than 90 days from MySQL to ClickHouse.
 * In production, this would use a ClickHouse HTTP client to INSERT SELECT.
 * Here we stub the ClickHouse write and log the operation.
 */
export async function archiveToWarm(dryRun = false): Promise<ArchivalResult> {
  const start = Date.now();
  const errors: string[] = [];
  const db = await getDb();
  if (!db) {
    return { tier: "warm", rowsArchived: 0, bytesWritten: 0, durationMs: 0, errors: ["DB unavailable"] };
  }

  const cutoff = new Date(Date.now() - TIERS.HOT.maxAgeDays * 24 * 60 * 60 * 1000);
  const warmCutoff = new Date(Date.now() - TIERS.WARM.maxAgeDays * 24 * 60 * 60 * 1000);

  // Find transactions in the warm window (90d–1yr old) that haven't been archived yet
  const rows = await db.select({
    id: transactions.id,
    txRef: transactions.txRef,
    type: transactions.type,
    status: transactions.status,
    amount: transactions.amount,
    currency: transactions.currency,
    originatorName: transactions.originatorName,
    beneficiaryName: transactions.beneficiaryName,
    createdAt: transactions.createdAt,
  }).from(transactions)
    .where(
      and(
        lt(transactions.createdAt, cutoff),
        // Only archive completed/failed/reversed — not pending/under_review
        sql`${transactions.status} IN ('completed', 'failed', 'reversed', 'blocked')`,
        // ── Idempotency: skip rows already archived to warm or cold tier ──
        isNull(transactions.archivedTier)
      )
    )
    .limit(10000); // Process in batches of 10K (1B payments lesson: batch everything)

  if (rows.length === 0) {
    return { tier: "warm", rowsArchived: 0, bytesWritten: 0, durationMs: Date.now() - start, errors };
  }

  const jsonl = rows.map(r => JSON.stringify(r)).join("\n");
  const bytes = Buffer.byteLength(jsonl, "utf8");
  let s3Key: string | undefined;

  if (!dryRun) {
    const ch = getClickHouseClient();
    if (ch) {
      // ── ClickHouse warm-tier INSERT ────────────────────────────────────────
      // Ensure the target table exists (idempotent CREATE TABLE IF NOT EXISTS)
      try {
        await ch.command({
          query: `
            CREATE TABLE IF NOT EXISTS bis_transactions_warm (
              id          UInt64,
              txRef       String,
              type        String,
              status      String,
              amount      Float64,
              currency    String,
              originatorName String,
              beneficiaryName String,
              createdAt   DateTime64(3, 'UTC'),
              archivedAt  DateTime64(3, 'UTC') DEFAULT now()
            ) ENGINE = MergeTree()
            ORDER BY (createdAt, id)
            PARTITION BY toYYYYMM(createdAt)
            TTL createdAt + INTERVAL 1 YEAR DELETE
          `,
        });
        await ch.insert({
          table: "bis_transactions_warm",
          values: rows.map(r => ({
            id: r.id,
            txRef: r.txRef ?? "",
            type: r.type ?? "",
            status: r.status ?? "",
            amount: Number(r.amount ?? 0),
            currency: r.currency ?? "NGN",
            originatorName: r.originatorName ?? "",
            beneficiaryName: r.beneficiaryName ?? "",
            createdAt: r.createdAt ? r.createdAt.toISOString().replace("T", " ").replace("Z", "") : null,
          })),
          format: "JSONEachRow",
        });
        await ch.close();
      } catch (err: any) {
        errors.push(`ClickHouse INSERT failed: ${err.message}`);
        await ch.close().catch(() => {});
        // Fall through to S3 JSONL backup
      }
    }

    // Always write S3 JSONL as backup / audit trail
    try {
      const date = new Date().toISOString().slice(0, 10);
      s3Key = `archival/warm/${date}/transactions-${Date.now()}.jsonl`;
      await storagePut(s3Key, Buffer.from(jsonl), "application/x-ndjson");
    } catch (err: any) {
      errors.push(`S3 write failed: ${err.message}`);
    }

    // ── Mark rows as archived to prevent double-archival on next run ──
    if (errors.length === 0) {
      const { inArray } = await import("drizzle-orm");
      const ids = rows.map(r => r.id);
      // Process in chunks of 1000 to avoid IN clause limits
      for (let i = 0; i < ids.length; i += 1000) {
        await db.update(transactions)
          .set({ archivedTier: "warm" as any, archivedAt: new Date() })
          .where(inArray(transactions.id, ids.slice(i, i + 1000)))
          .catch((e: Error) => errors.push(`archivedTier update failed: ${e.message}`));
      }
    }
  }

  return {
    tier: "warm",
    rowsArchived: rows.length,
    bytesWritten: bytes,
    s3Key,
    durationMs: Date.now() - start,
    errors,
  };
}

/**
 * archiveToCold moves transactions older than 1 year to S3 Parquet.
 * In production, this would use Apache Arrow/Parquet writer.
 * Here we write a compressed JSON archive to S3.
 */
export async function archiveToCold(dryRun = false): Promise<ArchivalResult> {
  const start = Date.now();
  const errors: string[] = [];
  const db = await getDb();
  if (!db) {
    return { tier: "cold", rowsArchived: 0, bytesWritten: 0, durationMs: 0, errors: ["DB unavailable"] };
  }

  const cutoff = new Date(Date.now() - TIERS.WARM.maxAgeDays * 24 * 60 * 60 * 1000);

  const rows = await db.select().from(transactions)
    .where(
      and(
        lt(transactions.createdAt, cutoff),
        sql`${transactions.status} IN ('completed', 'failed', 'reversed', 'blocked')`,
        // ── Idempotency: skip rows already archived to cold tier ──
        sql`${transactions.archivedTier} IS NULL OR ${transactions.archivedTier} = 'warm'`
      )
    )
    .limit(50000); // Larger batch for cold archival

  if (rows.length === 0) {
    return { tier: "cold", rowsArchived: 0, bytesWritten: 0, durationMs: Date.now() - start, errors };
  }

  // Write as JSON array (production: Apache Parquet via arrow2 or parquet-wasm)
  const json = JSON.stringify(rows);
  const bytes = Buffer.byteLength(json, "utf8");

  let s3Key: string | undefined;
  if (!dryRun) {
    try {
      const date = new Date().toISOString().slice(0, 10);
      s3Key = `archival/cold/${date}/transactions-${Date.now()}.json`;
      await storagePut(s3Key, Buffer.from(json), "application/json");
    } catch (err: any) {
      errors.push(`S3 write failed: ${err.message}`);
    }

    // ── Mark rows as cold-archived to prevent double-archival on next run ──
    if (errors.length === 0) {
      const { inArray } = await import("drizzle-orm");
      const ids = rows.map(r => r.id);
      for (let i = 0; i < ids.length; i += 1000) {
        await db.update(transactions)
          .set({ archivedTier: "cold" as any, archivedAt: new Date() })
          .where(inArray(transactions.id, ids.slice(i, i + 1000)))
          .catch((e: Error) => errors.push(`archivedTier cold update failed: ${e.message}`));
      }
    }
  }

  return {
    tier: "cold",
    rowsArchived: rows.length,
    bytesWritten: bytes,
    s3Key,
    durationMs: Date.now() - start,
    errors,
  };
}

// ─── Standalone job (called by cron scheduler) ──────────────────────────────

/**
 * runArchivalJob — callable directly from the cron scheduler (no tRPC overhead).
 * Runs both warm and cold archival passes sequentially and logs results.
 */
export async function runArchivalJob(): Promise<void> {
  const label = "[ArchivalJob]";
  console.log(`${label} Starting nightly archival run — ${new Date().toISOString()}`);
  try {
    const warm = await archiveToWarm(false);
    console.log(
      `${label} Warm tier: ${warm.rowsArchived} rows archived, ` +
      `${warm.bytesWritten} bytes written, ${warm.durationMs}ms` +
      (warm.errors.length ? ` | errors: ${warm.errors.join("; ")}` : "")
    );
  } catch (err) {
    console.error(`${label} Warm archival failed:`, err);
  }
  try {
    const cold = await archiveToCold(false);
    console.log(
      `${label} Cold tier: ${cold.rowsArchived} rows archived, ` +
      `${cold.bytesWritten} bytes written, ${cold.durationMs}ms` +
      (cold.errors.length ? ` | errors: ${cold.errors.join("; ")}` : "")
    );
  } catch (err) {
    console.error(`${label} Cold archival failed:`, err);
  }
  console.log(`${label} Nightly archival run complete — ${new Date().toISOString()}`);
}

// ─── tRPC router ──────────────────────────────────────────────────────────────

export const archivalRouter = router({
  /**
   * Get tiering configuration and current tier statistics.
   */
  getTierConfig: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const now = new Date();
    const hotCutoff = new Date(now.getTime() - TIERS.HOT.maxAgeDays * 24 * 60 * 60 * 1000);
    const warmCutoff = new Date(now.getTime() - TIERS.WARM.maxAgeDays * 24 * 60 * 60 * 1000);

    const [hotCount] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`${transactions.createdAt} >= ${hotCutoff}`);

    const [warmCount] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(
        and(
          sql`${transactions.createdAt} < ${hotCutoff}`,
          sql`${transactions.createdAt} >= ${warmCutoff}`
        )
      );

    const [coldCount] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(sql`${transactions.createdAt} < ${warmCutoff}`);

    return {
      tiers: TIERS,
      stats: {
        hot: { count: hotCount?.count ?? 0, cutoffDate: hotCutoff },
        warm: { count: warmCount?.count ?? 0, cutoffDate: warmCutoff },
        cold: { count: coldCount?.count ?? 0 },
      },
    };
  }),

  /**
   * Trigger archival manually (admin-only).
   * In production, this runs nightly via cron (e.g., 02:00 UTC).
   */
  runArchival: adminProcedure
    .input(z.object({
      tier: z.enum(["warm", "cold", "all"]),
      dryRun: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const results: ArchivalResult[] = [];

      if (input.tier === "warm" || input.tier === "all") {
        const result = await archiveToWarm(input.dryRun);
        results.push(result);
      }

      if (input.tier === "cold" || input.tier === "all") {
        const result = await archiveToCold(input.dryRun);
        results.push(result);
      }

      const totalRows = results.reduce((sum, r) => sum + r.rowsArchived, 0);
      const totalBytes = results.reduce((sum, r) => sum + r.bytesWritten, 0);
      const allErrors = results.flatMap(r => r.errors);

      return {
        dryRun: input.dryRun,
        results,
        summary: {
          totalRowsArchived: totalRows,
          totalBytesWritten: totalBytes,
          errors: allErrors,
          completedAt: new Date(),
        },
      };
    }),
});
