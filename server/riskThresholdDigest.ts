/**
 * Risk Threshold Daily Email Digest
 *
 * Runs daily at 09:00 WAT (08:00 UTC) and:
 *   1. Reads the configured alert threshold from platform_settings
 *   2. Computes the 7-day average risk score from the investigations table
 *   3. If the average exceeds the threshold (or if there are critical entities),
 *      sends a formatted digest via notifyOwner() and creates an in-app alert
 *   4. Deduplicates — only one digest alert per day
 *
 * The digest includes:
 *   - 7-day average risk score vs. configured threshold
 *   - Count of critical (≥80), high (60-79), medium (40-59), low (<40) entities
 *   - Top 10 highest-risk investigation subjects
 *   - Threshold breach status
 *
 * Regulatory basis: FATF Recommendation 20 — ongoing monitoring of business relationships.
 */
import { getDb } from "./db";
import { investigations, alerts, platformSettings } from "../drizzle/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskThresholdDigestResult {
  ran: boolean;
  avgScore: number;
  threshold: number;
  exceeded: boolean;
  criticalCount: number;
  highCount: number;
  totalInWindow: number;
  alertsCreated: number;
  notified: boolean;
  skippedReason?: string;
}

// ─── Core digest logic ────────────────────────────────────────────────────────

export async function runRiskThresholdDigest(): Promise<RiskThresholdDigestResult> {
  const db = await getDb();
  if (!db) {
    console.warn("[Risk Threshold Digest] Database unavailable — skipping run.");
    return {
      ran: false, avgScore: 0, threshold: 70, exceeded: false,
      criticalCount: 0, highCount: 0, totalInWindow: 0,
      alertsCreated: 0, notified: false,
      skippedReason: "DB unavailable",
    };
  }

  const now = new Date();
  const windowDays = 7;
  const since = new Date(now.getTime() - windowDays * 24 * 3_600_000);

  // ── Read threshold configuration ─────────────────────────────────────────
  const [thresholdRow] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, "risk_alert_threshold"))
    .limit(1);
  const thresholdConfig = thresholdRow?.value as any;
  const threshold = Number(thresholdConfig?.threshold ?? 70);
  const notificationsEnabled = Boolean(thresholdConfig?.notificationsEnabled ?? true);

  if (!notificationsEnabled) {
    console.log("[Risk Threshold Digest] Notifications disabled — skipping.");
    return {
      ran: false, avgScore: 0, threshold, exceeded: false,
      criticalCount: 0, highCount: 0, totalInWindow: 0,
      alertsCreated: 0, notified: false,
      skippedReason: "Notifications disabled",
    };
  }

  // ── Compute 7-day risk statistics ─────────────────────────────────────────
  const [stats] = await db
    .select({
      avgScore: sql<number>`AVG(${investigations.riskScore})`,
      totalCount: sql<number>`COUNT(*)`,
      criticalCount: sql<number>`SUM(CASE WHEN ${investigations.riskScore} >= 80 THEN 1 ELSE 0 END)`,
      highCount: sql<number>`SUM(CASE WHEN ${investigations.riskScore} >= 60 AND ${investigations.riskScore} < 80 THEN 1 ELSE 0 END)`,
      mediumCount: sql<number>`SUM(CASE WHEN ${investigations.riskScore} >= 40 AND ${investigations.riskScore} < 60 THEN 1 ELSE 0 END)`,
      lowCount: sql<number>`SUM(CASE WHEN ${investigations.riskScore} < 40 THEN 1 ELSE 0 END)`,
    })
    .from(investigations)
    .where(gte(investigations.createdAt, since));

  const avgScore = Math.round(Number(stats?.avgScore ?? 0));
  const totalInWindow = Number(stats?.totalCount ?? 0);
  const criticalCount = Number(stats?.criticalCount ?? 0);
  const highCount = Number(stats?.highCount ?? 0);
  const mediumCount = Number(stats?.mediumCount ?? 0);
  const lowCount = Number(stats?.lowCount ?? 0);
  const exceeded = avgScore >= threshold && totalInWindow > 0;

  // ── Top 10 highest-risk investigations ───────────────────────────────────
  const topRisk = await db
    .select({
      subjectName: investigations.subjectName,
      subjectType: investigations.subjectType,
      riskScore: investigations.riskScore,
      status: investigations.status,
      ref: investigations.ref,
      country: investigations.country,
    })
    .from(investigations)
    .where(gte(investigations.createdAt, since))
    .orderBy(desc(investigations.riskScore))
    .limit(10);

  // ── Deduplicate — only one digest per day ─────────────────────────────────
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const recentAlert = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.sourceService, "risk-threshold-digest"),
        gte(alerts.createdAt, todayStart)
      )
    )
    .limit(1);

  let alertsCreated = 0;
  if (recentAlert.length === 0 && (exceeded || criticalCount > 0)) {
    const severity = criticalCount > 0 ? "critical" : exceeded ? "high" : "medium";
    const title = exceeded
      ? `⚠️ Risk Threshold Breached: 7-day avg ${avgScore} exceeds threshold ${threshold}`
      : `🔴 Critical Risk Entities: ${criticalCount} investigation(s) at critical risk`;

    const bodyLines = topRisk.slice(0, 5).map(r =>
      `• ${r.subjectName} (${r.ref ?? "—"}) — Score: ${r.riskScore ?? 0} | ${r.status}`
    );
    if (topRisk.length > 5) bodyLines.push(`… and ${topRisk.length - 5} more`);

    await db.insert(alerts).values({
      title,
      body: bodyLines.join("\n"),
      type: "risk_threshold" as any,
      severity: severity as any,
      subjectRef: "risk-threshold-digest",
      sourceService: "risk-threshold-digest",
      read: false,
      acknowledged: false,
      resolved: false,
      dismissed: false,
    });
    alertsCreated = 1;
  }

  // ── Send owner notification digest ────────────────────────────────────────
  let notified = false;
  if (exceeded || criticalCount > 0) {
    const dateStr = now.toLocaleDateString("en-NG", { dateStyle: "full" });
    const topRiskRows = topRisk.map((r, i) => {
      const scoreLabel =
        (r.riskScore ?? 0) >= 80 ? "CRITICAL 🔴" :
        (r.riskScore ?? 0) >= 60 ? "HIGH 🟠" :
        (r.riskScore ?? 0) >= 40 ? "MEDIUM 🟡" : "LOW 🟢";
      return `  ${i + 1}. ${r.subjectName} (${r.ref ?? "—"}) | ${scoreLabel} (${r.riskScore ?? 0}) | ${r.status} | ${r.country ?? "Unknown"}`;
    }).join("\n");

    const digestContent = `
Risk Threshold Daily Digest — ${dateStr}

Summary (last ${windowDays} days):
  • 7-day average risk score:  ${avgScore} / 100
  • Configured threshold:      ${threshold}
  • Threshold exceeded:        ${exceeded ? "YES ⚠️" : "NO ✅"}
  • Total investigations:      ${totalInWindow}
  • Critical (≥80):            ${criticalCount}
  • High (60-79):              ${highCount}
  • Medium (40-59):            ${mediumCount}
  • Low (<40):                 ${lowCount}

Top ${topRisk.length} Highest-Risk Entities:
${topRiskRows || "  (none in window)"}

${exceeded
  ? `ACTION REQUIRED: The 7-day average risk score (${avgScore}) has exceeded the configured threshold (${threshold}). Review and escalate high-risk investigations immediately.`
  : `NOTE: Threshold not breached, but ${criticalCount} critical-risk investigation(s) require attention.`
}

Log in to the BIS platform → Dashboard → Risk Trend to review.
Regulatory basis: FATF Recommendation 20 — ongoing monitoring.
    `.trim();

    notified = await notifyOwner({
      title: `Risk Threshold Digest: avg ${avgScore}${exceeded ? " ⚠️ EXCEEDED" : ""} | ${criticalCount} critical`,
      content: digestContent,
    });
  }

  console.log(
    `[Risk Threshold Digest] avg=${avgScore} threshold=${threshold} exceeded=${exceeded} ` +
    `critical=${criticalCount} high=${highCount} total=${totalInWindow} ` +
    `alertsCreated=${alertsCreated} notified=${notified}`
  );

  return {
    ran: true,
    avgScore,
    threshold,
    exceeded,
    criticalCount,
    highCount,
    totalInWindow,
    alertsCreated,
    notified,
  };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Schedules the risk threshold digest to run daily at 09:00 WAT (08:00 UTC).
 * Uses a recursive setTimeout approach (same pattern as kycExpiryDigest.ts).
 */
export function startRiskThresholdDigestScheduler(): void {
  function msUntilNextRun(): number {
    const now = new Date();
    const target = new Date(now);
    // 08:00 UTC = 09:00 WAT
    target.setUTCHours(8, 0, 0, 0);
    if (target <= now) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    return target.getTime() - now.getTime();
  }

  function scheduleNextRun(): void {
    const delay = msUntilNextRun();
    const nextRunAt = new Date(Date.now() + delay);
    console.log(
      `[Risk Threshold Digest] Scheduled — next run at ${nextRunAt.toISOString()} ` +
      `(${Math.round(delay / 60_000)} min from now)`
    );
    setTimeout(async () => {
      try {
        await runRiskThresholdDigest();
      } catch (err) {
        console.error("[Risk Threshold Digest] Scheduled run failed:", err);
      }
      scheduleNextRun();
    }, delay);
  }

  scheduleNextRun();
}
