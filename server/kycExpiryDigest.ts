/**
 * KYC Expiry Daily Email Digest
 *
 * Runs daily at 08:00 WAT (07:00 UTC) and sends an email digest to the
 * compliance officer listing all KYC records that are "stale" — i.e., not
 * re-verified within the CBN-mandated renewal period:
 *   • High-risk customers: 12 months
 *   • Low/medium-risk customers: 36 months
 *
 * Since the kycRecords table does not have an explicit expiresAt column,
 * staleness is computed from updatedAt:
 *   stale = updatedAt < (now - renewalPeriod) AND status NOT IN ('rejected')
 *
 * Regulatory basis: CBN KYC Manual 2023.
 *
 * Delivery:
 *   1. Creates an alert in the DB for in-app notification
 *   2. Calls notifyOwner() to send the digest via the Manus notification API
 *   3. Sends Expo push notifications to all users with registered push tokens
 */
import { getDb } from "./db";
import { kycRecords, users, alerts } from "../drizzle/schema";
import { and, lte, ne, sql, gte, eq } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KycExpiryDigestResult {
  checked: number;
  staleHighRisk: number;
  staleLowRisk: number;
  alertsCreated: number;
  notified: boolean;
}

// ─── Core digest logic ────────────────────────────────────────────────────────

export async function runKycExpiryDigest(): Promise<KycExpiryDigestResult> {
  const db = await getDb();
  if (!db) {
    console.warn("[KYC Expiry Digest] Database unavailable — skipping run.");
    return { checked: 0, staleHighRisk: 0, staleLowRisk: 0, alertsCreated: 0, notified: false };
  }

  const now = new Date();
  // High-risk: stale after 12 months
  const highRiskCutoff = new Date(now.getTime() - 365 * 24 * 3_600_000);
  // Low/medium-risk: stale after 36 months
  const lowRiskCutoff = new Date(now.getTime() - 3 * 365 * 24 * 3_600_000);

  // Records where riskScore >= 70 (high-risk) and not updated in 12 months
  const staleHighRiskRecords = await db
    .select({
      id: kycRecords.id,
      subjectName: kycRecords.subjectName,
      subjectRef: kycRecords.subjectRef,
      riskScore: kycRecords.riskScore,
      status: kycRecords.status,
      updatedAt: kycRecords.updatedAt,
    })
    .from(kycRecords)
    .where(
      and(
        lte(kycRecords.updatedAt, highRiskCutoff),
        ne(kycRecords.status, "failed" as any),
        sql`${kycRecords.riskScore} >= 70`
      )
    )
    .orderBy(kycRecords.updatedAt)
    .limit(50);

  // Records where riskScore < 70 (low/medium-risk) and not updated in 36 months
  const staleLowRiskRecords = await db
    .select({
      id: kycRecords.id,
      subjectName: kycRecords.subjectName,
      subjectRef: kycRecords.subjectRef,
      riskScore: kycRecords.riskScore,
      status: kycRecords.status,
      updatedAt: kycRecords.updatedAt,
    })
    .from(kycRecords)
    .where(
      and(
        lte(kycRecords.updatedAt, lowRiskCutoff),
        ne(kycRecords.status, "failed" as any),
        sql`(${kycRecords.riskScore} IS NULL OR ${kycRecords.riskScore} < 70)`
      )
    )
    .orderBy(kycRecords.updatedAt)
    .limit(50);

  const allStale = [...staleHighRiskRecords, ...staleLowRiskRecords];

  if (allStale.length === 0) {
    console.log("[KYC Expiry Digest] No stale KYC records found.");
    return { checked: 0, staleHighRisk: 0, staleLowRisk: 0, alertsCreated: 0, notified: false };
  }

  // ── Create in-app alert ───────────────────────────────────────────────────

  // Guard: don't create duplicate alerts within the same day
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const recentAlert = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.sourceService, "kyc-expiry-digest"),
        gte(alerts.createdAt, todayStart)
      )
    )
    .limit(1);

  let alertsCreated = 0;
  if (recentAlert.length === 0) {
    const urgentCount = staleHighRiskRecords.length;
    const title = urgentCount > 0
      ? `🔴 KYC Re-verification Required: ${urgentCount} high-risk record(s) overdue`
      : `🟡 KYC Re-verification Required: ${allStale.length} record(s) stale`;

    const bodyLines = allStale.slice(0, 5).map(r => {
      const monthsStale = Math.floor((now.getTime() - r.updatedAt.getTime()) / (30 * 24 * 3_600_000));
      const risk = (r.riskScore ?? 0) >= 70 ? 'HIGH' : 'LOW';
      return `• ${r.subjectName} (${risk} risk) — last verified ${monthsStale} month(s) ago`;
    });
    if (allStale.length > 5) bodyLines.push(`… and ${allStale.length - 5} more`);

    await db.insert(alerts).values({
      title,
      body: bodyLines.join('\n'),
      type: "system" as any,
      severity: urgentCount > 0 ? "high" as any : "medium" as any,
      subjectRef: "kyc-expiry-digest",
      sourceService: "kyc-expiry-digest",
      read: false,
      acknowledged: false,
      resolved: false,
      dismissed: false,
    });
    alertsCreated = 1;
  }

  // ── Send owner notification ───────────────────────────────────────────────

  const tableRows = allStale.map(r => {
    const monthsStale = Math.floor((now.getTime() - r.updatedAt.getTime()) / (30 * 24 * 3_600_000));
    const risk = (r.riskScore ?? 0) >= 70 ? 'HIGH 🔴' : 'LOW 🟢';
    return `  ${r.subjectName} | ${risk} | Last verified: ${monthsStale} month(s) ago | Status: ${r.status}`;
  }).join('\n');

  const notifyContent = `
KYC Re-verification Digest — ${now.toLocaleDateString('en-NG', { dateStyle: 'full' })}

Summary:
  • High-risk records overdue (>12 months): ${staleHighRiskRecords.length}
  • Low-risk records overdue (>36 months):  ${staleLowRiskRecords.length}
  • Total requiring action:                 ${allStale.length}

Records:
${tableRows}

Action required: Log in to the BIS platform → KYC Records → Re-verify the flagged records.
Regulatory basis: CBN KYC Manual 2023 — Annual renewal for high-risk, 3-year for low-risk.
  `.trim();

  const notified = await notifyOwner({
    title: `KYC Re-verification Digest: ${allStale.length} stale record(s)`,
    content: notifyContent,
  });

  // ── Send Expo push notifications ──────────────────────────────────────────

  if (staleHighRiskRecords.length > 0) {
    try {
      const allUsers = await db
        .select({ pushToken: users.pushToken })
        .from(users)
        .where(sql`${users.pushToken} IS NOT NULL`);

      const pushTokens = allUsers.map(u => u.pushToken!).filter(Boolean);
      if (pushTokens.length > 0) {
        const pushMessages = pushTokens.map(token => ({
          to: token,
          title: `⚠️ KYC: ${staleHighRiskRecords.length} high-risk record(s) overdue`,
          body: `${staleHighRiskRecords[0]?.subjectName ?? 'Unknown'} and ${staleHighRiskRecords.length - 1} other(s) require immediate re-verification.`,
          data: { type: "kyc-expiry", count: staleHighRiskRecords.length },
          priority: "high" as const,
          sound: "default" as const,
        }));

        for (let i = 0; i < pushMessages.length; i += 100) {
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(pushMessages.slice(i, i + 100)),
          });
        }
      }
    } catch (err) {
      console.error("[KYC Expiry Digest] Push notification failed:", err);
    }
  }

  console.log(
    `[KYC Expiry Digest] ${allStale.length} stale record(s) ` +
    `(${staleHighRiskRecords.length} high-risk, ${staleLowRiskRecords.length} low-risk), ` +
    `${alertsCreated} alert(s) created, notified: ${notified}`
  );

  return {
    checked: allStale.length,
    staleHighRisk: staleHighRiskRecords.length,
    staleLowRisk: staleLowRiskRecords.length,
    alertsCreated,
    notified,
  };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Schedules the KYC expiry digest to run daily at 08:00 WAT (07:00 UTC).
 * Uses a recursive setTimeout approach compatible with the Manus deployment
 * model (no node-cron dependency required).
 */
export function startKycExpiryDigestScheduler(): void {
  function msUntilNextRun(): number {
    const now = new Date();
    const target = new Date(now);
    // Set to 07:00 UTC (= 08:00 WAT)
    target.setUTCHours(7, 0, 0, 0);
    if (target <= now) {
      // Already past today's run — schedule for tomorrow
      target.setUTCDate(target.getUTCDate() + 1);
    }
    return target.getTime() - now.getTime();
  }

  function scheduleNextRun(): void {
    const delay = msUntilNextRun();
    const nextRunAt = new Date(Date.now() + delay);
    console.log(
      `[KYC Expiry Digest] Scheduled — next run at ${nextRunAt.toISOString()} ` +
      `(${Math.round(delay / 60_000)} min from now)`
    );
    setTimeout(async () => {
      try {
        await runKycExpiryDigest();
      } catch (err) {
        console.error("[KYC Expiry Digest] Scheduled run failed:", err);
      }
      scheduleNextRun();
    }, delay);
  }

  scheduleNextRun();
}
