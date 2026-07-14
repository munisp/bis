/**
 * server/orm/rls.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Row-Level Security (RLS) Helpers for BIS Platform
 *
 * Provides:
 *  1. withTenantRls()      — Set PostgreSQL session variable for RLS policies
 *  2. withUserRls()        — Set both tenant and user context for RLS
 *  3. buildTenantFilter()  — Drizzle SQL condition for tenant isolation
 *  4. assertTenantAccess() — Throw if a resource doesn't belong to the tenant
 *  5. RLS policy SQL       — Ready-to-run SQL to enable RLS on all tables
 */

import { eq, and, SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { BisDb } from "./index";
import * as schema from "../../drizzle/schema";

// ─── Session Variable Keys ────────────────────────────────────────────────────

export const RLS_TENANT_KEY = "bis.current_tenant_id";
export const RLS_USER_KEY = "bis.current_user_id";
export const RLS_ROLE_KEY = "bis.current_user_role";

// ─── Set RLS session variables ────────────────────────────────────────────────

/**
 * Sets the PostgreSQL session variable for tenant RLS.
 * Must be called at the start of each request transaction.
 *
 * @example
 * await withTenantRls(db, tenantId, async (tx) => {
 *   return tx.select().from(investigations); // automatically filtered by tenant
 * });
 */
export async function withTenantRls<T>(
  db: BisDb,
  tenantId: number,
  fn: (tx: BisDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL "${RLS_TENANT_KEY}" = '${tenantId}'`));
    return fn(tx as unknown as BisDb);
  });
}

/**
 * Sets both tenant and user RLS session variables.
 * Use for mutations that need both tenant isolation and user attribution.
 */
export async function withUserRls<T>(
  db: BisDb,
  tenantId: number,
  userId: number,
  userRole: string,
  fn: (tx: BisDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL "${RLS_TENANT_KEY}" = '${tenantId}'`));
    await tx.execute(sql.raw(`SET LOCAL "${RLS_USER_KEY}" = '${userId}'`));
    await tx.execute(sql.raw(`SET LOCAL "${RLS_ROLE_KEY}" = '${userRole}'`));
    return fn(tx as unknown as BisDb);
  });
}

// ─── Drizzle-level tenant filter (application-side RLS) ──────────────────────

/**
 * Returns a SQL condition for tenant isolation.
 * Use when database-level RLS is not enabled (e.g. in dev/test environments).
 *
 * @example
 * db.select().from(investigations).where(tenantFilter(tenantId))
 */
export function tenantFilter(tenantId: number): SQL {
  return eq(schema.investigations.tenantId, tenantId);
}

/**
 * Builds a tenant-scoped filter for any table that has a tenantId column.
 */
export function buildTenantFilter(
  table: { tenantId: unknown },
  tenantId: number,
): SQL {
  return eq(table.tenantId as never, tenantId);
}

// ─── Access assertion helpers ─────────────────────────────────────────────────

/**
 * Asserts that a resource belongs to the given tenant.
 * Throws a 403 TRPCError if the resource is not found or belongs to another tenant.
 */
export function assertTenantOwnership(
  resource: { tenantId?: number | null } | null | undefined,
  tenantId: number,
  resourceName = "Resource",
): void {
  if (!resource) {
    throw new Error(`${resourceName} not found`);
  }
  if (resource.tenantId !== null && resource.tenantId !== undefined && resource.tenantId !== tenantId) {
    throw new Error(`${resourceName} does not belong to tenant ${tenantId}`);
  }
}

/**
 * Asserts that a user has one of the allowed roles.
 */
export function assertRole(
  userRole: string,
  allowedRoles: string[],
  action = "perform this action",
): void {
  if (!allowedRoles.includes(userRole)) {
    throw new Error(`Role '${userRole}' is not authorized to ${action}`);
  }
}

// ─── RLS Policy SQL (run once during DB setup) ────────────────────────────────

/**
 * Returns the SQL statements to enable PostgreSQL Row-Level Security
 * on all BIS tenant-scoped tables.
 *
 * Run this once against the database to enable database-level RLS.
 * After enabling, all queries MUST set the session variable via withTenantRls().
 *
 * @example
 * const statements = getRlsPolicySql();
 * for (const stmt of statements) {
 *   await db.execute(sql.raw(stmt));
 * }
 */
export function getRlsPolicySql(): string[] {
  const tenantTables = [
    "investigations",
    "kyc_records",
    "alerts",
    "alert_rules",
    "cases",
    "field_tasks",
    "field_agents",
    "reports",
    "transactions",
    "aml_alerts",
    "sar_filings",
    "screening_orders",
    "screening_results",
    "candidate_profiles",
    "lex_submissions",
    "field_visit_reports",
    "criminal_record_requests",
    "onboarding_applications",
    "biometric_session_logs",
    "temporal_workflow_states",
    "dapr_subscription_states",
    "apisix_audit_logs",
    "tigerbeetle_accounts",
    "tigerbeetle_transfers",
  ];

  const statements: string[] = [];

  // Create the helper function to read session variable
  statements.push(`
    CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS integer AS $$
      SELECT NULLIF(current_setting('${RLS_TENANT_KEY}', true), '')::integer;
    $$ LANGUAGE sql STABLE;
  `);

  statements.push(`
    CREATE OR REPLACE FUNCTION current_user_id() RETURNS integer AS $$
      SELECT NULLIF(current_setting('${RLS_USER_KEY}', true), '')::integer;
    $$ LANGUAGE sql STABLE;
  `);

  // Enable RLS and create policies for each tenant-scoped table
  for (const table of tenantTables) {
    statements.push(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    statements.push(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);

    // SELECT policy — only see own tenant's rows
    statements.push(`
      DROP POLICY IF EXISTS "${table}_tenant_isolation" ON "${table}";
      CREATE POLICY "${table}_tenant_isolation" ON "${table}"
        AS PERMISSIVE FOR ALL
        USING (
          "tenantId" IS NULL
          OR "tenantId" = current_tenant_id()
          OR current_tenant_id() IS NULL  -- bypass for migrations/seeds
        );
    `);
  }

  return statements;
}

/**
 * Returns SQL to disable RLS on all tables (for testing/migrations).
 */
export function getDisableRlsSql(): string[] {
  const tenantTables = [
    "investigations", "kyc_records", "alerts", "alert_rules", "cases",
    "field_tasks", "field_agents", "reports", "transactions", "aml_alerts",
    "sar_filings", "screening_orders", "screening_results", "candidate_profiles",
    "lex_submissions", "field_visit_reports", "criminal_record_requests",
    "onboarding_applications", "biometric_session_logs",
  ];

  return tenantTables.map((table) => `ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`);
}
