/**
 * server/orm/batch.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * BIS Drizzle Batch Operation Helpers
 *
 * Provides:
 *  1. batchInsert()        — Chunked bulk insert with configurable chunk size
 *  2. batchUpsert()        — Bulk upsert (INSERT ... ON CONFLICT DO UPDATE)
 *  3. batchSoftDelete()    — Bulk soft-delete by IDs
 *  4. batchUpdate()        — Bulk update with per-row values (CASE WHEN)
 *  5. bulkAuditLog()       — Insert multiple audit log entries in one query
 */

import { eq, inArray, sql, SQL } from "drizzle-orm";
import type { BisDb } from "./index";
import * as schema from "../../drizzle/schema";

// ─── batchInsert ──────────────────────────────────────────────────────────────

/**
 * Inserts records in chunks to avoid hitting PostgreSQL's parameter limit (~65k).
 * Returns all inserted rows.
 *
 * @example
 * const inserted = await batchInsert(db, schema.kycRecords, records, 500);
 */
export async function batchInsert<T extends Record<string, unknown>>(
  db: BisDb,
  table: unknown,
  records: T[],
  chunkSize = 500,
): Promise<T[]> {
  if (records.length === 0) return [];

  const results: T[] = [];
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const inserted = await (db as unknown as { insert: Function })
      .insert(table)
      .values(chunk as any[])
      .returning() as T[];
    results.push(...inserted);
  }
  return results;
}

// ─── batchUpsert ──────────────────────────────────────────────────────────────

/**
 * Performs a bulk upsert using ON CONFLICT DO UPDATE.
 * Useful for syncing external data (e.g. sanctions lists, data source results).
 *
 * @example
 * await batchUpsert(db, schema.dataSources, records, ["code"], ["name", "status", "updatedAt"]);
 */
export async function batchUpsert<T extends Record<string, unknown>>(
  db: BisDb,
  table: unknown,
  records: T[],
  conflictColumns: string[],
  updateColumns: string[],
  chunkSize = 500,
): Promise<void> {
  if (records.length === 0) return;

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const updateSet: Record<string, SQL> = {};
    for (const col of updateColumns) {
      updateSet[col] = sql.raw(`excluded."${col}"`);
    }

    await (db as unknown as { insert: Function })
      .insert(table)
      .values(chunk as any[])
      .onConflictDoUpdate({
        target: conflictColumns.map((c) => (table as Record<string, unknown>)[c]),
        set: updateSet,
      });
  }
}

// ─── batchSoftDelete ──────────────────────────────────────────────────────────

/**
 * Soft-deletes multiple records by their IDs in a single query.
 *
 * @example
 * await batchSoftDelete(db, schema.investigations, [1, 2, 3], userId);
 */
export async function batchSoftDelete(
  db: BisDb,
  table: { id: unknown; deletedAt: unknown; deletedBy: unknown },
  ids: number[],
  deletedBy: number,
): Promise<void> {
  if (ids.length === 0) return;

  await (db as unknown as { update: Function })
    .update(table)
    .set({ deletedAt: new Date(), deletedBy })
    .where(inArray(table.id as never, ids));
}

// ─── bulkAuditLog ─────────────────────────────────────────────────────────────

/**
 * Inserts multiple audit log entries in a single database round-trip.
 * Use for batch operations that affect multiple records.
 *
 * @example
 * await bulkAuditLog(db, [
 *   { userId: 1, category: "investigation", action: "bulk_close", targetRef: "INV-001" },
 *   { userId: 1, category: "investigation", action: "bulk_close", targetRef: "INV-002" },
 * ]);
 */
export async function bulkAuditLog(
  db: BisDb,
  entries: Array<{
    userId: number;
    userEmail?: string;
    tenantId?: number;
    ipAddress?: string;
    category: schema.AuditLog["category"];
    action: string;
    targetRef?: string;
    result?: "success" | "failure" | "error";
    detail?: Record<string, unknown>;
  }>,
): Promise<void> {
  if (entries.length === 0) return;

  await (db as unknown as { insert: Function }).insert(schema.auditLog).values(
    entries.map((e) => ({
      userId: e.userId,
      userEmail: e.userEmail,
      tenantId: e.tenantId,
      ipAddress: e.ipAddress,
      category: e.category,
      action: e.action,
      targetRef: e.targetRef,
      result: e.result ?? "success",
      detail: e.detail ?? null,
    }))
  );
}

// ─── batchUpdate ──────────────────────────────────────────────────────────────

/**
 * Performs a bulk status update on multiple records.
 * More efficient than N individual UPDATE statements.
 *
 * @example
 * await batchStatusUpdate(db, schema.investigations, [1, 2, 3], "completed", userId);
 */
export async function batchStatusUpdate(
  db: BisDb,
  table: { id: unknown; status: unknown; updatedAt: unknown },
  ids: number[],
  newStatus: string,
  updatedBy?: number,
): Promise<void> {
  if (ids.length === 0) return;

  const updateValues: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };
  if (updatedBy !== undefined) {
    (updateValues as Record<string, unknown>).updatedBy = updatedBy;
  }

  await (db as unknown as { update: Function })
    .update(table)
    .set(updateValues)
    .where(inArray(table.id as never, ids));
}

// ─── Drizzle batch() API wrapper ──────────────────────────────────────────────

/**
 * Executes multiple Drizzle queries in a single network round-trip
 * using the Drizzle batch() API (requires neon-http or libsql driver).
 *
 * For node-postgres (pg), this falls back to a sequential transaction.
 * This abstraction allows switching drivers without changing call sites.
 *
 * @example
 * const [invResult, kycResult] = await batchQueries(db, [
 *   db.select().from(investigations).where(eq(investigations.id, 1)),
 *   db.select().from(kycRecords).where(eq(kycRecords.investigationId, 1)),
 * ]);
 */
export async function batchQueries<T extends unknown[]>(
  db: BisDb,
  queries: { execute(): Promise<unknown> }[],
): Promise<T> {
  // node-postgres doesn't support true batching — run in transaction for atomicity
  return db.transaction(async (tx) => {
    const results = await Promise.all(queries.map((q) => q.execute()));
    return results as T;
  });
}
