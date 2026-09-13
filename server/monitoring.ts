/**
 * WP2 — Ongoing Monitoring Engine
 *
 * Continuous re-screening of investigation subjects against sanctions / PEP /
 * watchlist sources (closes the ComplyAdvantage ongoing-monitoring / Checkr
 * Continuous-Crim gap).
 *
 * Design rules:
 *   - Re-screening reuses the EXISTING screening entry points (gateway
 *     /v1/sanctions/:name and /v1/pep/:name) — no matching logic is
 *     reimplemented here.
 *   - Fail-closed: if any monitored list provider is unavailable, the run is
 *     recorded as result='error' and enrollment is refused without a baseline.
 *   - Every query is tenant-scoped; enrollment validates the investigation
 *     belongs to the caller's tenant.
 *   - All per-enrollment work happens in ONE transaction (see
 *     processDueEnrollment in monitoringScheduler.ts).
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, writeProcedure } from "./_core/trpc";
import { ENV } from "./_core/env";
import { getPgPool } from "./db";

const GATEWAY_URL = ENV.bisGatewayUrl;
const GATEWAY_KEY = ENV.bisGatewayKey;
const EVENT_PROCESSOR_URL = ENV.eventProcessorUrl;

// ─── Pure helpers (unit-tested) ───────────────────────────────────────────────

export const MONITORING_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type MonitoringFrequency = (typeof MONITORING_FREQUENCIES)[number];

export const MONITORING_LISTS = ["sanctions", "pep", "watchlist"] as const;
export type MonitoringList = (typeof MONITORING_LISTS)[number];

/** next_run_at math, computed in UTC from `from`. */
export function computeNextRunAt(frequency: MonitoringFrequency, from: Date = new Date()): Date {
  const next = new Date(from.getTime());
  if (frequency === "daily") next.setUTCDate(next.getUTCDate() + 1);
  else if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export interface SnapshotHit {
  hitId: string;
  list: string;
  name: string;
  score: number | null;
  reason: string | null;
  programs: string[];
}

export interface MonitoringSnapshot {
  subjectName: string;
  checkedAt: string;
  lists: Record<string, { clear: boolean; hits: SnapshotHit[] }>;
}

function stableHitId(list: string, name: string, programs: string[]): string {
  return createHash("sha256")
    .update([list, name.trim().toLowerCase(), [...programs].sort().join(",")].join("|"))
    .digest("hex")
    .slice(0, 24);
}

/**
 * Normalize one list's gateway response into snapshot hits.
 * Sanctions/watchlist payloads: { hits: [{ list, name, score, reason, programs }], clear }
 * PEP payloads: { isPEP, roles, party, country } — a positive PEP match is a hit.
 */
export function normalizeListHits(listName: string, payload: any): SnapshotHit[] {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.hits)) {
    return payload.hits.map((h: any) => ({
      hitId: stableHitId(h.list ?? listName, String(h.name ?? ""), Array.isArray(h.programs) ? h.programs.map(String) : []),
      list: String(h.list ?? listName),
      name: String(h.name ?? ""),
      score: typeof h.score === "number" ? h.score : null,
      reason: h.reason != null ? String(h.reason) : null,
      programs: Array.isArray(h.programs) ? h.programs.map(String) : [],
    }));
  }
  if (payload.isPEP === true) {
    const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
    return [{
      hitId: stableHitId("pep", String(payload.queried ?? listName), roles),
      list: "pep",
      name: String(payload.queried ?? ""),
      score: null,
      reason: roles.length > 0 ? `PEP: ${roles.join(", ")}` : "Politically exposed person",
      programs: roles,
    }];
  }
  return [];
}

/** Build the snapshot stored as baseline / per-run from per-list payloads. */
export function buildSnapshot(subjectName: string, perList: Record<string, any>): MonitoringSnapshot {
  const lists: MonitoringSnapshot["lists"] = {};
  for (const [listName, payload] of Object.entries(perList)) {
    const hits = normalizeListHits(listName, payload);
    const clear = payload && typeof payload === "object" && "clear" in payload ? Boolean(payload.clear) : hits.length === 0;
    lists[listName] = { clear, hits };
  }
  return { subjectName, checkedAt: new Date().toISOString(), lists };
}

export interface SnapshotDelta {
  newHits: SnapshotHit[];
  removedHits: SnapshotHit[];
  statusChanges: Array<{ before: SnapshotHit; after: SnapshotHit }>;
}

/** Diff a baseline snapshot against a fresh one. */
export function diffSnapshots(baseline: MonitoringSnapshot | null, current: MonitoringSnapshot): SnapshotDelta {
  const delta: SnapshotDelta = { newHits: [], removedHits: [], statusChanges: [] };
  const baseHits = new Map<string, SnapshotHit>();
  if (baseline?.lists) {
    for (const l of Object.values(baseline.lists)) for (const h of l.hits ?? []) baseHits.set(h.hitId, h);
  }
  const curHits = new Map<string, SnapshotHit>();
  for (const l of Object.values(current.lists)) for (const h of l.hits) curHits.set(h.hitId, h);

  curHits.forEach((hit, hitId) => {
    const before = baseHits.get(hitId);
    if (!before) delta.newHits.push(hit);
    else if (before.score !== hit.score || before.reason !== hit.reason) {
      delta.statusChanges.push({ before, after: hit });
    }
  });
  baseHits.forEach((hit, hitId) => {
    if (!curHits.has(hitId)) delta.removedHits.push(hit);
  });
  return delta;
}

export function hasDelta(d: SnapshotDelta): boolean {
  return d.newHits.length > 0 || d.removedHits.length > 0 || d.statusChanges.length > 0;
}

/** Alert severity: a new sanctions/watchlist hit is critical. */
export function alertSeverity(alertType: "new_hit" | "status_change" | "removed_hit", hit: SnapshotHit): string {
  if (alertType === "new_hit") return hit.list === "pep" ? "high" : "critical";
  if (alertType === "status_change") return "warning";
  return "info";
}

// ─── Screening entry point (reuses the existing gateway pipeline) ────────────

/**
 * Run the subject's current sanctions/PEP/watchlist screening via the existing
 * gateway entry points — the same endpoints used by the investigations KYC and
 * data-bundle flows. Fail-closed: throws if any monitored list is unavailable.
 */
export async function runListScreening(
  subjectName: string,
  listSet: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, any>> {
  // The gateway sanctions handler screens the consolidated OFAC + UN +
  // INTERPOL watchlists; 'sanctions' and 'watchlist' share that entry point.
  const endpointFor = (list: string) =>
    list === "pep" ? `/v1/pep/${encodeURIComponent(subjectName)}` : `/v1/sanctions/${encodeURIComponent(subjectName)}`;

  const byEndpoint = new Map<string, string[]>();
  for (const list of listSet) {
    const ep = endpointFor(list);
    byEndpoint.set(ep, [...(byEndpoint.get(ep) ?? []), list]);
  }

  const perList: Record<string, any> = {};
  for (const [endpoint, lists] of Array.from(byEndpoint.entries())) {
    let res;
    try {
      res = await fetchImpl(`${GATEWAY_URL}${endpoint}`, { headers: { "X-BIS-Key": GATEWAY_KEY } });
    } catch (e) {
      throw new Error(`Screening provider unreachable for ${lists.join("/")}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new Error(`Screening provider for ${lists.join("/")} returned HTTP ${res.status} (fail-closed)`);
    const payload = await res.json();
    for (const list of lists) perList[list] = payload;
  }
  return perList;
}

// ─── Event + audit helpers (mirrors server/routers.ts conventions) ────────────

export async function publishMonitoringEvent(eventType: string, subjectRef: string, severity: string, payload: unknown): Promise<void> {
  try {
    await fetch(`${EVENT_PROCESSOR_URL}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BIS-Key": GATEWAY_KEY },
      body: JSON.stringify({ event_type: eventType, subject_id: subjectRef, subject_ref: subjectRef, severity, payload, source_service: "bis-bff" }),
    });
  } catch (e) {
    console.warn("[Monitoring] Failed to publish event:", e);
  }
}

type SqlClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

/**
 * Tamper-evident audit log insert (HMAC-SHA256 integrity hash), executed on the
 * caller's transaction client so the audit trail is atomic with the mutation.
 */
export async function writeMonitoringAuditLog(
  client: SqlClient,
  entry: {
    tenantId: number | null;
    userId?: number | null;
    userEmail?: string;
    category: "investigation" | "alert" | "system";
    action: string;
    targetRef?: string;
    result?: "success" | "warning" | "failure";
    detail?: unknown;
  },
): Promise<void> {
  const result = entry.result ?? "success";
  const createdAt = new Date();
  const payload = [String(entry.userId ?? ""), entry.category, entry.action, entry.targetRef ?? "", result, createdAt.toISOString()].join("|");
  const integrityHash = createHmac("sha256", ENV.auditHmacSecret).update(payload).digest("hex").slice(0, 64);
  await client.query(
    `INSERT INTO audit_log ("tenantId", "userId", "userEmail", category, action, "targetRef", result, detail, "integrityHash", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
    [entry.tenantId, entry.userId ?? null, entry.userEmail ?? null, entry.category, entry.action, entry.targetRef ?? null, result, entry.detail != null ? JSON.stringify(entry.detail) : null, integrityHash, createdAt],
  );
}

// ─── Shared context guard ─────────────────────────────────────────────────────

function requireTenant(ctx: { tenantId: number | null; user: { id: number; role?: string; email?: string | null } | null }) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated operator is required" });
  if (!ctx.tenantId || ctx.tenantId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "An explicit tenant context is required" });
  return { tenantId: ctx.tenantId, userId: ctx.user.id, role: ctx.user.role, userEmail: ctx.user.email ?? undefined };
}

async function poolOrFail() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Monitoring storage is unavailable" });
  return pool;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const monitoringRouter = router({
  /**
   * Enroll an investigation subject in ongoing monitoring.
   * Validates tenant ownership of the investigation, runs the current
   * sanctions/PEP/watchlist screening to capture a baseline snapshot, and
   * schedules the first re-run. Transactional; fail-closed.
   */
  enroll: writeProcedure
    .input(z.object({
      investigationRef: z.string().min(4).max(64),
      listSet: z.array(z.enum(MONITORING_LISTS)).min(1).max(3),
      frequency: z.enum(MONITORING_FREQUENCIES),
      subjectIdentifiers: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId, userEmail } = requireTenant(ctx);
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const inv = await client.query(
          `SELECT ref, "subjectName", nin, bvn, "rcNumber" FROM investigations WHERE ref = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
          [input.investigationRef, tenantId],
        );
        if (inv.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found in this tenant" });
        const subjectName: string = inv.rows[0].subjectName;
        const existing = await client.query(
          `SELECT id FROM monitoring_enrollments WHERE tenant_id = $1 AND investigation_ref = $2 AND status <> 'cancelled' LIMIT 1`,
          [tenantId, input.investigationRef],
        );
        if (existing.rowCount && existing.rowCount > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "An active or paused enrollment already exists for this investigation" });
        }
        // Baseline: run the existing screening pipeline (fail-closed).
        const perList = await runListScreening(subjectName, input.listSet);
        const baseline = buildSnapshot(subjectName, perList);
        const nextRunAt = computeNextRunAt(input.frequency);
        const id = randomUUID();
        const identifiers = {
          ...(input.subjectIdentifiers ?? {}),
          ...(inv.rows[0].nin ? { nin: inv.rows[0].nin } : {}),
          ...(inv.rows[0].bvn ? { bvn: inv.rows[0].bvn } : {}),
          ...(inv.rows[0].rcNumber ? { rcNumber: inv.rows[0].rcNumber } : {}),
        };
        await client.query(
          `INSERT INTO monitoring_enrollments
             (id, tenant_id, investigation_ref, subject_name, subject_identifiers, list_set, frequency, status, last_run_at, next_run_at, baseline_snapshot, created_by)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], $7, 'active', now(), $8, $9::jsonb, $10)`,
          [id, tenantId, input.investigationRef, subjectName, JSON.stringify(identifiers), input.listSet, input.frequency, nextRunAt, JSON.stringify(baseline), userId],
        );
        await writeMonitoringAuditLog(client, {
          tenantId, userId, userEmail, category: "investigation",
          action: `Monitoring enrolled (${input.frequency}; lists: ${input.listSet.join(", ")})`,
          targetRef: input.investigationRef,
          detail: { enrollmentId: id, listSet: input.listSet, frequency: input.frequency, baselineHitCount: Object.values(baseline.lists).reduce((n, l) => n + l.hits.length, 0) },
        });
        await client.query("COMMIT");
        return { enrollmentId: id, status: "active" as const, nextRunAt, baseline };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }),

  /** Pause an active enrollment. */
  pause: writeProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => setEnrollmentStatus(ctx, input.enrollmentId, "active", "paused")),

  /** Resume a paused enrollment (recomputes next_run_at from now). */
  resume: writeProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => setEnrollmentStatus(ctx, input.enrollmentId, "paused", "active")),

  /** Cancel an enrollment (terminal). */
  cancel: writeProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => setEnrollmentStatus(ctx, input.enrollmentId, null, "cancelled")),

  /** Tenant-scoped enrollment list with filters. */
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["active", "paused", "cancelled"]).optional(),
      frequency: z.enum(MONITORING_FREQUENCIES).optional(),
      investigationRef: z.string().max(64).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const { tenantId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const conditions = ["tenant_id = $1"];
      const params: unknown[] = [tenantId];
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      if (input?.frequency) { params.push(input.frequency); conditions.push(`frequency = $${params.length}`); }
      if (input?.investigationRef) { params.push(input.investigationRef); conditions.push(`investigation_ref = $${params.length}`); }
      params.push(input?.limit ?? 50, input?.offset ?? 0);
      const result = await pool.query(
        `SELECT id, tenant_id, investigation_ref, subject_name, list_set, frequency, status, last_run_at, next_run_at, created_by, created_at, updated_at
         FROM monitoring_enrollments WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { enrollments: result.rows };
    }),

  /** One enrollment plus its last N runs (tenant-scoped). */
  getEnrollment: protectedProcedure
    .input(z.object({ enrollmentId: z.string().uuid(), runLimit: z.number().int().min(1).max(100).default(10) }))
    .query(async ({ input, ctx }) => {
      const { tenantId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const enrollment = await pool.query(
        `SELECT * FROM monitoring_enrollments WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [input.enrollmentId, tenantId],
      );
      if (enrollment.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Enrollment not found in this tenant" });
      const runs = await pool.query(
        `SELECT id, started_at, finished_at, result, error, created_at FROM monitoring_runs
         WHERE enrollment_id = $1 ORDER BY started_at DESC LIMIT $2`,
        [input.enrollmentId, input.runLimit],
      );
      return { enrollment: enrollment.rows[0], runs: runs.rows };
    }),

  /** Tenant-scoped alerts, unacknowledged first. */
  getAlerts: protectedProcedure
    .input(z.object({
      enrollmentId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(200).default(100),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const { tenantId } = requireTenant(ctx);
      const pool = await poolOrFail();
      const conditions = ["tenant_id = $1"];
      const params: unknown[] = [tenantId];
      if (input?.enrollmentId) { params.push(input.enrollmentId); conditions.push(`enrollment_id = $${params.length}`); }
      params.push(input?.limit ?? 100, input?.offset ?? 0);
      const result = await pool.query(
        `SELECT id, tenant_id, enrollment_id, alert_type, severity, delta, acknowledged_at, acknowledged_by, created_at
         FROM monitoring_alerts WHERE ${conditions.join(" AND ")}
         ORDER BY (acknowledged_at IS NULL) DESC, created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { alerts: result.rows };
    }),

  /** Acknowledge an alert — admin or supervisor only. */
  acknowledgeAlert: writeProcedure
    .input(z.object({ alertId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId, userId, userEmail, role } = requireTenant(ctx);
      if (role !== "admin" && role !== "supervisor") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admin or supervisor roles may acknowledge monitoring alerts" });
      }
      const pool = await poolOrFail();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `UPDATE monitoring_alerts SET acknowledged_at = now(), acknowledged_by = $1
           WHERE id = $2 AND tenant_id = $3 AND acknowledged_at IS NULL
           RETURNING id, enrollment_id, alert_type`,
          [userId, input.alertId, tenantId],
        );
        if (result.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found or already acknowledged" });
        await writeMonitoringAuditLog(client, {
          tenantId, userId, userEmail, category: "alert",
          action: `Monitoring alert acknowledged (${result.rows[0].alert_type})`,
          targetRef: input.alertId,
          detail: { enrollmentId: result.rows[0].enrollment_id },
        });
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

/** Shared pause/resume/cancel state machine. */
async function setEnrollmentStatus(
  ctx: { tenantId: number | null; user: { id: number; role?: string; email?: string | null } | null },
  enrollmentId: string,
  from: "active" | "paused" | null,
  to: "active" | "paused" | "cancelled",
) {
  const { tenantId, userId, userEmail } = requireTenant(ctx);
  const pool = await poolOrFail();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, status, frequency, investigation_ref FROM monitoring_enrollments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [enrollmentId, tenantId],
    );
    if (current.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Enrollment not found in this tenant" });
    const row = current.rows[0];
    const allowedFrom: string[] = from === null ? ["active", "paused"] : [from];
    if (!allowedFrom.includes(row.status)) {
      throw new TRPCError({ code: "CONFLICT", message: `Cannot move enrollment from '${row.status}' to '${to}'` });
    }
    if (to === "active") {
      // Resume: recompute next_run_at from now per the enrollment frequency.
      await client.query(
        `UPDATE monitoring_enrollments SET status = 'active', next_run_at = $1, updated_at = now() WHERE id = $2`,
        [computeNextRunAt(row.frequency as MonitoringFrequency), enrollmentId],
      );
    } else {
      await client.query(`UPDATE monitoring_enrollments SET status = $1, updated_at = now() WHERE id = $2`, [to, enrollmentId]);
    }
    await writeMonitoringAuditLog(client, {
      tenantId, userId, userEmail, category: "investigation",
      action: `Monitoring enrollment ${to}`,
      targetRef: row.investigation_ref,
      detail: { enrollmentId, from: row.status, to },
    });
    await client.query("COMMIT");
    return { enrollmentId, status: to };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
