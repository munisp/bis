/**
 * server/monitoring.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Ongoing monitoring (continuous re-screening) engine — router + pure core.
 *
 * An operator enrolls an investigation subject for recurring screening. The
 * enrollment stores a BASELINE SNAPSHOT of the subject's current
 * sanctions/PEP/watchlist hits (stable hit IDs + status bands). The scheduler
 * (server/monitoringScheduler.ts) re-runs the SAME existing screening entry
 * points used by kyc.run / kycScheduledRerunExecutor:
 *
 *   sanctions → GET  {BIS_GATEWAY_URL}/v1/sanctions/:name   (BIS verification engine)
 *   pep       → GET  {BIS_GATEWAY_URL}/v1/pep/:name
 *   watchlist → POST {BIS_VERIFY_CAC_URL} check_type=efcc_watchlist (ngScreening pipeline)
 *
 * and diffs the fresh snapshot against the baseline. This module deliberately
 * does NOT reimplement list matching — it only normalizes provider responses
 * into a comparable snapshot shape.
 *
 * Fail-closed: if any requested provider is unavailable, screening throws
 * ScreeningProviderUnavailableError; enroll refuses to create a baseline and
 * the scheduler records a monitoring_runs row with result='error' instead of
 * silently treating the subject as clear.
 *
 * Storage is raw pg SQL against the 0025_monitoring migration tables (same
 * precedent as server/informalVerification.ts). Every query is tenant-scoped.
 */

import { createHash, createHmac, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, writeProcedure } from "./_core/trpc";
import { getPgPool } from "./db";
import { ENV } from "./_core/env";

// ─── Types ──────────────────────────────────────────────────────────────────

export const monitoringListKindSchema = z.enum(["sanctions", "pep", "watchlist"]);
export type MonitoringListKind = z.infer<typeof monitoringListKindSchema>;

export const monitoringFrequencySchema = z.enum(["daily", "weekly", "monthly"]);
export type MonitoringFrequency = z.infer<typeof monitoringFrequencySchema>;

export interface MonitoringHit {
  /** Stable identity: sha256(list|sourceList|matchedName), 32 hex chars. */
  id: string;
  list: MonitoringListKind;
  matchedName: string;
  sourceList?: string;
  /** Status band used for status_change detection: hit | low | medium | high. */
  status: string;
  score?: number;
}

export interface MonitoringSnapshot {
  subjectName: string;
  screenedAt: string;
  hits: MonitoringHit[];
}

export interface MonitoringStatusChange {
  id: string;
  list: MonitoringListKind;
  matchedName: string;
  from: string;
  to: string;
}

export interface MonitoringDelta {
  changed: boolean;
  newHits: MonitoringHit[];
  removedHits: MonitoringHit[];
  statusChanges: MonitoringStatusChange[];
}

export class ScreeningProviderUnavailableError extends Error {
  readonly provider: string;
  constructor(provider: string, cause?: unknown) {
    super(`Screening provider unavailable: ${provider}`);
    this.name = "ScreeningProviderUnavailableError";
    this.provider = provider;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

// ─── Shared helpers (same shape as server/shareableReports.ts) ──────────────

function requireTenant(ctx: { tenantId: number | null; user: { id: number; role?: string } | null }) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated operator is required" });
  if (!ctx.tenantId || ctx.tenantId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "An explicit tenant context is required" });
  return { tenantId: ctx.tenantId, userId: ctx.user.id, role: ctx.user.role };
}

async function poolOrFail(): Promise<Queryable & { connect: () => Promise<{ query: Queryable["query"]; release: () => void }> }> {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Monitoring storage is unavailable" });
  return pool;
}

export async function writeMonitoringAuditLog(client: Queryable, entry: {
  tenantId: number; userId: number | null; action: string; targetRef?: string; result?: "success" | "warning" | "failure"; detail?: unknown;
}) {
  const createdAt = new Date();
  const result = entry.result ?? "success";
  const payload = [String(entry.userId ?? ""), "alert", entry.action, entry.targetRef ?? "", result, createdAt.toISOString()].join("|");
  const integrityHash = createHmac("sha256", ENV.auditHmacSecret).update(payload).digest("hex").slice(0, 64);
  await client.query(
    `INSERT INTO audit_log ("tenantId", "userId", category, action, "targetRef", result, detail, "integrityHash", "createdAt")
     VALUES ($1, $2, 'alert', $3, $4, $5, $6::jsonb, $7, $8)`,
    [entry.tenantId, entry.userId, entry.action, entry.targetRef ?? null, result, JSON.stringify(entry.detail ?? {}), integrityHash, createdAt],
  ).catch(() => undefined);
}

export async function publishMonitoringEvent(eventType: string, subjectRef: string, severity: string, payload: unknown) {
  try {
    await fetch(`${ENV.eventProcessorUrl}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
      body: JSON.stringify({ event_type: eventType, subject_id: subjectRef, subject_ref: subjectRef, severity, payload, source_service: "bis-bff" }),
    });
  } catch (e) {
    console.warn("[EventProcessor] Failed to publish event:", e);
  }
}

// ─── Screening engine (normalization only — matching stays in providers) ────

async function gatewayGet(path: string, provider: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${ENV.bisGatewayUrl}${path}`, {
      headers: { "X-BIS-Key": ENV.bisGatewayKey },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (e) {
    throw new ScreeningProviderUnavailableError(provider, e);
  }
  if (!res.ok) throw new ScreeningProviderUnavailableError(provider, `HTTP ${res.status}`);
  return res.json().catch((e) => { throw new ScreeningProviderUnavailableError(provider, e); });
}

/** Providers report scores on either a 0..1 or 0..100 scale; normalize to 0..100. */
function normalizeScore(score: unknown): number | undefined {
  if (typeof score !== "number" || !Number.isFinite(score)) return undefined;
  const scaled = score > 0 && score <= 1 ? score * 100 : score;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

export function scoreBand(score: number | undefined): string {
  if (score === undefined) return "hit";
  if (score >= 90) return "high";
  if (score >= 70) return "medium";
  return "low";
}

function hitId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function sanitizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "A subject name of at least two characters is required" });
  return trimmed;
}

async function screenSanctions(subjectName: string): Promise<MonitoringHit[]> {
  const res = await gatewayGet(`/v1/sanctions/${encodeURIComponent(subjectName)}`, "sanctions");
  const rawHits: any[] = Array.isArray(res?.hits) ? res.hits : [];
  if (rawHits.length === 0 && res?.clear === false) {
    // Provider signalled a hit without itemizing it — keep one synthetic hit so
    // a later "clear" result is still detected as a removed_hit delta.
    return [{ id: hitId("sanctions", "", subjectName), list: "sanctions", matchedName: subjectName, status: "hit" }];
  }
  return rawHits.map((h) => {
    const matchedName = typeof h?.name === "string" && h.name.trim() ? h.name.trim() : subjectName;
    const sourceList = typeof h?.list === "string" ? h.list : undefined;
    const score = normalizeScore(h?.score);
    return { id: hitId("sanctions", sourceList ?? "", matchedName), list: "sanctions" as const, matchedName, sourceList, score, status: scoreBand(score) };
  });
}

async function screenPep(subjectName: string): Promise<MonitoringHit[]> {
  const res = await gatewayGet(`/v1/pep/${encodeURIComponent(subjectName)}`, "pep");
  const hits: MonitoringHit[] = [];
  if (res?.isPEP === true) {
    hits.push({ id: hitId("pep", "", subjectName), list: "pep", matchedName: subjectName, sourceList: "pep_registry", status: "hit" });
  }
  const rawHits: any[] = Array.isArray(res?.hits) ? res.hits : Array.isArray(res?.matches) ? res.matches : [];
  for (const h of rawHits) {
    const matchedName = typeof h?.name === "string" && h.name.trim() ? h.name.trim() : subjectName;
    const score = normalizeScore(h?.score);
    hits.push({ id: hitId("pep", "", matchedName), list: "pep", matchedName, score, status: scoreBand(score) });
  }
  // De-duplicate by id (isPEP flag and itemized hits may describe the same person).
  return Array.from(new Map(hits.map((h) => [h.id, h])).values());
}

async function screenWatchlist(subjectName: string, identifiers: Record<string, string>): Promise<MonitoringHit[]> {
  if (!ENV.bisVerifyCacUrl || !ENV.bisVerifyCacKey) throw new ScreeningProviderUnavailableError("watchlist", "provider_not_configured");
  let res: Response;
  try {
    res = await fetch(ENV.bisVerifyCacUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ENV.bisVerifyCacKey}` },
      body: JSON.stringify({
        check_type: "efcc_watchlist",
        name: subjectName,
        nin: identifiers.nin,
        bvn: identifiers.bvn,
        dob: identifiers.dob,
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (e) {
    throw new ScreeningProviderUnavailableError("watchlist", e);
  }
  if (!res.ok) throw new ScreeningProviderUnavailableError("watchlist", `HTTP ${res.status}`);
  const data: any = await res.json().catch((e) => { throw new ScreeningProviderUnavailableError("watchlist", e); });
  if (data?.hit === true || data?.data?.hit === true) {
    return [{ id: hitId("watchlist", "", subjectName), list: "watchlist", matchedName: subjectName, sourceList: "efcc_watchlist", status: "hit" }];
  }
  return [];
}

/**
 * Runs the subject's current screening across the requested list set using the
 * existing provider pipelines. Throws ScreeningProviderUnavailableError when
 * any requested provider cannot produce a decision (fail-closed).
 */
export async function runSubjectScreening(
  subjectName: string,
  identifiers: Record<string, string>,
  listSet: readonly MonitoringListKind[],
): Promise<MonitoringSnapshot> {
  const name = sanitizeName(subjectName);
  const hits: MonitoringHit[] = [];
  for (const kind of Array.from(new Set(listSet))) {
    if (kind === "sanctions") hits.push(...await screenSanctions(name));
    else if (kind === "pep") hits.push(...await screenPep(name));
    else hits.push(...await screenWatchlist(name, identifiers));
  }
  hits.sort((a, b) => a.id.localeCompare(b.id));
  return { subjectName: name, screenedAt: new Date().toISOString(), hits };
}

// ─── Diff + schedule math (pure, unit-tested) ───────────────────────────────

export function diffSnapshots(baseline: MonitoringSnapshot | null | undefined, current: MonitoringSnapshot): MonitoringDelta {
  const baseHits = new Map((baseline?.hits ?? []).map((h) => [h.id, h]));
  const currHits = new Map(current.hits.map((h) => [h.id, h]));
  const newHits = current.hits.filter((h) => !baseHits.has(h.id));
  const removedHits = (baseline?.hits ?? []).filter((h) => !currHits.has(h.id));
  const statusChanges: MonitoringStatusChange[] = [];
  for (const hit of current.hits) {
    const before = baseHits.get(hit.id);
    if (before && before.status !== hit.status) {
      statusChanges.push({ id: hit.id, list: hit.list, matchedName: hit.matchedName, from: before.status, to: hit.status });
    }
  }
  return { changed: newHits.length > 0 || removedHits.length > 0 || statusChanges.length > 0, newHits, removedHits, statusChanges };
}

const DAY_MS = 24 * 3_600 * 1_000;

export function nextRunAt(frequency: MonitoringFrequency, from: Date = new Date()): Date {
  if (frequency === "daily") return new Date(from.getTime() + DAY_MS);
  if (frequency === "weekly") return new Date(from.getTime() + 7 * DAY_MS);
  const monthly = new Date(from.getTime());
  monthly.setUTCMonth(monthly.getUTCMonth() + 1);
  return monthly;
}

export function alertSeverity(alertType: "new_hit" | "status_change" | "removed_hit", hit: { list: MonitoringListKind; status?: string }): string {
  if (alertType === "new_hit") return hit.list === "sanctions" ? "critical" : "high";
  if (alertType === "status_change") return hit.status === "high" ? "high" : "medium";
  return "low";
}

// ─── Router ─────────────────────────────────────────────────────────────────

const enrollmentRow = (r: any) => ({
  enrollmentId: r.id as string,
  tenantId: r.tenant_id as number,
  investigationRef: r.investigation_ref as string,
  subjectName: r.subject_name as string,
  subjectIdentifiers: (r.subject_identifiers ?? {}) as Record<string, string>,
  listSet: (r.list_set ?? []) as MonitoringListKind[],
  frequency: r.frequency as MonitoringFrequency,
  status: r.status as "active" | "paused" | "cancelled",
  lastRunAt: r.last_run_at ?? null,
  nextRunAt: r.next_run_at ?? null,
  baselineSnapshot: (r.baseline_snapshot ?? {}) as MonitoringSnapshot,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at ?? null,
  updatedAt: r.updated_at ?? null,
});

export const monitoringRouter = router({
  enroll: writeProcedure
    .input(z.object({
      investigationRef: z.string().min(4).max(64),
      subjectName: z.string().min(2).max(255),
      subjectIdentifiers: z.record(z.string(), z.string()).default({}),
      listSet: z.array(monitoringListKindSchema).min(1).max(3).default(["sanctions", "pep", "watchlist"]),
      frequency: monitoringFrequencySchema,
    }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId } = requireTenant(ctx);
      const pool = await poolOrFail();

      // Fail-closed: no baseline is stored unless every requested provider
      // produced a decision for this subject.
      let baseline: MonitoringSnapshot;
      try {
        baseline = await runSubjectScreening(input.subjectName, input.subjectIdentifiers, input.listSet);
      } catch (e) {
        if (e instanceof ScreeningProviderUnavailableError) {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Cannot enroll for monitoring: ${e.message}. No baseline was stored.` });
        }
        throw e;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const investigation = await client.query(
          `SELECT id FROM investigations WHERE ref = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL FOR SHARE`,
          [input.investigationRef, tenantId],
        );
        if (investigation.rowCount !== 1) throw new TRPCError({ code: "FORBIDDEN", message: "Investigation is not available in this tenant" });

        const id = randomUUID();
        const nextRun = nextRunAt(input.frequency);
        try {
          await client.query(
            `INSERT INTO monitoring_enrollments
               (id, tenant_id, investigation_ref, subject_name, subject_identifiers, list_set, frequency, status, next_run_at, baseline_snapshot, created_by)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], $7, 'active', $8, $9::jsonb, $10)`,
            [id, tenantId, input.investigationRef, baseline.subjectName, JSON.stringify(input.subjectIdentifiers), input.listSet, input.frequency, nextRun, JSON.stringify(baseline), userId],
          );
        } catch (e: any) {
          if (e?.code === "23505") throw new TRPCError({ code: "CONFLICT", message: "An active or paused monitoring enrollment already exists for this subject and investigation" });
          throw e;
        }
        await writeMonitoringAuditLog(client, {
          tenantId, userId, action: "monitoring_enrolled", targetRef: input.investigationRef,
          detail: { enrollmentId: id, subjectName: baseline.subjectName, listSet: input.listSet, frequency: input.frequency, baselineHitCount: baseline.hits.length },
        });
        await client.query("COMMIT");
        await publishMonitoringEvent("MONITORING_ENROLLED", input.investigationRef, "info", {
          enrollmentId: id, tenantId, frequency: input.frequency, listSet: input.listSet, baselineHitCount: baseline.hits.length,
        });
        return { enrollmentId: id, status: "active" as const, baselineHitCount: baseline.hits.length, nextRunAt: nextRun };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }),

  pause: writeProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `UPDATE monitoring_enrollments SET status = 'paused', updated_at = now()
           WHERE id = $1 AND tenant_id = $2 AND status = 'active' RETURNING investigation_ref`,
          [input.enrollmentId, tenantId],
        );
        if (result.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Only an active enrollment in this tenant can be paused" });
        await writeMonitoringAuditLog(client, { tenantId, userId, action: "monitoring_paused", targetRef: result.rows[0].investigation_ref, detail: { enrollmentId: input.enrollmentId } });
        await client.query("COMMIT");
        return { enrollmentId: input.enrollmentId, status: "paused" as const };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }),

  resume: writeProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          `SELECT frequency, investigation_ref FROM monitoring_enrollments WHERE id = $1 AND tenant_id = $2 AND status = 'paused' FOR UPDATE`,
          [input.enrollmentId, tenantId],
        );
        if (current.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Only a paused enrollment in this tenant can be resumed" });
        const nextRun = nextRunAt(current.rows[0].frequency as MonitoringFrequency);
        await client.query(
          `UPDATE monitoring_enrollments SET status = 'active', next_run_at = $2, updated_at = now() WHERE id = $1 AND tenant_id = $3`,
          [input.enrollmentId, nextRun, tenantId],
        );
        await writeMonitoringAuditLog(client, { tenantId, userId, action: "monitoring_resumed", targetRef: current.rows[0].investigation_ref, detail: { enrollmentId: input.enrollmentId, nextRunAt: nextRun.toISOString() } });
        await client.query("COMMIT");
        return { enrollmentId: input.enrollmentId, status: "active" as const, nextRunAt: nextRun };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }),

  cancel: writeProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `UPDATE monitoring_enrollments SET status = 'cancelled', updated_at = now()
           WHERE id = $1 AND tenant_id = $2 AND status IN ('active', 'paused') RETURNING investigation_ref`,
          [input.enrollmentId, tenantId],
        );
        if (result.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Only an active or paused enrollment in this tenant can be cancelled" });
        await writeMonitoringAuditLog(client, { tenantId, userId, action: "monitoring_cancelled", targetRef: result.rows[0].investigation_ref, detail: { enrollmentId: input.enrollmentId } });
        await client.query("COMMIT");
        return { enrollmentId: input.enrollmentId, status: "cancelled" as const };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.enum(["active", "paused", "cancelled"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const { tenantId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const status = input?.status ?? null;
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT * FROM monitoring_enrollments
           WHERE tenant_id = $1 AND ($2::varchar IS NULL OR status = $2)
           ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
          [tenantId, status, input?.limit ?? 50, input?.offset ?? 0],
        ),
        pool.query(
          `SELECT count(*)::int AS total FROM monitoring_enrollments WHERE tenant_id = $1 AND ($2::varchar IS NULL OR status = $2)`,
          [tenantId, status],
        ),
      ]);
      return { records: rows.rows.map(enrollmentRow), total: Number(count.rows[0]?.total ?? 0) };
    }),

  getEnrollment: protectedProcedure
    .input(z.object({ enrollmentId: z.string().uuid(), runsLimit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input, ctx }) => {
      const { tenantId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const enrollment = await pool.query(
        `SELECT * FROM monitoring_enrollments WHERE id = $1 AND tenant_id = $2`,
        [input.enrollmentId, tenantId],
      );
      if (enrollment.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoring enrollment not found in this tenant" });
      const runs = await pool.query(
        `SELECT id, started_at, finished_at, result, error FROM monitoring_runs
         WHERE enrollment_id = $1 ORDER BY started_at DESC LIMIT $2`,
        [input.enrollmentId, input.runsLimit],
      );
      return { enrollment: enrollmentRow(enrollment.rows[0]), runs: runs.rows };
    }),

  getAlerts: protectedProcedure
    .input(z.object({
      enrollmentId: z.string().uuid().optional(),
      includeAcknowledged: z.boolean().default(false),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const { tenantId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const enrollmentId = input?.enrollmentId ?? null;
      const includeAcknowledged = input?.includeAcknowledged ?? false;
      const result = await pool.query(
        `SELECT id, enrollment_id, alert_type, severity, delta, acknowledged_at, acknowledged_by, created_at
         FROM monitoring_alerts
         WHERE tenant_id = $1
           AND ($2::uuid IS NULL OR enrollment_id = $2)
           AND ($3::boolean OR acknowledged_at IS NULL)
         ORDER BY (acknowledged_at IS NOT NULL), created_at DESC
         LIMIT $4 OFFSET $5`,
        [tenantId, enrollmentId, includeAcknowledged, input?.limit ?? 50, input?.offset ?? 0],
      );
      return { alerts: result.rows };
    }),

  acknowledgeAlert: writeProcedure
    .input(z.object({ alertId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId, role } = requireTenant(ctx);
      if (role !== "admin" && role !== "supervisor") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only an admin or supervisor can acknowledge monitoring alerts" });
      }
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `UPDATE monitoring_alerts SET acknowledged_at = now(), acknowledged_by = $2
           WHERE id = $1 AND tenant_id = $3 AND acknowledged_at IS NULL
           RETURNING enrollment_id`,
          [input.alertId, userId, tenantId],
        );
        if (result.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "Alert is unavailable or already acknowledged in this tenant" });
        await writeMonitoringAuditLog(client, { tenantId, userId, action: "monitoring_alert_acknowledged", targetRef: input.alertId, detail: { enrollmentId: result.rows[0].enrollment_id } });
        await client.query("COMMIT");
        return { alertId: input.alertId, acknowledged: true as const };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }),
});
