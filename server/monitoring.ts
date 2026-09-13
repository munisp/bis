/**
 * Ongoing Monitoring (continuous re-screening) engine.
 *
 * Enrolls a tenant-owned investigation subject into scheduled re-screening
 * against watchlists. Every run reuses the existing screening entry points —
 * the gateway's /v1/sanctions/:name and /v1/pep/:name endpoints, the same
 * pipeline used by investigation creation and KYC in routers.ts — diffs the
 * normalized hit snapshot against the stored baseline, records an immutable
 * run row, and raises tenant-scoped alerts only on a verified delta.
 *
 * Fail-closed properties:
 *   - enroll() refuses to enroll when the current screening cannot complete.
 *   - Scheduler runs that fail to screen record result='error' and never
 *     fabricate an "all clear" delta.
 *   - Every read and write is scoped by tenant_id; alert acknowledgement
 *     requires an admin or supervisor.
 */
import { createHmac, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, writeProcedure } from "./_core/trpc";
import { ENV } from "./_core/env";
import { getDb, getPgPool } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MonitoringFrequency = "daily" | "weekly" | "monthly";
export type MonitoringStatus = "active" | "paused" | "cancelled";
export type MonitoringRunResult = "no_change" | "change_detected" | "error";
export type MonitoringAlertType = "new_hit" | "status_change" | "removed_hit";
export type MonitoringSeverity = "info" | "warning" | "critical";

export interface MonitoringSnapshotHit {
  hitKey: string;
  listName: string;
  matchedName: string;
  matchScore: number | null;
  status: string;
  severity: MonitoringSeverity;
}

export interface MonitoringSnapshot {
  screenedAt: string;
  lists: string[];
  hits: MonitoringSnapshotHit[];
}

export interface SnapshotDelta {
  newHits: MonitoringSnapshotHit[];
  removedHits: MonitoringSnapshotHit[];
  changedHits: Array<{ before: MonitoringSnapshotHit; after: MonitoringSnapshotHit }>;
}

interface EnrollmentRow {
  id: string;
  tenant_id: number;
  investigation_ref: string;
  subject_name: string;
  subject_identifiers: Record<string, unknown>;
  list_set: string[];
  frequency: MonitoringFrequency;
  status: MonitoringStatus;
  last_run_at: Date | null;
  next_run_at: Date | null;
  baseline_snapshot: MonitoringSnapshot | null;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

// ─── Pure helpers (unit-tested directly) ──────────────────────────────────────

/**
 * Diffs two hit snapshots by stable hitKey. A hit is "changed" when severity,
 * match status, or match score moved. Ordering is deterministic (hitKey asc)
 * so alerts are replay-stable.
 */
export function diffSnapshots(baseline: MonitoringSnapshot, current: MonitoringSnapshot): SnapshotDelta {
  const base = new Map((baseline.hits ?? []).map(h => [h.hitKey, h]));
  const cur = new Map((current.hits ?? []).map(h => [h.hitKey, h]));
  const newHits: MonitoringSnapshotHit[] = [];
  const removedHits: MonitoringSnapshotHit[] = [];
  const changedHits: Array<{ before: MonitoringSnapshotHit; after: MonitoringSnapshotHit }> = [];
  for (const [key, hit] of Array.from(cur.entries())) {
    const before = base.get(key);
    if (!before) {
      newHits.push(hit);
    } else if (
      before.severity !== hit.severity ||
      before.status !== hit.status ||
      before.matchScore !== hit.matchScore
    ) {
      changedHits.push({ before, after: hit });
    }
  }
  for (const [key, hit] of Array.from(base.entries())) {
    if (!cur.has(key)) removedHits.push(hit);
  }
  const byKey = (a: { hitKey: string }, b: { hitKey: string }) => a.hitKey.localeCompare(b.hitKey);
  newHits.sort(byKey);
  removedHits.sort(byKey);
  changedHits.sort((a, b) => a.after.hitKey.localeCompare(b.after.hitKey));
  return { newHits, removedHits, changedHits };
}

export function hasDelta(delta: SnapshotDelta): boolean {
  return delta.newHits.length > 0 || delta.removedHits.length > 0 || delta.changedHits.length > 0;
}

/**
 * next_run_at cadence math, computed in UTC. Monthly uses calendar months with
 * day clamping (Jan 31 → Feb 28/29), never silently drifting into March.
 */
export function computeNextRunAt(frequency: MonitoringFrequency, from: Date = new Date()): Date {
  const next = new Date(from.getTime());
  if (frequency === "daily") {
    next.setUTCDate(next.getUTCDate() + 1);
  } else if (frequency === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    const day = next.getUTCDate();
    next.setUTCMonth(next.getUTCMonth() + 1);
    if (next.getUTCDate() !== day) next.setUTCDate(0); // clamp to last day of target month
  }
  return next;
}

// ─── Screening via the existing gateway entry points ─────────────────────────

export const MONITORING_LISTS = ["sanctions", "pep", "watchlist"] as const;
export type MonitoringList = (typeof MONITORING_LISTS)[number];

export type ListScreeningOutcome =
  | { success: true; hits: MonitoringSnapshotHit[] }
  | { success: false; code: string; retryable: boolean };

const SANCTIONS_LIKE = /sanction|ofac|\bun\b|unsc|interpol|embargo|watchlist|terror/i;

/**
 * Normalizes one list's gateway payload into diffable snapshot hits.
 * Sanctions/watchlist payloads: { hits: [{ list, name, score, reason, programs }], clear }.
 * PEP payloads: { isPEP, roles, ... } — a positive PEP match is one hit.
 */
export function normalizeGatewayHits(listName: string, subjectName: string, payload: unknown): MonitoringSnapshotHit[] {
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  if (Array.isArray(data.hits)) {
    return (data.hits as Record<string, unknown>[]).map(h => {
      const list = String(h?.list ?? listName);
      const matchedName = String(h?.name ?? subjectName);
      return {
        hitKey: `${list}:${matchedName.trim().toLowerCase()}`,
        listName: list,
        matchedName,
        matchScore: typeof h?.score === "number" && Number.isFinite(h.score) ? h.score : null,
        status: h?.reason != null ? String(h.reason) : "active",
        severity: (SANCTIONS_LIKE.test(list) ? "critical" : "warning") as MonitoringSeverity,
      };
    });
  }
  if (data.isPEP === true) {
    const roles = Array.isArray(data.roles) ? data.roles.map(String) : [];
    return [{
      hitKey: `pep:${subjectName.trim().toLowerCase()}`,
      listName: "pep",
      matchedName: subjectName,
      matchScore: null,
      status: roles.length > 0 ? `PEP: ${roles.join(", ")}` : "Politically exposed person",
      severity: "warning",
    }];
  }
  return [];
}

/**
 * Runs the subject's current sanctions/PEP/watchlist screening via the existing
 * gateway entry points — the same endpoints used by investigation creation and
 * KYC (routers.ts gatewayFetch). Matching logic stays in the gateway; this
 * function only normalizes. Fail-closed: any unavailable list returns
 * success=false with NO hit data.
 */
export async function runListScreening(
  subjectName: string,
  listSet: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<ListScreeningOutcome> {
  // The gateway sanctions handler screens the consolidated OFAC + UN +
  // INTERPOL watchlists; 'sanctions' and 'watchlist' share that entry point.
  const endpointFor = (list: string) =>
    list === "pep" ? `/v1/pep/${encodeURIComponent(subjectName)}` : `/v1/sanctions/${encodeURIComponent(subjectName)}`;

  const byEndpoint = new Map<string, string[]>();
  for (const list of listSet) {
    const endpoint = endpointFor(list);
    byEndpoint.set(endpoint, [...(byEndpoint.get(endpoint) ?? []), list]);
  }

  const hits: MonitoringSnapshotHit[] = [];
  for (const [endpoint, lists] of Array.from(byEndpoint.entries())) {
    let res: Response;
    try {
      res = await fetchImpl(`${ENV.bisGatewayUrl}${endpoint}`, { headers: { "X-BIS-Key": ENV.bisGatewayKey } });
    } catch {
      return { success: false, code: "provider_unreachable", retryable: true };
    }
    if (!res.ok) {
      return { success: false, code: `provider_http_${res.status}`, retryable: res.status === 429 || res.status >= 500 };
    }
    const payload = await res.json().catch(() => undefined);
    if (payload === undefined) return { success: false, code: "provider_protocol_error", retryable: false };
    for (const list of lists) hits.push(...normalizeGatewayHits(list, subjectName, payload));
  }
  return { success: true, hits };
}

function buildSnapshot(hits: MonitoringSnapshotHit[], lists: string[]): MonitoringSnapshot {
  return {
    screenedAt: new Date().toISOString(),
    lists: [...lists].sort(),
    hits: hits
      .map(h => ({
        hitKey: h.hitKey,
        listName: h.listName,
        matchedName: h.matchedName,
        matchScore: h.matchScore,
        status: h.status,
        severity: h.severity,
      }))
      .sort((a, b) => a.hitKey.localeCompare(b.hitKey)),
  };
}

// ─── Tenant / storage guards ──────────────────────────────────────────────────

function requireTenant(ctx: { tenantId: number | null; user: { id: number; role?: string } | null }) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated operator is required" });
  if (!ctx.tenantId || ctx.tenantId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "An explicit tenant context is required" });
  return { tenantId: ctx.tenantId, userId: ctx.user.id, role: ctx.user.role };
}

async function poolOrFail() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Monitoring storage is unavailable" });
  return pool;
}

// ─── Audit + event fan-out (HMAC integrity hash per routers.ts precedent) ────

async function writeMonitoringAuditLog(entry: {
  tenantId: number;
  userId?: number;
  action: string;
  targetRef?: string;
  result?: "success" | "warning" | "failure";
  detail?: unknown;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const { auditLog } = await import("../drizzle/schema");
    const createdAt = new Date();
    const result = entry.result ?? "success";
    const payload = [
      String(entry.userId ?? ""),
      "investigation",
      entry.action,
      entry.targetRef ?? "",
      result,
      createdAt.toISOString(),
    ].join("|");
    const integrityHash = createHmac("sha256", ENV.auditHmacSecret).update(payload).digest("hex").slice(0, 64);
    await db.insert(auditLog).values({
      tenantId: entry.tenantId,
      userId: entry.userId,
      category: "investigation",
      action: entry.action,
      targetRef: entry.targetRef,
      result,
      detail: entry.detail as any,
      integrityHash,
      createdAt,
    });
  } catch (e) {
    console.warn("[Monitoring] Failed to write audit log:", e);
  }
}

/**
 * Publishes to the same event processor the BFF uses for investigation events.
 * Never throws — alert persistence in PostgreSQL is the durable record.
 */
export async function publishMonitoringEvent(
  eventType: string,
  subjectRef: string,
  severity: MonitoringSeverity | "info",
  payload: unknown,
): Promise<void> {
  try {
    await fetch(`${ENV.eventProcessorUrl}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
      body: JSON.stringify({
        event_type: eventType,
        subject_id: subjectRef,
        subject_ref: subjectRef,
        severity,
        payload,
        source_service: "bis-monitoring",
      }),
    });
  } catch (e) {
    console.warn("[Monitoring] Failed to publish event:", e);
  }
}

// ─── tRPC router ──────────────────────────────────────────────────────────────

const frequencySchema = z.enum(["daily", "weekly", "monthly"]);
const listSetSchema = z.array(z.enum(MONITORING_LISTS)).min(1).max(8);

export const monitoringRouter = router({
  /**
   * Enroll an investigation subject into continuous re-screening.
   * Runs the current screening synchronously to capture the baseline snapshot;
   * if screening cannot complete the enrollment fails closed (no silent
   * "watch with unknown baseline" state).
   */
  enroll: writeProcedure
    .input(z.object({
      investigationRef: z.string().min(4).max(32),
      frequency: frequencySchema,
      listSet: listSetSchema,
      subjectIdentifiers: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const client = await pool.connect();
      let enrollmentId = "";
      let subjectName = "";
      try {
        await client.query("BEGIN");
        const investigation = await client.query(
          `SELECT ref, "subjectName", nin, bvn FROM investigations
           WHERE ref = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL
           FOR SHARE`,
          [input.investigationRef, tenantId],
        );
        if (investigation.rowCount !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found in this tenant" });
        }
        const inv = investigation.rows[0] as { ref: string; subjectName: string; nin: string | null; bvn: string | null };
        subjectName = inv.subjectName;
        const duplicate = await client.query(
          `SELECT id FROM monitoring_enrollments
           WHERE tenant_id = $1 AND investigation_ref = $2 AND status <> 'cancelled'`,
          [tenantId, input.investigationRef],
        );
        if ((duplicate.rowCount ?? 0) > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "This investigation is already enrolled in monitoring" });
        }
        const identifiers = {
          ...(input.subjectIdentifiers ?? {}),
          ...(inv.nin ? { nin: inv.nin } : {}),
          ...(inv.bvn ? { bvn: inv.bvn } : {}),
        };
        // Fail-closed: baseline screening must complete before enrollment exists.
        const screening = await runListScreening(inv.subjectName, input.listSet);
        if (!screening.success) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "Baseline screening could not be completed; enrollment was not created",
          });
        }
        const baseline = buildSnapshot(screening.hits, input.listSet);
        enrollmentId = randomUUID();
        const nextRunAt = computeNextRunAt(input.frequency);
        await client.query(
          `INSERT INTO monitoring_enrollments
             (id, tenant_id, investigation_ref, subject_name, subject_identifiers, list_set, frequency, status, next_run_at, baseline_snapshot, created_by)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], $7, 'active', $8, $9::jsonb, $10)`,
          [
            enrollmentId, tenantId, input.investigationRef, inv.subjectName,
            JSON.stringify(identifiers), input.listSet, input.frequency, nextRunAt,
            JSON.stringify(baseline), userId,
          ],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      await writeMonitoringAuditLog({
        tenantId,
        userId,
        action: `Monitoring enrolled: ${input.investigationRef} (${input.frequency})`,
        targetRef: input.investigationRef,
        detail: { enrollmentId, frequency: input.frequency, listSet: input.listSet },
      });
      await publishMonitoringEvent("MONITORING_ENROLLED", input.investigationRef, "info", {
        enrollmentId,
        frequency: input.frequency,
        listSet: input.listSet,
        subjectName,
      });
      return { enrollmentId, status: "active" as const };
    }),

  pause: writeProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const result = await pool.query(
        `UPDATE monitoring_enrollments
         SET status = 'paused', next_run_at = NULL
         WHERE id = $1 AND tenant_id = $2 AND status = 'active'
         RETURNING id, investigation_ref`,
        [input.enrollmentId, tenantId],
      );
      if (result.rowCount !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "Only an active enrollment in this tenant can be paused" });
      }
      await writeMonitoringAuditLog({
        tenantId,
        userId,
        action: `Monitoring paused: ${result.rows[0].investigation_ref}`,
        targetRef: result.rows[0].investigation_ref,
        detail: { enrollmentId: input.enrollmentId },
      });
      return { enrollmentId: input.enrollmentId, status: "paused" as const };
    }),

  resume: writeProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const current = await pool.query(
        `SELECT frequency, investigation_ref FROM monitoring_enrollments
         WHERE id = $1 AND tenant_id = $2 AND status = 'paused'`,
        [input.enrollmentId, tenantId],
      );
      if (current.rowCount !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "Only a paused enrollment in this tenant can be resumed" });
      }
      const nextRunAt = computeNextRunAt(current.rows[0].frequency as MonitoringFrequency);
      await pool.query(
        `UPDATE monitoring_enrollments
         SET status = 'active', next_run_at = $3
         WHERE id = $1 AND tenant_id = $2 AND status = 'paused'`,
        [input.enrollmentId, tenantId, nextRunAt],
      );
      await writeMonitoringAuditLog({
        tenantId,
        userId,
        action: `Monitoring resumed: ${current.rows[0].investigation_ref}`,
        targetRef: current.rows[0].investigation_ref,
        detail: { enrollmentId: input.enrollmentId, nextRunAt: nextRunAt.toISOString() },
      });
      return { enrollmentId: input.enrollmentId, status: "active" as const, nextRunAt };
    }),

  cancel: writeProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const result = await pool.query(
        `UPDATE monitoring_enrollments
         SET status = 'cancelled', next_run_at = NULL
         WHERE id = $1 AND tenant_id = $2 AND status IN ('active', 'paused')
         RETURNING investigation_ref`,
        [input.enrollmentId, tenantId],
      );
      if (result.rowCount !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "Only a live enrollment in this tenant can be cancelled" });
      }
      await writeMonitoringAuditLog({
        tenantId,
        userId,
        action: `Monitoring cancelled: ${result.rows[0].investigation_ref}`,
        targetRef: result.rows[0].investigation_ref,
        detail: { enrollmentId: input.enrollmentId },
      });
      return { enrollmentId: input.enrollmentId, status: "cancelled" as const };
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.enum(["active", "paused", "cancelled"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const { tenantId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const status = input?.status ?? null;
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      const result = await pool.query(
        `SELECT id, investigation_ref, subject_name, list_set, frequency, status,
                last_run_at, next_run_at, created_by, created_at, updated_at
         FROM monitoring_enrollments
         WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)
         ORDER BY created_at DESC, id ASC
         LIMIT $3 OFFSET $4`,
        [tenantId, status, limit, offset],
      );
      const countResult = await pool.query(
        `SELECT count(*)::int AS total FROM monitoring_enrollments
         WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)`,
        [tenantId, status],
      );
      return { enrollments: result.rows, total: Number(countResult.rows[0]?.total ?? 0) };
    }),

  getEnrollment: protectedProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const { tenantId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const result = await pool.query(
        `SELECT id, investigation_ref, subject_name, subject_identifiers, list_set, frequency,
                status, last_run_at, next_run_at, baseline_snapshot, created_by, created_at, updated_at
         FROM monitoring_enrollments
         WHERE id = $1 AND tenant_id = $2`,
        [input.enrollmentId, tenantId],
      );
      if (result.rowCount !== 1) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Enrollment not found in this tenant" });
      }
      const runs = await pool.query(
        `SELECT id, started_at, finished_at, result, error, created_at
         FROM monitoring_runs
         WHERE enrollment_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC, id DESC
         LIMIT 20`,
        [input.enrollmentId, tenantId],
      );
      const alertCounts = await pool.query(
        `SELECT count(*) FILTER (WHERE acknowledged_at IS NULL)::int AS unacknowledged,
                count(*)::int AS total
         FROM monitoring_alerts
         WHERE enrollment_id = $1 AND tenant_id = $2`,
        [input.enrollmentId, tenantId],
      );
      return {
        enrollment: result.rows[0],
        runs: runs.rows,
        alerts: {
          unacknowledged: Number(alertCounts.rows[0]?.unacknowledged ?? 0),
          total: Number(alertCounts.rows[0]?.total ?? 0),
        },
      };
    }),

  /** Unacknowledged alerts first, then newest. Always tenant-scoped. */
  getAlerts: protectedProcedure
    .input(z.object({
      enrollmentId: z.string().uuid().optional(),
      unacknowledgedOnly: z.boolean().default(false),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const { tenantId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const enrollmentId = input?.enrollmentId ?? null;
      const unackOnly = input?.unacknowledgedOnly ?? false;
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      const result = await pool.query(
        `SELECT a.id, a.enrollment_id, a.run_id, a.alert_type, a.severity, a.delta,
                a.acknowledged_at, a.acknowledged_by, a.created_at,
                e.investigation_ref, e.subject_name
         FROM monitoring_alerts a
         JOIN monitoring_enrollments e ON e.id = a.enrollment_id
         WHERE a.tenant_id = $1
           AND ($2::uuid IS NULL OR a.enrollment_id = $2)
           AND ($3::boolean = false OR a.acknowledged_at IS NULL)
         ORDER BY (a.acknowledged_at IS NULL) DESC, a.created_at DESC, a.id ASC
         LIMIT $4 OFFSET $5`,
        [tenantId, enrollmentId, unackOnly, limit, offset],
      );
      return { alerts: result.rows };
    }),

  /** Acknowledge an alert. Restricted to admin/supervisor reviewers. */
  acknowledgeAlert: writeProcedure
    .input(z.object({ alertId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId, role } = requireTenant(ctx);
      if (role !== "admin" && role !== "supervisor") {
        throw new TRPCError({ code: "FORBIDDEN", message: "A designated reviewer (admin or supervisor) is required to acknowledge monitoring alerts" });
      }
      const pool = await poolOrFail();
      const result = await pool.query(
        `UPDATE monitoring_alerts
         SET acknowledged_at = NOW(), acknowledged_by = $3
         WHERE id = $1 AND tenant_id = $2 AND acknowledged_at IS NULL
         RETURNING id, enrollment_id, alert_type`,
        [input.alertId, tenantId, userId],
      );
      if (result.rowCount !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "Alert is not pending acknowledgement in this tenant" });
      }
      await writeMonitoringAuditLog({
        tenantId,
        userId,
        action: `Monitoring alert acknowledged: ${result.rows[0].alert_type}`,
        targetRef: input.alertId,
        detail: { alertId: input.alertId, enrollmentId: result.rows[0].enrollment_id },
      });
      return { alertId: input.alertId, acknowledged: true as const };
    }),
});

// ─── Scheduler execution core ─────────────────────────────────────────────────

const MAX_BATCH_SIZE = 25;

/**
 * Claims due active enrollments one at a time with FOR UPDATE SKIP LOCKED and
 * processes each in a single transaction: re-run screening, diff vs baseline,
 * insert the run row, insert alerts on delta, update baseline + next_run_at.
 * Screening failures record result='error' (fail-closed: no fabricated delta)
 * and never throw out of the loop.
 */
export async function processDueMonitoringEnrollments(limit = MAX_BATCH_SIZE): Promise<{
  claimed: number;
  changed: number;
  noChange: number;
  errors: number;
}> {
  const pool = await getPgPool();
  if (!pool) return { claimed: 0, changed: 0, noChange: 0, errors: 0 };

  const candidates = await pool.query(
    `SELECT id FROM monitoring_enrollments
     WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= NOW()
     ORDER BY next_run_at ASC, id ASC
     LIMIT $1`,
    [Math.max(1, Math.min(limit, MAX_BATCH_SIZE))],
  );

  let claimed = 0;
  let changed = 0;
  let noChange = 0;
  let errors = 0;

  for (const candidate of candidates.rows as Array<{ id: string }>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT id, tenant_id, investigation_ref, subject_name, subject_identifiers,
                list_set, frequency, status, baseline_snapshot
         FROM monitoring_enrollments
         WHERE id = $1 AND status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= NOW()
         FOR UPDATE SKIP LOCKED`,
        [candidate.id],
      );
      if (locked.rowCount !== 1) {
        // Another worker claimed it between candidate listing and locking.
        await client.query("ROLLBACK");
        continue;
      }
      claimed++;
      const enrollment = locked.rows[0] as EnrollmentRow;
      const startedAt = new Date();

      const screening = await runListScreening(enrollment.subject_name, enrollment.list_set);
      if (!screening.success) {
        // Fail-closed: record the error, keep the baseline, retry next cadence.
        await client.query(
          `INSERT INTO monitoring_runs (tenant_id, enrollment_id, started_at, finished_at, result, snapshot, error)
           VALUES ($1, $2, $3, NOW(), 'error', NULL, $4)`,
          [enrollment.tenant_id, enrollment.id, startedAt, `screening_failed:${screening.code}`],
        );
        await client.query(
          `UPDATE monitoring_enrollments
           SET last_run_at = NOW(), next_run_at = $2
           WHERE id = $1`,
          [enrollment.id, computeNextRunAt(enrollment.frequency)],
        );
        await client.query("COMMIT");
        errors++;
        continue;
      }

      const snapshot = buildSnapshot(screening.hits, enrollment.list_set);
      const baseline = enrollment.baseline_snapshot ?? { screenedAt: "", lists: enrollment.list_set, hits: [] };
      const delta = diffSnapshots(baseline, snapshot);
      const deltaFound = hasDelta(delta);

      const runInsert = await client.query(
        `INSERT INTO monitoring_runs (tenant_id, enrollment_id, started_at, finished_at, result, snapshot, error)
         VALUES ($1, $2, $3, NOW(), $4, $5::jsonb, NULL)
         RETURNING id`,
        [
          enrollment.tenant_id, enrollment.id, startedAt,
          deltaFound ? "change_detected" : "no_change",
          JSON.stringify(snapshot),
        ],
      );
      const runId = runInsert.rows[0]?.id ?? null;

      const alertsToRaise: Array<{ type: MonitoringAlertType; severity: MonitoringSeverity; delta: unknown }> = [];
      for (const hit of delta.newHits) {
        alertsToRaise.push({ type: "new_hit", severity: hit.severity, delta: { hit } });
      }
      for (const change of delta.changedHits) {
        alertsToRaise.push({ type: "status_change", severity: "warning", delta: change });
      }
      for (const hit of delta.removedHits) {
        alertsToRaise.push({ type: "removed_hit", severity: "info", delta: { hit } });
      }
      for (const alert of alertsToRaise) {
        await client.query(
          `INSERT INTO monitoring_alerts (id, tenant_id, enrollment_id, run_id, alert_type, severity, delta)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [randomUUID(), enrollment.tenant_id, enrollment.id, runId, alert.type, alert.severity, JSON.stringify(alert.delta)],
        );
      }

      await client.query(
        `UPDATE monitoring_enrollments
         SET last_run_at = NOW(), next_run_at = $2, baseline_snapshot = $3::jsonb
         WHERE id = $1`,
        [enrollment.id, computeNextRunAt(enrollment.frequency), JSON.stringify(snapshot)],
      );
      await client.query("COMMIT");

      if (deltaFound) {
        changed++;
        const critical = delta.newHits.some(h => h.severity === "critical");
        await publishMonitoringEvent(
          "MONITORING_ALERT",
          enrollment.investigation_ref,
          critical ? "critical" : "warning",
          {
            enrollmentId: enrollment.id,
            runId,
            newHits: delta.newHits.length,
            removedHits: delta.removedHits.length,
            changedHits: delta.changedHits.length,
            criticalNewHit: critical,
          },
        );
        await writeMonitoringAuditLog({
          tenantId: enrollment.tenant_id,
          action: `Monitoring change detected: ${enrollment.investigation_ref}`,
          targetRef: enrollment.investigation_ref,
          result: critical ? "warning" : "success",
          detail: {
            enrollmentId: enrollment.id,
            runId,
            newHits: delta.newHits.map(h => h.hitKey),
            removedHits: delta.removedHits.map(h => h.hitKey),
            changedHits: delta.changedHits.map(c => c.after.hitKey),
          },
        });
      } else {
        noChange++;
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      errors++;
      console.warn("[Monitoring] Enrollment run failed:", error instanceof Error ? error.message : "unknown");
    } finally {
      client.release();
    }
  }

  return { claimed, changed, noChange, errors };
}
