/**
 * DataSources Health Scheduler
 * ============================
 * Runs every 15 minutes. For each enabled data source it performs a lightweight
 * HTTP HEAD/GET probe against the source's baseUrl (or a known health endpoint),
 * then updates:
 *   - status: "active" | "degraded" | "offline"
 *   - avgResponseMs: rolling average of the last probe latency
 *   - uptimePct: simple rolling uptime (95% decay per failure, +1% per success, capped 0–100)
 *   - lastCheckedAt: timestamp of this probe
 */

import { getDb } from "./db";
import { dataSources, dataSourceHealthLogs } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const PROBE_TIMEOUT_MS = 8_000;      // 8 second timeout per probe

// ─── Single source probe ──────────────────────────────────────────────────────

interface ProbeResult {
  status: "active" | "degraded" | "offline";
  responseMs: number;
}

async function probeDataSource(baseUrl: string): Promise<ProbeResult> {
  const start = Date.now();
  try {
    // Try a HEAD request first (cheaper), fall back to GET
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(baseUrl, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    }).catch(async () => {
      // HEAD not supported by some servers — try GET
      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), PROBE_TIMEOUT_MS);
      const r = await fetch(baseUrl, { method: "GET", signal: c2.signal, redirect: "follow" });
      clearTimeout(t2);
      return r;
    });
    clearTimeout(timer);
    const responseMs = Date.now() - start;
    if (res.ok || (res.status >= 200 && res.status < 500)) {
      // 4xx counts as "degraded" (server is up but rejecting requests — expected for auth-gated APIs)
      const status: ProbeResult["status"] = res.status >= 400 ? "degraded" : "active";
      return { status, responseMs };
    }
    return { status: "offline", responseMs };
  } catch {
    return { status: "offline", responseMs: Date.now() - start };
  }
}

// ─── Update uptime percentage ─────────────────────────────────────────────────

function updateUptimePct(current: number, probeStatus: ProbeResult["status"]): number {
  const pct = current ?? 100;
  if (probeStatus === "active") {
    // Recover slowly: +1% per successful probe, capped at 100
    return Math.min(100, pct + 1);
  } else if (probeStatus === "degraded") {
    // Slight degradation: -2% per degraded probe
    return Math.max(0, pct - 2);
  } else {
    // Offline: -5% per failed probe
    return Math.max(0, pct - 5);
  }
}

// ─── Core health check job ────────────────────────────────────────────────────

export interface HealthCheckResult {
  checked: number;
  active: number;
  degraded: number;
  offline: number;
  skipped: number;
}

export async function runDataSourcesHealthCheck(): Promise<HealthCheckResult> {
  const db = await getDb();
  if (!db) return { checked: 0, active: 0, degraded: 0, offline: 0, skipped: 0 };

  // Fetch all enabled sources that have a baseUrl
  const sources = await db
    .select()
    .from(dataSources)
    .where(eq(dataSources.enabled, true));

  const result: HealthCheckResult = { checked: 0, active: 0, degraded: 0, offline: 0, skipped: 0 };

  // Probe all sources in parallel (capped at 10 concurrent)
  const CONCURRENCY = 10;
  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (source) => {
        if (!source.baseUrl) {
          result.skipped++;
          return;
        }
        result.checked++;
        const probe = await probeDataSource(source.baseUrl);

        // Compute new uptime percentage
        const newUptimePct = updateUptimePct(source.uptimePct ?? 100, probe.status);

        // Rolling average response time (simple EMA with α=0.3)
        const prevAvg = source.avgResponseMs ?? 0;
        const newAvgMs = prevAvg === 0
          ? probe.responseMs
          : Math.round(0.3 * probe.responseMs + 0.7 * prevAvg);

        const checkedAt = new Date();
        await db
          .update(dataSources)
          .set({
            status: probe.status,
            avgResponseMs: newAvgMs,
            uptimePct: newUptimePct,
            lastCheckedAt: checkedAt,
          })
          .where(eq(dataSources.id, source.id));

        // Write a health log entry for the sparkline chart
        await db.insert(dataSourceHealthLogs).values({
          dataSourceId: source.id,
          status: probe.status,
          responseMs: probe.responseMs,
          checkedAt,
        }).catch(() => {}); // non-fatal

        // Notify owner when a source transitions to offline
        if (probe.status === "offline" && source.status !== "offline") {
          notifyOwner({
            title: `Data Source Offline: ${source.name}`,
            content: `The data source "${source.name}" (${source.baseUrl}) is now OFFLINE. Last response time: ${probe.responseMs}ms. Uptime dropped to ${newUptimePct}%.`,
          }).catch(() => {}); // non-fatal
        }

        result[probe.status]++;
      })
    );
  }

  console.log(
    `[DataSources Health] Checked ${result.checked} sources — ` +
    `active: ${result.active}, degraded: ${result.degraded}, offline: ${result.offline}, skipped: ${result.skipped}`
  );
  return result;
}

// ─── Scheduler entry point ────────────────────────────────────────────────────

export function startDataSourcesHealthScheduler(): void {
  console.log("[DataSources Health] Scheduler started — runs every 15 minutes.");
  // Run immediately on startup, then on interval
  runDataSourcesHealthCheck().catch((err) =>
    console.error("[DataSources Health] Initial run failed:", err)
  );
  setInterval(() => {
    runDataSourcesHealthCheck().catch((err) =>
      console.error("[DataSources Health] Scheduled run failed:", err)
    );
  }, INTERVAL_MS);
}
