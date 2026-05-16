/**
 * kycScheduledRerunExecutor.ts
 *
 * Polls the kycScheduledReruns table every 5 minutes.
 * For each pending rerun whose scheduledAt is in the past, it:
 *  1. Marks the rerun as "running"
 *  2. Calls the same pipeline logic as kyc.run (gateway lookups + risk engine)
 *  3. Inserts a new kycRecords row with the result
 *  4. Updates the rerun row with status "completed" and resultKycRecordId
 *  5. On error, marks the rerun as "failed"
 */

import { and, eq, lte } from "drizzle-orm";
import { getDb } from "./db";
import { kycRecords, kycScheduledReruns } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { notifyOwner } from "./_core/notification";
import nodemailer from "nodemailer";

// ─── Email digest helper ──────────────────────────────────────────────────────

interface RerunDigestEntry {
  subjectName: string;
  status: string;
  riskScore: number;
  rerunId: number;
}

async function sendRerunDigest(entries: RerunDigestEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass) {
    // Fall back to notifyOwner if SMTP not configured
    const summary = entries.map(e =>
      `• ${e.subjectName}: ${e.status.toUpperCase()} (risk score: ${e.riskScore})`
    ).join("\n");
    await notifyOwner({
      title: `KYC Scheduled Re-run Digest — ${entries.length} completed`,
      content: `The following KYC re-runs completed:\n\n${summary}`,
    }).catch(() => {});
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const rows = entries.map(e =>
    `<tr><td style="padding:4px 8px">${e.subjectName}</td><td style="padding:4px 8px">${e.status.toUpperCase()}</td><td style="padding:4px 8px">${e.riskScore}</td></tr>`
  ).join("");

  await transporter.sendMail({
    from: smtpFrom,
    to: smtpUser,
    subject: `BIS KYC Re-run Digest — ${entries.length} completed`,
    html: `<h2>KYC Scheduled Re-run Digest</h2><p>${entries.length} re-runs completed in this cycle.</p><table border="1" cellspacing="0" style="border-collapse:collapse"><thead><tr><th style="padding:4px 8px">Subject</th><th style="padding:4px 8px">Status</th><th style="padding:4px 8px">Risk Score</th></tr></thead><tbody>${rows}</tbody></table>`,
  }).catch((err: unknown) => console.error("[kycScheduledRerunExecutor] Email digest failed:", err));
}

// ─── Inline helpers (mirrors routers.ts implementations) ─────────────────────

async function gatewayFetch(path: string): Promise<any> {
  const base = process.env.GATEWAY_SANDBOX || "http://localhost:8081";
  const res = await fetch(`${base}${path}`, { headers: { "x-api-key": "internal" } });
  if (!res.ok) throw new Error(`Gateway ${path} → ${res.status}`);
  return res.json();
}

async function riskEngineFetch(path: string, body: unknown): Promise<any> {
  const base = ENV.riskEngineUrl;
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RiskEngine ${path} → ${res.status}`);
  return res.json();
}

async function writeAuditLog(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  entry: { userId: number; category: "kyc" | "investigation" | "alert" | "report" | "user" | "system" | "api"; action: string; targetRef?: string }
): Promise<void> {
  const { auditLog } = await import("../drizzle/schema");
  await db.insert(auditLog).values({
    userId: entry.userId,
    category: entry.category,
    action: entry.action,
    targetRef: entry.targetRef,
    result: "success",
  }).catch(() => {});
}

async function publishEvent(
  eventType: string,
  subjectRef: string,
  severity: string,
  payload: unknown,
  source = "bis-bff"
): Promise<void> {
  const eventProcessorUrl = ENV.eventProcessorUrl;
  await fetch(`${eventProcessorUrl}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType, subjectRef, severity, payload, source }),
  }).catch(() => {});
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export async function runPendingKycReruns(): Promise<{ processed: number; failed: number }> {
  const db = await getDb();
  if (!db) return { processed: 0, failed: 0 };

  // Fetch all pending reruns whose scheduledAt is now or in the past
  const pending = await db
    .select()
    .from(kycScheduledReruns)
    .where(
      and(
        eq(kycScheduledReruns.status, "pending"),
        lte(kycScheduledReruns.scheduledAt, new Date())
      )
    )
    .limit(50); // process at most 50 per cycle to avoid overload

  let processed = 0;
  let failed = 0;
  const digestEntries: RerunDigestEntry[] = [];

  for (const rerun of pending) {
    try {
      // Mark as running to prevent double-processing
      await db
        .update(kycScheduledReruns)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(kycScheduledReruns.id, rerun.id));

      // Insert a new KYC record for this rerun (createdBy is required; use 0 for system)
      const [record] = await db
        .insert(kycRecords)
        .values({
          subjectName: rerun.subjectName,
          nin: rerun.nin ?? null,
          bvn: rerun.bvn ?? null,
          dob: rerun.dob ?? null,
          phone: rerun.phone ?? null,
          status: "processing",
          createdBy: rerun.createdBy ?? 0,
        })
        .returning();

      // Run lookups in parallel (same as kyc.run)
      const [ninResult, bvnResult, sanctionsResult, pepResult, creditResult] = await Promise.allSettled([
        rerun.nin ? gatewayFetch(`/v1/nin/${rerun.nin}`) : Promise.resolve(null),
        rerun.bvn ? gatewayFetch(`/v1/bvn/${rerun.bvn}`) : Promise.resolve(null),
        gatewayFetch(`/v1/sanctions/${encodeURIComponent(rerun.subjectName)}`),
        gatewayFetch(`/v1/pep/${encodeURIComponent(rerun.subjectName)}`),
        rerun.bvn ? gatewayFetch(`/v1/credit/${rerun.bvn}`) : Promise.resolve(null),
      ]);

      const nin = ninResult.status === "fulfilled" ? ninResult.value : null;
      const bvn = bvnResult.status === "fulfilled" ? bvnResult.value : null;
      const sanctions = sanctionsResult.status === "fulfilled" ? sanctionsResult.value : null;
      const pep = pepResult.status === "fulfilled" ? pepResult.value : null;
      const credit = creditResult.status === "fulfilled" ? creditResult.value : null;

      // Score via risk engine
      const scoreResult = await riskEngineFetch("/v1/score", {
        subject_id: rerun.subjectName,
        identity: {
          nin_verified: !!nin?.status,
          bvn_verified: !!bvn?.bvn,
          nin_match_score: nin?.matchScore ?? 0,
          bvn_match_score: bvn?.matchScore ?? 0,
        },
        sanctions: { ofac_hit: !sanctions?.clear, bvn_watchlisted: bvn?.watchlisted ?? false },
        pep: { is_pep: pep?.isPEP ?? false },
        credit: { credit_score: credit?.score ?? 700, defaults: credit?.defaults ?? 0 },
      }).catch(() => ({ composite_score: 50, risk_tier: "medium" }));

      const status =
        scoreResult.risk_tier === "critical"
          ? "failed"
          : scoreResult.risk_tier === "high"
          ? "review"
          : "passed";

      // Update the new KYC record with results
      await db
        .update(kycRecords)
        .set({
          status,
          riskScore: scoreResult.composite_score,
          ninResult: nin as any,
          bvnResult: bvn as any,
          sanctionsResult: sanctions as any,
          pepResult: pep as any,
          creditResult: credit as any,
        })
        .where(eq(kycRecords.id, record!.id));

      // Mark the rerun as completed
      await db
        .update(kycScheduledReruns)
        .set({
          status: "completed",
          resultKycRecordId: record!.id,
          updatedAt: new Date(),
        })
        .where(eq(kycScheduledReruns.id, rerun.id));

      // Write audit log
      await writeAuditLog(db, {
        userId: rerun.createdBy ?? 0,
        category: "kyc",
        action: `Scheduled KYC re-run completed for ${rerun.subjectName} (status: ${status})`,
        targetRef: String(rerun.kycRecordId),
      });

      // Publish event
      await publishEvent(
        "KYC_SCHEDULED_RERUN_COMPLETED",
        rerun.subjectName,
        status === "failed" ? "high" : "info",
        { status, score: scoreResult.composite_score, rerunId: rerun.id }
      ).catch(() => {});

      digestEntries.push({
        subjectName: rerun.subjectName,
        status,
        riskScore: scoreResult.composite_score,
        rerunId: rerun.id,
      });
      processed++;
    } catch (err) {
      console.error(`[kycScheduledRerunExecutor] Failed to process rerun ${rerun.id}:`, err);
      // Mark as failed
      await db
        .update(kycScheduledReruns)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(kycScheduledReruns.id, rerun.id))
        .catch(() => {});
      failed++;
    }
  }

  if (processed > 0 || failed > 0) {
    console.log(`[kycScheduledRerunExecutor] Cycle complete: ${processed} processed, ${failed} failed`);
    // Send email digest for completed reruns
    await sendRerunDigest(digestEntries).catch(() => {});
  }

  return { processed, failed };
}

export function startKycScheduledRerunExecutor(): void {
  console.log("[kycScheduledRerunExecutor] Starting — polling every 5 minutes");
  // Run immediately on startup to catch any overdue reruns
  runPendingKycReruns().catch(err =>
    console.error("[kycScheduledRerunExecutor] Initial run error:", err)
  );
  setInterval(() => {
    runPendingKycReruns().catch(err =>
      console.error("[kycScheduledRerunExecutor] Interval run error:", err)
    );
  }, POLL_INTERVAL_MS);
}
