/**
 * server/orm/migrations.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * BIS Programmatic Migration Runner
 *
 * Provides:
 *  1. runMigrations()     — Run all pending Drizzle migrations
 *  2. rollbackMigration() — Roll back the last migration using .rollback.sql
 *  3. getMigrationStatus() — List applied and pending migrations
 *  4. createMaterializedViews() — Create all analytics materialized views
 *  5. enableRls()         — Enable PostgreSQL RLS on all tenant tables
 */

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { getMaterializedViewSql } from "./analytics";
import { getRlsPolicySql } from "./rls";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../drizzle");

// ─── runMigrations ────────────────────────────────────────────────────────────

/**
 * Runs all pending Drizzle migrations against the database.
 * Safe to call on every application startup (idempotent).
 */
export async function runMigrations(databaseUrl: string): Promise<{
  success: boolean;
  appliedCount: number;
  error?: string;
}> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    console.log("[Migrations] Running pending migrations...");
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    console.log("[Migrations] All migrations applied successfully");
    return { success: true, appliedCount: -1 }; // drizzle migrate doesn't return count
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Migrations] Migration failed:", message);
    return { success: false, appliedCount: 0, error: message };
  } finally {
    await pool.end();
  }
}

// ─── rollbackMigration ────────────────────────────────────────────────────────

/**
 * Rolls back the most recently applied migration by executing its .rollback.sql file.
 * Requires a corresponding .rollback.sql file to exist alongside the migration.
 */
export async function rollbackMigration(
  databaseUrl: string,
  migrationName: string,
): Promise<{ success: boolean; error?: string }> {
  const rollbackFile = path.join(MIGRATIONS_DIR, `${migrationName}.rollback.sql`);

  if (!fs.existsSync(rollbackFile)) {
    return {
      success: false,
      error: `Rollback file not found: ${rollbackFile}`,
    };
  }

  const rollbackSql = fs.readFileSync(rollbackFile, "utf8");
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    console.log(`[Migrations] Rolling back: ${migrationName}`);
    // Execute rollback SQL in a transaction
    await db.transaction(async (tx) => {
      // Split by statement terminator and execute each
      const statements = rollbackSql
        .split(/;\s*\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("--"));

      for (const stmt of statements) {
        await tx.execute(sql.raw(stmt));
      }

      // Remove from drizzle migrations journal
      await tx.execute(
        sql.raw(`DELETE FROM "__drizzle_migrations" WHERE hash = '${migrationName}'`)
      );
    });

    console.log(`[Migrations] Rollback complete: ${migrationName}`);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Migrations] Rollback failed:", message);
    return { success: false, error: message };
  } finally {
    await pool.end();
  }
}

// ─── getMigrationStatus ───────────────────────────────────────────────────────

/**
 * Returns the status of all migrations — applied vs pending.
 */
export async function getMigrationStatus(databaseUrl: string): Promise<{
  applied: string[];
  pending: string[];
  total: number;
}> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    // Get applied migrations from drizzle journal table
    let applied: string[] = [];
    try {
      const rows = await db.execute(
        sql.raw(`SELECT hash FROM "__drizzle_migrations" ORDER BY created_at ASC`)
      ) as unknown as { rows: { hash: string }[] };
      applied = rows.rows.map((r) => r.hash);
    } catch {
      // Table doesn't exist yet — no migrations applied
    }

    // Get all migration files on disk
    const allFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && !f.endsWith(".rollback.sql"))
      .sort();

    const pending = allFiles.filter((f) => !applied.includes(f.replace(".sql", "")));

    return {
      applied,
      pending,
      total: allFiles.length,
    };
  } finally {
    await pool.end();
  }
}

// ─── createMaterializedViews ──────────────────────────────────────────────────

/**
 * Creates all BIS analytics materialized views.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export async function createMaterializedViews(databaseUrl: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    console.log("[Migrations] Creating materialized views...");
    const statements = getMaterializedViewSql();
    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }
    console.log("[Migrations] Materialized views created successfully");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Migrations] Failed to create materialized views:", message);
    return { success: false, error: message };
  } finally {
    await pool.end();
  }
}

// ─── enableRls ────────────────────────────────────────────────────────────────

/**
 * Enables PostgreSQL Row-Level Security on all BIS tenant-scoped tables.
 * Should be run once in production after initial migration.
 *
 * WARNING: After enabling RLS, all queries MUST set the session variable
 * via withTenantRls() or they will see no rows.
 */
export async function enableRls(databaseUrl: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    console.log("[Migrations] Enabling Row-Level Security...");
    const statements = getRlsPolicySql();
    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }
    console.log("[Migrations] RLS enabled successfully");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Migrations] Failed to enable RLS:", message);
    return { success: false, error: message };
  } finally {
    await pool.end();
  }
}
