/**
 * Biometric Spoof-Attack Hourly Alert
 *
 * Runs every hour and:
 *   1. Queries the biometric_session_logs table for spoof attacks in the last 24 hours
 *   2. If any spoof-type count exceeds the configured threshold (default: 5 per type),
 *      sends a formatted alert via notifyOwner() and creates an in-app alert
 *   3. Deduplicates — only one alert per hour per spoof type
 *
 * The alert includes:
 *   - Total spoof attempts in the last 24 hours
 *   - Breakdown by attack type (deepfake, printed_photo, screen_replay, paper_mask, 3d_mask, high_quality_photo)
 *   - Pass/fail rate for the window
 *   - Threshold breach status per attack type
 *
 * Regulatory basis: ISO 30107-3 — Presentation Attack Detection (PAD) monitoring.
 */
import { getDb } from "./db";
import { biometricSessionLogs, alerts, platformSettings } from "../drizzle/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpoofAlertResult {
  ran: boolean;
  windowHours: number;
  totalSessions: number;
  totalSpoofAttacks: number;
  spoofBreakdown: Record<string, number>;
  thresholdBreached: boolean;
  breachedTypes: string[];
  alertsCreated: number;
  notified: boolean;
  slackNotified?: boolean;
  skippedReason?: string;
}

const SPOOF_TYPES = [
  "deepfake",
  "printed_photo",
  "screen_replay",
  "paper_mask",
  "three_d_mask",
  "high_quality_photo",
] as const;

const SPOOF_TYPE_LABELS: Record<string, string> = {
  deepfake: "Deepfake",
  printed_photo: "Printed Photo",
  screen_replay: "Screen Replay",
  paper_mask: "Paper Mask",
  "three_d_mask": "3D Mask",
  high_quality_photo: "High-Quality Photo",
};

// ─── Core alert logic ─────────────────────────────────────────────────────────

export async function runBiometricSpoofAlert(): Promise<SpoofAlertResult> {
  const db = await getDb();
  if (!db) {
    console.warn("[Biometric Spoof Alert] Database unavailable — skipping run.");
    return {
      ran: false,
      windowHours: 24,
      totalSessions: 0,
      totalSpoofAttacks: 0,
      spoofBreakdown: {},
      thresholdBreached: false,
      breachedTypes: [],
      alertsCreated: 0,
      notified: false,
      skippedReason: "DB unavailable",
    };
  }

  const now = new Date();
  const windowHours = 24;
  const since = new Date(now.getTime() - windowHours * 3_600_000);

  // ── Read threshold configuration from platform_settings ──────────────────
  const [thresholdRow] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, "biometric_spoof_alert_threshold"))
    .limit(1);

  const thresholdConfig = thresholdRow?.value as any;
  // Default: alert if any single spoof type exceeds 5 occurrences in 24h
  const perTypeThreshold = Number(thresholdConfig?.perTypeThreshold ?? 5);
  const notificationsEnabled = Boolean(thresholdConfig?.notificationsEnabled ?? true);

  if (!notificationsEnabled) {
    console.log("[Biometric Spoof Alert] Notifications disabled — skipping.");
    return {
      ran: false,
      windowHours,
      totalSessions: 0,
      totalSpoofAttacks: 0,
      spoofBreakdown: {},
      thresholdBreached: false,
      breachedTypes: [],
      alertsCreated: 0,
      notified: false,
      skippedReason: "Notifications disabled",
    };
  }

  // ── Aggregate spoof attacks in the window ─────────────────────────────────
  const [totals] = await db
    .select({
      totalSessions: sql<number>`COUNT(*)`,
      totalFailed: sql<number>`SUM(CASE WHEN ${biometricSessionLogs.overallVerified} = 0 THEN 1 ELSE 0 END)`,
    })
    .from(biometricSessionLogs)
    .where(gte(biometricSessionLogs.createdAt, since));

  const totalSessions = Number(totals?.totalSessions ?? 0);

  // Count each spoof type individually
  const spoofBreakdown: Record<string, number> = {};
  let totalSpoofAttacks = 0;

  for (const spoofType of SPOOF_TYPES) {
    const [row] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(biometricSessionLogs)
      .where(
        and(
          gte(biometricSessionLogs.createdAt, since),
          eq(biometricSessionLogs.antiSpoofType, spoofType),
          eq(biometricSessionLogs.overallVerified, false)
        )
      );
    const count = Number(row?.count ?? 0);
    if (count > 0) {
      spoofBreakdown[spoofType] = count;
      totalSpoofAttacks += count;
    }
  }

  // ── Determine which types exceeded threshold ──────────────────────────────
  const breachedTypes = Object.entries(spoofBreakdown)
    .filter(([, count]) => count >= perTypeThreshold)
    .map(([type]) => type);

  const thresholdBreached = breachedTypes.length > 0;

  if (!thresholdBreached && totalSpoofAttacks === 0) {
    console.log(
      `[Biometric Spoof Alert] No spoof attacks in last ${windowHours}h — skipping notification.`
    );
    return {
      ran: true,
      windowHours,
      totalSessions,
      totalSpoofAttacks: 0,
      spoofBreakdown,
      thresholdBreached: false,
      breachedTypes: [],
      alertsCreated: 0,
      notified: false,
    };
  }

  // ── Deduplicate — only one alert per hour ─────────────────────────────────
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);

  const recentAlert = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.sourceService, "biometric-spoof-alert"),
        gte(alerts.createdAt, hourStart)
      )
    )
    .limit(1);

  let alertsCreated = 0;
  if (recentAlert.length === 0 && (thresholdBreached || totalSpoofAttacks > 0)) {
    const severity = breachedTypes.includes("deepfake") ? "critical" : thresholdBreached ? "high" : "medium";
    const title = thresholdBreached
      ? `🚨 Spoof Attack Threshold Breached: ${breachedTypes.map(t => SPOOF_TYPE_LABELS[t] ?? t).join(", ")}`
      : `⚠️ Biometric Spoof Attacks Detected: ${totalSpoofAttacks} in last ${windowHours}h`;

    const bodyLines = Object.entries(spoofBreakdown).map(
      ([type, count]) =>
        `• ${SPOOF_TYPE_LABELS[type] ?? type}: ${count} attack${count !== 1 ? "s" : ""}${count >= perTypeThreshold ? " ⚠️ THRESHOLD EXCEEDED" : ""}`
    );

    await db.insert(alerts).values({
      title,
      body: bodyLines.join("\n"),
      type: "security" as any,
      severity: severity as any,
      subjectRef: "biometric-spoof-alert",
      sourceService: "biometric-spoof-alert",
      read: false,
      acknowledged: false,
      resolved: false,
      dismissed: false,
    });
    alertsCreated = 1;
  }

  // ── Send owner notification ───────────────────────────────────────────────
  let notified = false;
  if (thresholdBreached || totalSpoofAttacks > 0) {
    const dateStr = now.toLocaleString("en-NG", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Africa/Lagos",
    });

    const breakdownLines = Object.entries(spoofBreakdown)
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => {
        const label = SPOOF_TYPE_LABELS[type] ?? type;
        const exceeded = count >= perTypeThreshold;
        return `  • ${label}: ${count} attack${count !== 1 ? "s" : ""}${exceeded ? " ⚠️ THRESHOLD EXCEEDED" : ""}`;
      })
      .join("\n");

    const passRate =
      totalSessions > 0
        ? (((totalSessions - Number(totals?.totalFailed ?? 0)) / totalSessions) * 100).toFixed(1)
        : "N/A";

    const alertContent = `
Biometric Spoof-Attack Alert — ${dateStr}

Summary (last ${windowHours} hours):
  • Total biometric sessions:   ${totalSessions}
  • Overall pass rate:          ${passRate}%
  • Total spoof attacks:        ${totalSpoofAttacks}
  • Threshold (per type):       ${perTypeThreshold} attacks
  • Threshold breached:         ${thresholdBreached ? "YES 🚨" : "NO ✅"}

Attack Breakdown by Type:
${breakdownLines || "  (none detected)"}

${
  thresholdBreached
    ? `ACTION REQUIRED: The following attack type(s) exceeded the configured threshold of ${perTypeThreshold}:\n${breachedTypes.map(t => `  • ${SPOOF_TYPE_LABELS[t] ?? t}`).join("\n")}\n\nReview the Biometric Session Logs immediately for potential coordinated fraud.`
    : `NOTE: Spoof attacks detected but below threshold. Monitor closely.`
}

Log in to the BIS platform → Identity & KYC → Biometric Session Logs to review.
Regulatory basis: ISO 30107-3 — Presentation Attack Detection (PAD) monitoring.
    `.trim();

    notified = await notifyOwner({
      title: thresholdBreached
        ? `🚨 Biometric Spoof Alert: ${totalSpoofAttacks} attacks | ${breachedTypes.length} type(s) breached threshold`
        : `⚠️ Biometric Spoof Alert: ${totalSpoofAttacks} attacks detected`,
      content: alertContent,
    });
  }

  // ── Slack notification ────────────────────────────────────────────────────
  let slackNotified = false;
  if ((thresholdBreached || totalSpoofAttacks > 0) && ENV.slackWebhookUrl) {
    try {
      const color = thresholdBreached ? "#e53e3e" : "#dd6b20";
      const icon = thresholdBreached ? ":rotating_light:" : ":warning:";
      const breakdownFields = Object.entries(spoofBreakdown)
        .sort(([, a], [, b]) => b - a)
        .map(([type, count]) => ({
          title: SPOOF_TYPE_LABELS[type] ?? type,
          value: `${count} attack${count !== 1 ? "s" : ""}${count >= perTypeThreshold ? " ⚠️" : ""}`,
          short: true,
        }));
      const payload = {
        attachments: [
          {
            color,
            fallback: thresholdBreached
              ? `🚨 Biometric Spoof Alert: ${totalSpoofAttacks} attacks — threshold breached`
              : `⚠️ Biometric Spoof Alert: ${totalSpoofAttacks} attacks detected`,
            pretext: `${icon} *BIS Biometric Spoof-Attack Alert*`,
            title: thresholdBreached
              ? `Threshold Breached: ${breachedTypes.map(t => SPOOF_TYPE_LABELS[t] ?? t).join(", ")}`
              : `${totalSpoofAttacks} Spoof Attacks in Last ${windowHours}h`,
            fields: [
              { title: "Total Sessions", value: String(totalSessions), short: true },
              { title: "Spoof Attacks", value: String(totalSpoofAttacks), short: true },
              { title: "Threshold Breached", value: thresholdBreached ? "YES 🚨" : "NO ✅", short: true },
              { title: "Threshold (per type)", value: String(perTypeThreshold), short: true },
              ...breakdownFields,
            ],
            footer: "BIS Platform · ISO 30107-3 PAD Monitoring",
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      };
      const res = await fetch(ENV.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      slackNotified = res.ok;
      if (!res.ok) {
        console.warn(`[Biometric Spoof Alert] Slack webhook returned ${res.status}`);
      }
    } catch (err) {
      console.warn("[Biometric Spoof Alert] Slack notification failed:", err);
    }
  }

  console.log(
    `[Biometric Spoof Alert] total=${totalSessions} spoofAttacks=${totalSpoofAttacks} ` +
    `breached=${thresholdBreached} breachedTypes=${breachedTypes.join(",")} ` +
    `alertsCreated=${alertsCreated} notified=${notified} slackNotified=${slackNotified}`
  );

  return {
    ran: true,
    windowHours,
    totalSessions,
    totalSpoofAttacks,
    spoofBreakdown,
    thresholdBreached,
    breachedTypes,
    alertsCreated,
    notified,
    slackNotified,
  };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Schedules the biometric spoof-attack alert to run every hour at :00.
 * Uses a recursive setTimeout approach (same pattern as riskThresholdDigest.ts).
 */
export function startBiometricSpoofAlertScheduler(): void {
  function msUntilNextHour(): number {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.getTime() - now.getTime();
  }

  function scheduleNextRun(): void {
    const delay = msUntilNextHour();
    const nextRunAt = new Date(Date.now() + delay);
    console.log(
      `[Biometric Spoof Alert] Scheduled — next run at ${nextRunAt.toISOString()} ` +
      `(${Math.round(delay / 60_000)} min from now)`
    );
    setTimeout(async () => {
      try {
        await runBiometricSpoofAlert();
      } catch (err) {
        console.error("[Biometric Spoof Alert] Scheduled run failed:", err);
      }
      scheduleNextRun();
    }, delay);
  }

  // Run immediately on startup to catch any backlog, then schedule hourly
  runBiometricSpoofAlert().catch(err =>
    console.error("[Biometric Spoof Alert] Initial run failed:", err)
  );
  scheduleNextRun();
}
