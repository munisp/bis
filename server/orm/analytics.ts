/**
 * server/orm/analytics.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * BIS Analytics Query Layer
 *
 * Provides:
 *  1. Materialized view SQL definitions (dashboard stats, investigation funnel)
 *  2. refreshMaterializedViews()  — refresh all views on a schedule
 *  3. getDashboardStats()         — fast dashboard metrics from materialized views
 *  4. getInvestigationFunnel()    — investigation stage conversion funnel
 *  5. getAmlTrends()              — AML alert trends over time
 *  6. getKycComplianceRate()      — KYC pass/fail rates by period
 *  7. getScreeningThroughput()    — screening volume and turnaround metrics
 *  8. getTenantUsageMetrics()     — per-tenant usage for billing
 */

import { sql, eq, and, gte, lte, count, sum, avg } from "drizzle-orm";
import type { BisDb } from "./index";
import * as schema from "../../drizzle/schema";

// ─── Materialized View SQL Definitions ───────────────────────────────────────

/**
 * Returns the SQL to create all BIS materialized views.
 * Run once during database setup, then refresh on schedule.
 */
export function getMaterializedViewSql(): string[] {
  return [
    // ── Dashboard stats per tenant ──────────────────────────────────────────
    `
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_stats AS
    SELECT
      i."tenantId",
      COUNT(DISTINCT i.id)                                                  AS total_investigations,
      COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'pending')             AS pending_investigations,
      COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'in_progress')         AS active_investigations,
      COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'completed')           AS completed_investigations,
      COUNT(DISTINCT i.id) FILTER (WHERE i."riskScore" >= 75)              AS high_risk_investigations,
      COUNT(DISTINCT i.id) FILTER (WHERE i."deletedAt" IS NULL
        AND i."createdAt" >= NOW() - INTERVAL '30 days')                   AS investigations_last_30d,
      ROUND(AVG(i."riskScore") FILTER (WHERE i."riskScore" IS NOT NULL))   AS avg_risk_score,
      COUNT(DISTINCT a.id) FILTER (WHERE a.acknowledged = false
        AND a.dismissed = false)                                            AS unacknowledged_alerts,
      COUNT(DISTINCT a.id) FILTER (WHERE a.severity = 'critical'
        AND a.acknowledged = false)                                         AS critical_alerts,
      COUNT(DISTINCT k.id) FILTER (WHERE k.status = 'pending')             AS pending_kyc,
      COUNT(DISTINCT k.id) FILTER (WHERE k.status = 'approved')            AS approved_kyc,
      COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'open')                AS open_cases,
      COUNT(DISTINCT so.id) FILTER (WHERE so.status = 'pending')           AS pending_screenings,
      COUNT(DISTINCT aa.id) FILTER (WHERE aa.status = 'open')              AS open_aml_alerts,
      NOW()                                                                  AS refreshed_at
    FROM investigations i
    LEFT JOIN alerts a
      ON a."tenantId" = i."tenantId" AND a."deletedAt" IS NULL
    LEFT JOIN kyc_records k
      ON k."tenantId" = i."tenantId" AND k."deletedAt" IS NULL
    LEFT JOIN cases c
      ON c."tenantId" = i."tenantId" AND c."deletedAt" IS NULL
    LEFT JOIN screening_orders so
      ON so."tenantId" = i."tenantId" AND so."deletedAt" IS NULL
    LEFT JOIN aml_alerts aa
      ON aa."tenantId" = i."tenantId" AND aa."deletedAt" IS NULL
    WHERE i."deletedAt" IS NULL
    GROUP BY i."tenantId";
    `,

    // ── Index on materialized view ──────────────────────────────────────────
    `CREATE UNIQUE INDEX IF NOT EXISTS mv_dashboard_stats_tenant_idx
     ON mv_dashboard_stats ("tenantId");`,

    // ── Investigation funnel (status transitions) ───────────────────────────
    `
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_investigation_funnel AS
    SELECT
      "tenantId",
      DATE_TRUNC('week', "createdAt")                                       AS week,
      COUNT(*) FILTER (WHERE status = 'pending')                            AS pending,
      COUNT(*) FILTER (WHERE status = 'in_progress')                        AS in_progress,
      COUNT(*) FILTER (WHERE status = 'under_review')                       AS under_review,
      COUNT(*) FILTER (WHERE status = 'completed')                          AS completed,
      COUNT(*) FILTER (WHERE status = 'cancelled')                          AS cancelled,
      COUNT(*) FILTER (WHERE status = 'escalated')                          AS escalated,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (COALESCE("completedAt", NOW()) - "createdAt")) / 3600
      ))                                                                     AS avg_completion_hours,
      NOW()                                                                  AS refreshed_at
    FROM investigations
    WHERE "deletedAt" IS NULL
      AND "createdAt" >= NOW() - INTERVAL '12 months'
    GROUP BY "tenantId", DATE_TRUNC('week', "createdAt");
    `,

    `CREATE INDEX IF NOT EXISTS mv_investigation_funnel_tenant_week_idx
     ON mv_investigation_funnel ("tenantId", week DESC);`,

    // ── AML alert trends ────────────────────────────────────────────────────
    `
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_aml_trends AS
    SELECT
      "tenantId",
      DATE_TRUNC('day', "createdAt")                                        AS day,
      COUNT(*)                                                               AS total_alerts,
      COUNT(*) FILTER (WHERE severity = 'critical')                         AS critical_alerts,
      COUNT(*) FILTER (WHERE severity = 'high')                             AS high_alerts,
      COUNT(*) FILTER (WHERE status = 'open')                               AS open_alerts,
      COUNT(*) FILTER (WHERE status = 'resolved')                           AS resolved_alerts,
      COUNT(*) FILTER (WHERE "autoSarFiled" = true)                         AS auto_sar_filed,
      NOW()                                                                  AS refreshed_at
    FROM aml_alerts
    WHERE "deletedAt" IS NULL
      AND "createdAt" >= NOW() - INTERVAL '90 days'
    GROUP BY "tenantId", DATE_TRUNC('day', "createdAt");
    `,

    `CREATE INDEX IF NOT EXISTS mv_aml_trends_tenant_day_idx
     ON mv_aml_trends ("tenantId", day DESC);`,

    // ── KYC compliance rate ─────────────────────────────────────────────────
    `
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_kyc_compliance AS
    SELECT
      "tenantId",
      DATE_TRUNC('month', "createdAt")                                      AS month,
      COUNT(*)                                                               AS total_kyc,
      COUNT(*) FILTER (WHERE status = 'approved')                           AS approved,
      COUNT(*) FILTER (WHERE status = 'rejected')                           AS rejected,
      COUNT(*) FILTER (WHERE status = 'pending')                            AS pending,
      COUNT(*) FILTER (WHERE status = 'expired')                            AS expired,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = 'approved') / NULLIF(COUNT(*), 0), 2
      )                                                                      AS approval_rate_pct,
      ROUND(AVG("riskScore") FILTER (WHERE "riskScore" IS NOT NULL))        AS avg_risk_score,
      NOW()                                                                  AS refreshed_at
    FROM kyc_records
    WHERE "deletedAt" IS NULL
      AND "createdAt" >= NOW() - INTERVAL '12 months'
    GROUP BY "tenantId", DATE_TRUNC('month', "createdAt");
    `,

    `CREATE INDEX IF NOT EXISTS mv_kyc_compliance_tenant_month_idx
     ON mv_kyc_compliance ("tenantId", month DESC);`,

    // ── Screening throughput ────────────────────────────────────────────────
    `
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_screening_throughput AS
    SELECT
      so."tenantId",
      DATE_TRUNC('week', so."createdAt")                                    AS week,
      COUNT(*)                                                               AS total_orders,
      COUNT(*) FILTER (WHERE so.status = 'completed')                       AS completed,
      COUNT(*) FILTER (WHERE so.status = 'pending')                         AS pending,
      COUNT(*) FILTER (WHERE so.status = 'failed')                          AS failed,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (so."completedAt" - so."createdAt")) / 3600
      ) FILTER (WHERE so."completedAt" IS NOT NULL))                        AS avg_turnaround_hours,
      COUNT(*) FILTER (WHERE so."adverseActionInitiated" = true)            AS adverse_actions,
      NOW()                                                                  AS refreshed_at
    FROM screening_orders so
    WHERE so."deletedAt" IS NULL
      AND so."createdAt" >= NOW() - INTERVAL '12 months'
    GROUP BY so."tenantId", DATE_TRUNC('week', so."createdAt");
    `,

    `CREATE INDEX IF NOT EXISTS mv_screening_throughput_tenant_week_idx
     ON mv_screening_throughput ("tenantId", week DESC);`,

    // ── Tenant usage metrics (for billing) ──────────────────────────────────
    `
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_tenant_usage AS
    SELECT
      t.id                                                                   AS "tenantId",
      t.name                                                                 AS tenant_name,
      t.plan,
      COUNT(DISTINCT i.id)                                                   AS total_investigations,
      COUNT(DISTINCT k.id)                                                   AS total_kyc_records,
      COUNT(DISTINCT so.id)                                                  AS total_screenings,
      COUNT(DISTINCT c.id)                                                   AS total_cases,
      COUNT(DISTINCT aa.id)                                                  AS total_aml_alerts,
      COUNT(DISTINCT sf.id)                                                  AS total_sar_filings,
      COUNT(DISTINCT u.id)                                                   AS total_users,
      COALESCE(SUM(tx.amount) FILTER (WHERE tx.type = 'debit'), 0)          AS total_spend_ngn,
      t."creditBalance"                                                      AS credit_balance,
      NOW()                                                                  AS refreshed_at
    FROM tenants t
    LEFT JOIN investigations i ON i."tenantId" = t.id AND i."deletedAt" IS NULL
    LEFT JOIN kyc_records k ON k."tenantId" = t.id AND k."deletedAt" IS NULL
    LEFT JOIN screening_orders so ON so."tenantId" = t.id AND so."deletedAt" IS NULL
    LEFT JOIN cases c ON c."tenantId" = t.id AND c."deletedAt" IS NULL
    LEFT JOIN aml_alerts aa ON aa."tenantId" = t.id AND aa."deletedAt" IS NULL
    LEFT JOIN sar_filings sf ON sf."tenantId" = t.id AND sf."deletedAt" IS NULL
    LEFT JOIN users u ON u."tenantId" = t.id
    LEFT JOIN transactions tx ON tx."tenantId" = t.id AND tx."deletedAt" IS NULL
    WHERE t.status = 'active'
    GROUP BY t.id, t.name, t.plan, t."creditBalance";
    `,

    `CREATE UNIQUE INDEX IF NOT EXISTS mv_tenant_usage_tenant_idx
     ON mv_tenant_usage ("tenantId");`,
  ];
}

/**
 * Returns the SQL to drop all materialized views (for rollback).
 */
export function getDropMaterializedViewSql(): string[] {
  return [
    `DROP MATERIALIZED VIEW IF EXISTS mv_tenant_usage;`,
    `DROP MATERIALIZED VIEW IF EXISTS mv_screening_throughput;`,
    `DROP MATERIALIZED VIEW IF EXISTS mv_kyc_compliance;`,
    `DROP MATERIALIZED VIEW IF EXISTS mv_aml_trends;`,
    `DROP MATERIALIZED VIEW IF EXISTS mv_investigation_funnel;`,
    `DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_stats;`,
  ];
}

// ─── Refresh Functions ────────────────────────────────────────────────────────

/**
 * Refreshes all materialized views concurrently.
 * Safe to call while the database is under load — CONCURRENTLY does not lock reads.
 */
export async function refreshMaterializedViews(db: BisDb): Promise<{
  success: boolean;
  refreshedAt: Date;
  durationMs: number;
}> {
  const start = Date.now();
  try {
    // Refresh concurrently (requires unique index on each view)
    await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_stats`));
    await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_investigation_funnel`));
    await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_aml_trends`));
    await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_kyc_compliance`));
    await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_screening_throughput`));
    await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_tenant_usage`));
    return { success: true, refreshedAt: new Date(), durationMs: Date.now() - start };
  } catch (err) {
    console.error("[Analytics] Failed to refresh materialized views:", err);
    return { success: false, refreshedAt: new Date(), durationMs: Date.now() - start };
  }
}

// ─── Analytics Query Functions ────────────────────────────────────────────────

/**
 * Returns dashboard statistics for a tenant from the materialized view.
 * Falls back to a live query if the view is not available.
 */
export async function getDashboardStats(db: BisDb, tenantId: number): Promise<{
  totalInvestigations: number;
  pendingInvestigations: number;
  activeInvestigations: number;
  completedInvestigations: number;
  highRiskInvestigations: number;
  investigationsLast30d: number;
  avgRiskScore: number | null;
  unacknowledgedAlerts: number;
  criticalAlerts: number;
  pendingKyc: number;
  approvedKyc: number;
  openCases: number;
  pendingScreenings: number;
  openAmlAlerts: number;
  refreshedAt: Date | null;
  source: "materialized_view" | "live_query";
}> {
  try {
    // Try materialized view first (fast path)
    const rows = await db.execute(
      sql.raw(`SELECT * FROM mv_dashboard_stats WHERE "tenantId" = ${tenantId} LIMIT 1`)
    ) as unknown as { rows: Record<string, unknown>[] };

    if (rows.rows && rows.rows.length > 0) {
      const r = rows.rows[0];
      return {
        totalInvestigations: Number(r.total_investigations ?? 0),
        pendingInvestigations: Number(r.pending_investigations ?? 0),
        activeInvestigations: Number(r.active_investigations ?? 0),
        completedInvestigations: Number(r.completed_investigations ?? 0),
        highRiskInvestigations: Number(r.high_risk_investigations ?? 0),
        investigationsLast30d: Number(r.investigations_last_30d ?? 0),
        avgRiskScore: r.avg_risk_score != null ? Number(r.avg_risk_score) : null,
        unacknowledgedAlerts: Number(r.unacknowledged_alerts ?? 0),
        criticalAlerts: Number(r.critical_alerts ?? 0),
        pendingKyc: Number(r.pending_kyc ?? 0),
        approvedKyc: Number(r.approved_kyc ?? 0),
        openCases: Number(r.open_cases ?? 0),
        pendingScreenings: Number(r.pending_screenings ?? 0),
        openAmlAlerts: Number(r.open_aml_alerts ?? 0),
        refreshedAt: r.refreshed_at ? new Date(r.refreshed_at as string) : null,
        source: "materialized_view",
      };
    }
  } catch {
    // View not yet created — fall through to live query
  }

  // Live query fallback
  const [invStats] = await db
    .select({
      total: count(),
      pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
      active: sql<number>`COUNT(*) FILTER (WHERE status = 'in_progress')`,
      completed: sql<number>`COUNT(*) FILTER (WHERE status = 'completed')`,
      highRisk: sql<number>`COUNT(*) FILTER (WHERE "riskScore" >= 75)`,
      last30d: sql<number>`COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days')`,
      avgRisk: avg(schema.investigations.riskScore),
    })
    .from(schema.investigations)
    .where(and(
      eq(schema.investigations.tenantId, tenantId),
      sql`"deletedAt" IS NULL`,
    ));

  const [alertStats] = await db
    .select({
      unacknowledged: sql<number>`COUNT(*) FILTER (WHERE acknowledged = false AND dismissed = false)`,
      critical: sql<number>`COUNT(*) FILTER (WHERE severity = 'critical' AND acknowledged = false)`,
    })
    .from(schema.alerts)
    .where(eq(schema.alerts.tenantId, tenantId));

  const [kycStats] = await db
    .select({
      pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
      approved: sql<number>`COUNT(*) FILTER (WHERE status = 'approved')`,
    })
    .from(schema.kycRecords)
    .where(eq(schema.kycRecords.tenantId, tenantId));

  const [caseStats] = await db
    .select({
      open: sql<number>`COUNT(*) FILTER (WHERE status = 'open')`,
    })
    .from(schema.cases)
    .where(eq(schema.cases.tenantId, tenantId));

  return {
    totalInvestigations: Number(invStats?.total ?? 0),
    pendingInvestigations: Number(invStats?.pending ?? 0),
    activeInvestigations: Number(invStats?.active ?? 0),
    completedInvestigations: Number(invStats?.completed ?? 0),
    highRiskInvestigations: Number(invStats?.highRisk ?? 0),
    investigationsLast30d: Number(invStats?.last30d ?? 0),
    avgRiskScore: invStats?.avgRisk != null ? Number(invStats.avgRisk) : null,
    unacknowledgedAlerts: Number(alertStats?.unacknowledged ?? 0),
    criticalAlerts: Number(alertStats?.critical ?? 0),
    pendingKyc: Number(kycStats?.pending ?? 0),
    approvedKyc: Number(kycStats?.approved ?? 0),
    openCases: Number(caseStats?.open ?? 0),
    pendingScreenings: 0,
    openAmlAlerts: 0,
    refreshedAt: null,
    source: "live_query",
  };
}

/**
 * Returns investigation funnel data for a tenant over the last N weeks.
 */
export async function getInvestigationFunnel(
  db: BisDb,
  tenantId: number,
  weeks = 12,
): Promise<Array<{
  week: Date;
  pending: number;
  inProgress: number;
  underReview: number;
  completed: number;
  cancelled: number;
  escalated: number;
  avgCompletionHours: number | null;
}>> {
  try {
    const rows = await db.execute(
      sql.raw(`
        SELECT * FROM mv_investigation_funnel
        WHERE "tenantId" = ${tenantId}
          AND week >= NOW() - INTERVAL '${weeks} weeks'
        ORDER BY week DESC
      `)
    ) as unknown as { rows: Record<string, unknown>[] };

    return (rows.rows ?? []).map((r) => ({
      week: new Date(r.week as string),
      pending: Number(r.pending ?? 0),
      inProgress: Number(r.in_progress ?? 0),
      underReview: Number(r.under_review ?? 0),
      completed: Number(r.completed ?? 0),
      cancelled: Number(r.cancelled ?? 0),
      escalated: Number(r.escalated ?? 0),
      avgCompletionHours: r.avg_completion_hours != null ? Number(r.avg_completion_hours) : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Returns AML alert trend data for a tenant over the last N days.
 */
export async function getAmlTrends(
  db: BisDb,
  tenantId: number,
  days = 30,
): Promise<Array<{
  day: Date;
  totalAlerts: number;
  criticalAlerts: number;
  highAlerts: number;
  openAlerts: number;
  resolvedAlerts: number;
  autoSarFiled: number;
}>> {
  try {
    const rows = await db.execute(
      sql.raw(`
        SELECT * FROM mv_aml_trends
        WHERE "tenantId" = ${tenantId}
          AND day >= NOW() - INTERVAL '${days} days'
        ORDER BY day DESC
      `)
    ) as unknown as { rows: Record<string, unknown>[] };

    return (rows.rows ?? []).map((r) => ({
      day: new Date(r.day as string),
      totalAlerts: Number(r.total_alerts ?? 0),
      criticalAlerts: Number(r.critical_alerts ?? 0),
      highAlerts: Number(r.high_alerts ?? 0),
      openAlerts: Number(r.open_alerts ?? 0),
      resolvedAlerts: Number(r.resolved_alerts ?? 0),
      autoSarFiled: Number(r.auto_sar_filed ?? 0),
    }));
  } catch {
    return [];
  }
}

/**
 * Returns KYC compliance rate data for a tenant over the last N months.
 */
export async function getKycComplianceRate(
  db: BisDb,
  tenantId: number,
  months = 12,
): Promise<Array<{
  month: Date;
  totalKyc: number;
  approved: number;
  rejected: number;
  pending: number;
  expired: number;
  approvalRatePct: number | null;
  avgRiskScore: number | null;
}>> {
  try {
    const rows = await db.execute(
      sql.raw(`
        SELECT * FROM mv_kyc_compliance
        WHERE "tenantId" = ${tenantId}
          AND month >= NOW() - INTERVAL '${months} months'
        ORDER BY month DESC
      `)
    ) as unknown as { rows: Record<string, unknown>[] };

    return (rows.rows ?? []).map((r) => ({
      month: new Date(r.month as string),
      totalKyc: Number(r.total_kyc ?? 0),
      approved: Number(r.approved ?? 0),
      rejected: Number(r.rejected ?? 0),
      pending: Number(r.pending ?? 0),
      expired: Number(r.expired ?? 0),
      approvalRatePct: r.approval_rate_pct != null ? Number(r.approval_rate_pct) : null,
      avgRiskScore: r.avg_risk_score != null ? Number(r.avg_risk_score) : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Returns screening throughput metrics for a tenant.
 */
export async function getScreeningThroughput(
  db: BisDb,
  tenantId: number,
  weeks = 12,
): Promise<Array<{
  week: Date;
  totalOrders: number;
  completed: number;
  pending: number;
  failed: number;
  avgTurnaroundHours: number | null;
  adverseActions: number;
}>> {
  try {
    const rows = await db.execute(
      sql.raw(`
        SELECT * FROM mv_screening_throughput
        WHERE "tenantId" = ${tenantId}
          AND week >= NOW() - INTERVAL '${weeks} weeks'
        ORDER BY week DESC
      `)
    ) as unknown as { rows: Record<string, unknown>[] };

    return (rows.rows ?? []).map((r) => ({
      week: new Date(r.week as string),
      totalOrders: Number(r.total_orders ?? 0),
      completed: Number(r.completed ?? 0),
      pending: Number(r.pending ?? 0),
      failed: Number(r.failed ?? 0),
      avgTurnaroundHours: r.avg_turnaround_hours != null ? Number(r.avg_turnaround_hours) : null,
      adverseActions: Number(r.adverse_actions ?? 0),
    }));
  } catch {
    return [];
  }
}

/**
 * Returns per-tenant usage metrics for platform billing and monitoring.
 * Only accessible to platform admins.
 */
export async function getTenantUsageMetrics(db: BisDb): Promise<Array<{
  tenantId: number;
  tenantName: string;
  plan: string;
  totalInvestigations: number;
  totalKycRecords: number;
  totalScreenings: number;
  totalCases: number;
  totalAmlAlerts: number;
  totalSarFilings: number;
  totalUsers: number;
  totalSpendNgn: number;
  creditBalance: number;
  refreshedAt: Date | null;
}>> {
  try {
    const rows = await db.execute(
      sql.raw(`SELECT * FROM mv_tenant_usage ORDER BY total_investigations DESC`)
    ) as unknown as { rows: Record<string, unknown>[] };

    return (rows.rows ?? []).map((r) => ({
      tenantId: Number(r.tenantId),
      tenantName: String(r.tenant_name ?? ""),
      plan: String(r.plan ?? ""),
      totalInvestigations: Number(r.total_investigations ?? 0),
      totalKycRecords: Number(r.total_kyc_records ?? 0),
      totalScreenings: Number(r.total_screenings ?? 0),
      totalCases: Number(r.total_cases ?? 0),
      totalAmlAlerts: Number(r.total_aml_alerts ?? 0),
      totalSarFilings: Number(r.total_sar_filings ?? 0),
      totalUsers: Number(r.total_users ?? 0),
      totalSpendNgn: Number(r.total_spend_ngn ?? 0),
      creditBalance: Number(r.credit_balance ?? 0),
      refreshedAt: r.refreshed_at ? new Date(r.refreshed_at as string) : null,
    }));
  } catch {
    return [];
  }
}
