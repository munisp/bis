/**
 * server/orm/prepared.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * BIS Prepared Statements
 *
 * Drizzle supports PostgreSQL prepared statements via .prepare().
 * Prepared statements are parsed and planned once, then reused — reducing
 * per-query overhead for the platform's most frequently executed queries.
 *
 * Provides prepared statements for:
 *  - Investigation lookups (by id, ref, tenantId)
 *  - KYC record lookups (by id, nin, bvn)
 *  - Alert queries (unacknowledged by tenant)
 *  - Case lookups (by id, ref)
 *  - User lookups (by openId, email)
 *  - Audit log inserts
 */

import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../drizzle/schema";

// We export factory functions that take a db instance and return prepared statements.
// This avoids module-level singleton issues in test environments.

export function createPreparedStatements(db: ReturnType<typeof drizzle>) {
  // ── Investigation queries ──────────────────────────────────────────────────

  const getInvestigationById = db
    .select()
    .from(schema.investigations)
    .where(
      and(
        eq(schema.investigations.id, sql.placeholder("id")),
        isNull(schema.investigations.deletedAt),
      )
    )
    .limit(1)
    .prepare("get_investigation_by_id");

  const getInvestigationByRef = db
    .select()
    .from(schema.investigations)
    .where(
      and(
        eq(schema.investigations.ref, sql.placeholder("ref")),
        isNull(schema.investigations.deletedAt),
      )
    )
    .limit(1)
    .prepare("get_investigation_by_ref");

  const listInvestigationsByTenant = db
    .select()
    .from(schema.investigations)
    .where(
      and(
        eq(schema.investigations.tenantId, sql.placeholder("tenantId")),
        isNull(schema.investigations.deletedAt),
      )
    )
    .orderBy(desc(schema.investigations.createdAt))
    .limit(sql.placeholder("limit"))
    .offset(sql.placeholder("offset"))
    .prepare("list_investigations_by_tenant");

  // ── KYC queries ────────────────────────────────────────────────────────────

  const getKycById = db
    .select()
    .from(schema.kycRecords)
    .where(
      and(
        eq(schema.kycRecords.id, sql.placeholder("id")),
        isNull(schema.kycRecords.deletedAt),
      )
    )
    .limit(1)
    .prepare("get_kyc_by_id");

  const getKycByNin = db
    .select()
    .from(schema.kycRecords)
    .where(
      and(
        eq(schema.kycRecords.nin, sql.placeholder("nin")),
        isNull(schema.kycRecords.deletedAt),
      )
    )
    .limit(1)
    .prepare("get_kyc_by_nin");

  const getKycByBvn = db
    .select()
    .from(schema.kycRecords)
    .where(
      and(
        eq(schema.kycRecords.bvn, sql.placeholder("bvn")),
        isNull(schema.kycRecords.deletedAt),
      )
    )
    .limit(1)
    .prepare("get_kyc_by_bvn");

  // ── Alert queries ──────────────────────────────────────────────────────────

  const getUnacknowledgedAlerts = db
    .select()
    .from(schema.alerts)
    .where(
      and(
        eq(schema.alerts.tenantId, sql.placeholder("tenantId")),
        eq(schema.alerts.acknowledged, false),
        eq(schema.alerts.dismissed, false),
        isNull(schema.alerts.deletedAt),
      )
    )
    .orderBy(desc(schema.alerts.createdAt))
    .limit(sql.placeholder("limit"))
    .prepare("get_unacknowledged_alerts");

  // ── Case queries ───────────────────────────────────────────────────────────

  const getCaseById = db
    .select()
    .from(schema.cases)
    .where(
      and(
        eq(schema.cases.id, sql.placeholder("id")),
        isNull(schema.cases.deletedAt),
      )
    )
    .limit(1)
    .prepare("get_case_by_id");

  const getCaseByRef = db
    .select()
    .from(schema.cases)
    .where(
      and(
        eq(schema.cases.ref, sql.placeholder("ref")),
        isNull(schema.cases.deletedAt),
      )
    )
    .limit(1)
    .prepare("get_case_by_ref");

  // ── User queries ───────────────────────────────────────────────────────────

  const getUserByOpenId = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.openId, sql.placeholder("openId")))
    .limit(1)
    .prepare("get_user_by_open_id");

  const getUserByEmail = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, sql.placeholder("email")))
    .limit(1)
    .prepare("get_user_by_email");

  // ── Tenant queries ─────────────────────────────────────────────────────────

  const getTenantById = db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, sql.placeholder("id")))
    .limit(1)
    .prepare("get_tenant_by_id");

  const getTenantBySlug = db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, sql.placeholder("slug")))
    .limit(1)
    .prepare("get_tenant_by_slug");

  return {
    // Investigations
    getInvestigationById,
    getInvestigationByRef,
    listInvestigationsByTenant,
    // KYC
    getKycById,
    getKycByNin,
    getKycByBvn,
    // Alerts
    getUnacknowledgedAlerts,
    // Cases
    getCaseById,
    getCaseByRef,
    // Users
    getUserByOpenId,
    getUserByEmail,
    // Tenants
    getTenantById,
    getTenantBySlug,
  };
}

export type PreparedStatements = ReturnType<typeof createPreparedStatements>;
