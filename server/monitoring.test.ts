/**
 * server/monitoring.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Ongoing-monitoring engine coverage:
 *
 *   - diff detection: new hit / removed hit / status change / no change
 *   - frequency → next_run_at math (daily / weekly / monthly)
 *   - enroll: tenant isolation (cross-tenant investigation is rejected),
 *     baseline snapshot stored, next_run_at scheduled per frequency
 *   - state machine: pause → resume → cancel (terminal)
 *   - scheduler: due-enrollment claim re-screens via the real screening code,
 *     raises monitoring_alerts + MONITORING_ALERT fan-out (critical severity
 *     for a new sanctions hit), records no-change runs, and fails closed into
 *     result='error' runs when a provider is unavailable
 *   - acknowledgeAlert: admin/supervisor only, tenant-scoped, single-ack
 *
 * The pg pool is replaced by a stateful in-memory handler that executes the
 * real SQL strings issued by monitoring.ts / monitoringScheduler.ts (same
 * precedent as server/share-subscribe.test.ts). External HTTP boundaries
 * (gateway sanctions/PEP, verify watchlist, event processor) are intercepted
 * with a stubbed global fetch; all business logic under test is production
 * code.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.BIS_GATEWAY_URL = "http://gateway.test";
  process.env.BIS_GATEWAY_KEY = "monitoring-test-key";
  process.env.EVENT_PROCESSOR_URL = "http://events.test";
  process.env.BIS_VERIFY_CAC_URL = "http://verify.test/api";
  process.env.BIS_VERIFY_CAC_KEY = "monitoring-test-verify-key";
  process.env.AUDIT_HMAC_SECRET = "monitoring-test-audit-secret";
  process.env.JWT_SECRET = "monitoring-test-jwt-secret";
});

// ─── Stateful in-memory PostgreSQL ────────────────────────────────────────────

type Row = Record<string, any>;

function makeState() {
  return {
    investigations: new Map<string, Row>(),
    enrollments: [] as Row[],
    runs: [] as Row[],
    alerts: [] as Row[],
    auditLog: [] as Row[],
  };
}

type State = ReturnType<typeof makeState>;

function rows(list: Row[]) {
  return { rows: list, rowCount: list.length };
}

let uuidCounter = 0;
function nextUuid() {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

function fakeQuery(state: State) {
  return async (text: string, values: unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> => {
    const sql = text.replace(/\s+/g, " ").trim();
    const upper = sql.toUpperCase();
    if (upper === "BEGIN" || upper === "COMMIT" || upper === "ROLLBACK") return rows([]);

    // ── investigations ──────────────────────────────────────────────────────
    if (sql.startsWith("SELECT id FROM investigations")) {
      const inv = state.investigations.get(String(values[0]));
      return rows(inv && inv.tenantId === values[1] && !inv.deletedAt ? [{ id: inv.id }] : []);
    }

    // ── monitoring_enrollments ──────────────────────────────────────────────
    if (sql.startsWith("INSERT INTO monitoring_enrollments")) {
      const [id, tenantId, investigationRef, subjectName, identifiers, listSet, frequency, nextRunAt, baseline, createdBy] = values as any[];
      if (state.enrollments.some((e) => e.tenant_id === tenantId && e.investigation_ref === investigationRef && e.subject_name === subjectName && ["active", "paused"].includes(e.status))) {
        const err = new Error("duplicate key value violates unique constraint") as any;
        err.code = "23505";
        throw err;
      }
      const row = {
        id, tenant_id: tenantId, investigation_ref: investigationRef, subject_name: subjectName,
        subject_identifiers: JSON.parse(identifiers), list_set: listSet, frequency, status: "active",
        last_run_at: null, next_run_at: nextRunAt, baseline_snapshot: JSON.parse(baseline),
        created_by: createdBy, created_at: new Date(), updated_at: new Date(),
      };
      state.enrollments.push(row);
      return rows([]);
    }
    if (sql.startsWith("SELECT id, tenant_id, investigation_ref, subject_name, subject_identifiers, list_set, frequency, baseline_snapshot, created_by FROM monitoring_enrollments")) {
      const now = Date.now();
      const dueList = state.enrollments
        .filter((e) => e.status === "active" && new Date(e.next_run_at).getTime() <= now)
        .sort((a, b) => new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime());
      return rows(dueList.slice(0, 1));
    }
    if (sql.startsWith("SELECT frequency, investigation_ref FROM monitoring_enrollments")) {
      const enr = state.enrollments.find((e) => e.id === values[0] && e.tenant_id === values[1] && e.status === "paused");
      return rows(enr ? [{ frequency: enr.frequency, investigation_ref: enr.investigation_ref }] : []);
    }
    if (sql.startsWith("UPDATE monitoring_enrollments SET status = 'paused'")) {
      const enr = state.enrollments.find((e) => e.id === values[0] && e.tenant_id === values[1] && e.status === "active");
      if (!enr) return rows([]);
      enr.status = "paused";
      return rows([{ investigation_ref: enr.investigation_ref }]);
    }
    if (sql.startsWith("UPDATE monitoring_enrollments SET status = 'active', next_run_at")) {
      const enr = state.enrollments.find((e) => e.id === values[0] && e.tenant_id === values[2]);
      if (!enr) return rows([]);
      enr.status = "active";
      enr.next_run_at = values[1];
      return rows([]);
    }
    if (sql.startsWith("UPDATE monitoring_enrollments SET status = 'cancelled'")) {
      const enr = state.enrollments.find((e) => e.id === values[0] && e.tenant_id === values[1] && ["active", "paused"].includes(e.status));
      if (!enr) return rows([]);
      enr.status = "cancelled";
      return rows([{ investigation_ref: enr.investigation_ref }]);
    }
    if (sql.startsWith("UPDATE monitoring_enrollments SET baseline_snapshot")) {
      const enr = state.enrollments.find((e) => e.id === values[0] && e.status === "active");
      if (!enr) return rows([]);
      enr.baseline_snapshot = JSON.parse(values[1] as string);
      enr.last_run_at = new Date();
      enr.next_run_at = values[2];
      return rows([]);
    }
    if (sql.startsWith("UPDATE monitoring_enrollments SET last_run_at = now(), next_run_at")) {
      const enr = state.enrollments.find((e) => e.id === values[0] && e.status === "active");
      if (!enr) return rows([]);
      enr.last_run_at = new Date();
      enr.next_run_at = values[1];
      return rows([]);
    }
    if (sql.startsWith("SELECT * FROM monitoring_enrollments WHERE id = $1 AND tenant_id = $2")) {
      const enr = state.enrollments.find((e) => e.id === values[0] && e.tenant_id === values[1]);
      return rows(enr ? [enr] : []);
    }
    if (sql.startsWith("SELECT * FROM monitoring_enrollments")) {
      const [tenantId, status, limit, offset] = values as any[];
      const list = state.enrollments
        .filter((e) => e.tenant_id === tenantId && (status === null || e.status === status))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return rows(list.slice(offset, offset + limit));
    }
    if (sql.startsWith("SELECT count(*)::int AS total FROM monitoring_enrollments")) {
      const [tenantId, status] = values as any[];
      const total = state.enrollments.filter((e) => e.tenant_id === tenantId && (status === null || e.status === status)).length;
      return rows([{ total }]);
    }

    // ── monitoring_runs ─────────────────────────────────────────────────────
    if (sql.startsWith("INSERT INTO monitoring_runs")) {
      if (sql.includes("result, snapshot)")) {
        const [enrollmentId, result, snapshot] = values as any[];
        state.runs.push({ id: nextUuid(), enrollment_id: enrollmentId, started_at: new Date(), finished_at: new Date(), result, snapshot: JSON.parse(snapshot), error: null });
      } else {
        const [enrollmentId, error] = values as any[];
        state.runs.push({ id: nextUuid(), enrollment_id: enrollmentId, started_at: new Date(), finished_at: new Date(), result: "error", snapshot: null, error });
      }
      return rows([]);
    }
    if (sql.startsWith("SELECT id, started_at, finished_at, result, error FROM monitoring_runs")) {
      const list = state.runs
        .filter((r) => r.enrollment_id === values[0])
        .sort((a, b) => b.started_at.getTime() - a.started_at.getTime());
      return rows(list.slice(0, values[1] as number));
    }

    // ── monitoring_alerts ───────────────────────────────────────────────────
    if (sql.startsWith("INSERT INTO monitoring_alerts")) {
      const [tenantId, enrollmentId, alertType, severity, delta] = values as any[];
      state.alerts.push({ id: nextUuid(), tenant_id: tenantId, enrollment_id: enrollmentId, alert_type: alertType, severity, delta: JSON.parse(delta), acknowledged_at: null, acknowledged_by: null, created_at: new Date() });
      return rows([]);
    }
    if (sql.startsWith("SELECT id, enrollment_id, alert_type, severity, delta, acknowledged_at, acknowledged_by, created_at FROM monitoring_alerts")) {
      const [tenantId, enrollmentId, includeAcknowledged, limit, offset] = values as any[];
      const list = state.alerts
        .filter((a) => a.tenant_id === tenantId && (enrollmentId === null || a.enrollment_id === enrollmentId) && (includeAcknowledged || a.acknowledged_at === null))
        .sort((a, b) => Number(a.acknowledged_at !== null) - Number(b.acknowledged_at !== null) || b.created_at.getTime() - a.created_at.getTime());
      return rows(list.slice(offset, offset + limit));
    }
    if (sql.startsWith("UPDATE monitoring_alerts SET acknowledged_at")) {
      const alert = state.alerts.find((a) => a.id === values[0] && a.tenant_id === values[2] && a.acknowledged_at === null);
      if (!alert) return rows([]);
      alert.acknowledged_at = new Date();
      alert.acknowledged_by = values[1];
      return rows([{ enrollment_id: alert.enrollment_id }]);
    }

    // ── audit_log ───────────────────────────────────────────────────────────
    if (sql.startsWith("INSERT INTO audit_log")) {
      state.auditLog.push({ tenantId: values[0], userId: values[1], action: values[2], targetRef: values[3], result: values[4] });
      return rows([]);
    }

    throw new Error(`fakeQuery: unmatched SQL: ${sql}`);
  };
}

const mocks = vi.hoisted(() => {
  const state = makeState();
  const query = vi.fn(fakeQuery(state));
  const connect = vi.fn(async () => ({ query, release: vi.fn() }));
  const getPgPool = vi.fn(async () => ({ query, connect }));
  return { state, query, connect, getPgPool };
});

vi.mock("./db", () => ({ getPgPool: mocks.getPgPool }));
vi.mock("./permify", () => ({ permifyCheck: vi.fn(async () => true) }));

// ─── External HTTP boundary (gateway / verify / event processor) ─────────────

type SanctionsBehaviour =
  | { kind: "hits"; hits: Row[] }
  | { kind: "unavailable" };

const http = vi.hoisted(() => ({
  sanctions: { kind: "hits", hits: [] as Row[] } as SanctionsBehaviour,
  pepIsPep: false,
  watchlistHit: false,
  events: [] as Row[],
}));

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://gateway.test/v1/sanctions/")) {
      if (http.sanctions.kind === "unavailable") return jsonResponse({ error: "SANCTIONS_PROVIDER_UNAVAILABLE" }, 503);
      const { hits } = http.sanctions;
      return jsonResponse({ queried: decodeURIComponent(url.split("/v1/sanctions/")[1]), hits, clear: hits.length === 0, checkedAt: new Date().toISOString() });
    }
    if (url.startsWith("http://gateway.test/v1/pep/")) {
      return jsonResponse({ queried: "x", isPEP: http.pepIsPep, roles: [], checkedAt: new Date().toISOString() });
    }
    if (url.startsWith("http://verify.test/api")) {
      return jsonResponse({ hit: http.watchlistHit });
    }
    if (url.startsWith("http://events.test/v1/events")) {
      http.events.push(JSON.parse(String(init?.body ?? "{}")));
      return jsonResponse({ accepted: true });
    }
    throw new Error(`stubFetch: unexpected URL ${url} ${init?.method ?? "GET"}`);
  }));
}

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { monitoringRouter, diffSnapshots, nextRunAt, scoreBand, type MonitoringSnapshot } from "./monitoring";
import { processDueMonitoringEnrollments } from "./monitoringScheduler";
import type { TrpcContext } from "./_core/context";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REF = "BIS-2026-MON001";

function makeCtx(tenantId: number | null, userId = 10, role = "admin"): TrpcContext {
  return {
    user: { id: userId, openId: `mon-user-${userId}`, email: `mon-user-${userId}@example.invalid`, name: "Monitoring Operator", role, tenantId } as any,
    tenantId,
    isDemo: false,
    authMethod: "keycloak",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function resetState() {
  mocks.state.investigations.clear();
  mocks.state.enrollments.length = 0;
  mocks.state.runs.length = 0;
  mocks.state.alerts.length = 0;
  mocks.state.auditLog.length = 0;
  mocks.query.mockClear();
  http.sanctions = { kind: "hits", hits: [] };
  http.pepIsPep = false;
  http.watchlistHit = false;
  http.events.length = 0;
}

function seedInvestigation(ref: string, tenantId: number, id = 42) {
  mocks.state.investigations.set(ref, { id, tenantId, deletedAt: null });
}

async function enrollJohnDoe(tenantId = 1, frequency: "daily" | "weekly" | "monthly" = "daily") {
  seedInvestigation(REF, tenantId);
  const caller = monitoringRouter.createCaller(makeCtx(tenantId));
  return caller.enroll({ investigationRef: REF, subjectName: "JOHN DOE", frequency });
}

function forceDue(enrollmentId: string) {
  const enr = mocks.state.enrollments.find((e) => e.id === enrollmentId);
  enr!.next_run_at = new Date(Date.now() - 60_000);
}

// ─── Pure diff / schedule math ────────────────────────────────────────────────

describe("diffSnapshots", () => {
  const snap = (hits: MonitoringSnapshot["hits"]): MonitoringSnapshot => ({ subjectName: "JOHN DOE", screenedAt: new Date().toISOString(), hits });

  it("detects no change for identical snapshots", () => {
    const baseline = snap([{ id: "a", list: "sanctions", matchedName: "JOHN DOE", status: "high", score: 95 }]);
    const delta = diffSnapshots(baseline, snap([{ id: "a", list: "sanctions", matchedName: "JOHN DOE", status: "high", score: 95 }]));
    expect(delta.changed).toBe(false);
    expect(delta.newHits).toHaveLength(0);
    expect(delta.removedHits).toHaveLength(0);
    expect(delta.statusChanges).toHaveLength(0);
  });

  it("detects a new hit", () => {
    const delta = diffSnapshots(snap([]), snap([{ id: "b", list: "sanctions", matchedName: "JOHN DOE", status: "high" }]));
    expect(delta.changed).toBe(true);
    expect(delta.newHits.map((h) => h.id)).toEqual(["b"]);
  });

  it("detects a removed hit", () => {
    const delta = diffSnapshots(snap([{ id: "b", list: "pep", matchedName: "JOHN DOE", status: "hit" }]), snap([]));
    expect(delta.changed).toBe(true);
    expect(delta.removedHits.map((h) => h.id)).toEqual(["b"]);
  });

  it("detects a status change on a stable hit id", () => {
    const baseline = snap([{ id: "c", list: "sanctions", matchedName: "JOHN DOE", status: "medium", score: 75 }]);
    const current = snap([{ id: "c", list: "sanctions", matchedName: "JOHN DOE", status: "high", score: 95 }]);
    const delta = diffSnapshots(baseline, current);
    expect(delta.changed).toBe(true);
    expect(delta.statusChanges).toEqual([{ id: "c", list: "sanctions", matchedName: "JOHN DOE", from: "medium", to: "high" }]);
    expect(delta.newHits).toHaveLength(0);
    expect(delta.removedHits).toHaveLength(0);
  });

  it("treats a null baseline as all-new hits", () => {
    const delta = diffSnapshots(null, snap([{ id: "d", list: "watchlist", matchedName: "JOHN DOE", status: "hit" }]));
    expect(delta.newHits).toHaveLength(1);
  });
});

describe("nextRunAt", () => {
  const from = new Date("2026-06-15T12:00:00.000Z");

  it("daily is +24h", () => {
    expect(nextRunAt("daily", from).getTime() - from.getTime()).toBe(24 * 3_600_000);
  });
  it("weekly is +7d", () => {
    expect(nextRunAt("weekly", from).getTime() - from.getTime()).toBe(7 * 24 * 3_600_000);
  });
  it("monthly advances one calendar month", () => {
    expect(nextRunAt("monthly", from).toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });
  it("scoreBand maps normalized scores to status bands", () => {
    expect(scoreBand(undefined)).toBe("hit");
    expect(scoreBand(95)).toBe("high");
    expect(scoreBand(75)).toBe("medium");
    expect(scoreBand(10)).toBe("low");
  });
});

// ─── Router: enroll + tenant isolation ────────────────────────────────────────

describe("monitoring.enroll", () => {
  beforeEach(() => { stubFetch(); resetState(); });

  it("enrolls with a baseline snapshot and schedules next_run_at per frequency", async () => {
    http.sanctions = { kind: "hits", hits: [{ list: "OFAC_SDN", name: "JOHN DOE", score: 0.95 }] };
    const before = Date.now();
    const result = await enrollJohnDoe(1, "weekly");

    expect(result.status).toBe("active");
    expect(result.baselineHitCount).toBe(1);
    const nextRun = new Date(result.nextRunAt).getTime();
    expect(nextRun).toBeGreaterThanOrEqual(before + 7 * 24 * 3_600_000 - 1_000);
    expect(nextRun).toBeLessThanOrEqual(Date.now() + 7 * 24 * 3_600_000 + 1_000);

    const enr = mocks.state.enrollments.find((e) => e.id === result.enrollmentId)!;
    expect(enr.tenant_id).toBe(1);
    expect(enr.baseline_snapshot.hits).toHaveLength(1);
    expect(enr.baseline_snapshot.hits[0].matchedName).toBe("JOHN DOE");
    expect(enr.baseline_snapshot.hits[0].status).toBe("high"); // 0.95 → 95 → high band
    expect(mocks.state.auditLog.some((a) => a.action === "monitoring_enrolled")).toBe(true);
  });

  it("rejects enrollment against another tenant's investigation", async () => {
    seedInvestigation(REF, 2); // belongs to tenant 2
    const caller = monitoringRouter.createCaller(makeCtx(1));
    await expect(caller.enroll({ investigationRef: REF, subjectName: "JOHN DOE", frequency: "daily" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.state.enrollments).toHaveLength(0);
  });

  it("rejects a duplicate live enrollment for the same subject", async () => {
    await enrollJohnDoe(1);
    await expect(enrollJohnDoe(1)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("fails closed when a screening provider is unavailable — no baseline stored", async () => {
    http.sanctions = { kind: "unavailable" };
    seedInvestigation(REF, 1);
    const caller = monitoringRouter.createCaller(makeCtx(1));
    await expect(caller.enroll({ investigationRef: REF, subjectName: "JOHN DOE", frequency: "daily" }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(mocks.state.enrollments).toHaveLength(0);
  });

  it("requires an authenticated tenant context", async () => {
    seedInvestigation(REF, 1);
    await expect(monitoringRouter.createCaller(makeCtx(null)).enroll({ investigationRef: REF, subjectName: "JOHN DOE", frequency: "daily" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(monitoringRouter.createCaller({ ...makeCtx(1), user: null }).enroll({ investigationRef: REF, subjectName: "JOHN DOE", frequency: "daily" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── Router: state machine + tenant isolation on reads ───────────────────────

describe("monitoring enrollment lifecycle", () => {
  beforeEach(() => { stubFetch(); resetState(); });

  it("pause → resume → cancel transitions with audit", async () => {
    const { enrollmentId } = await enrollJohnDoe(1);
    const caller = monitoringRouter.createCaller(makeCtx(1));

    await expect(caller.pause({ enrollmentId })).resolves.toMatchObject({ status: "paused" });
    await expect(caller.pause({ enrollmentId })).rejects.toMatchObject({ code: "CONFLICT" });

    const resumed = await caller.resume({ enrollmentId });
    expect(resumed.status).toBe("active");
    expect(new Date(resumed.nextRunAt).getTime()).toBeGreaterThan(Date.now());

    await expect(caller.cancel({ enrollmentId })).resolves.toMatchObject({ status: "cancelled" });
    await expect(caller.cancel({ enrollmentId })).rejects.toMatchObject({ code: "CONFLICT" }); // terminal

    const actions = mocks.state.auditLog.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["monitoring_paused", "monitoring_resumed", "monitoring_cancelled"]));
  });

  it("list and getEnrollment are tenant-scoped", async () => {
    const { enrollmentId } = await enrollJohnDoe(1);
    seedInvestigation("BIS-2026-MON002", 2);
    await monitoringRouter.createCaller(makeCtx(2)).enroll({ investigationRef: "BIS-2026-MON002", subjectName: "JANE SMITH", frequency: "monthly" });

    const tenant1 = monitoringRouter.createCaller(makeCtx(1));
    const list1 = await tenant1.list();
    expect(list1.total).toBe(1);
    expect(list1.records[0].subjectName).toBe("JOHN DOE");

    const tenant2 = monitoringRouter.createCaller(makeCtx(2));
    const list2 = await tenant2.list();
    expect(list2.total).toBe(1);
    expect(list2.records[0].subjectName).toBe("JANE SMITH");

    // Cross-tenant getEnrollment is invisible
    await expect(tenant2.getEnrollment({ enrollmentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const detail = await tenant1.getEnrollment({ enrollmentId, runsLimit: 5 });
    expect(detail.enrollment.enrollmentId).toBe(enrollmentId);
    expect(detail.runs).toHaveLength(0);
  });
});

// ─── Scheduler: re-screen, diff, alert fan-out, fail-closed ──────────────────

describe("processDueMonitoringEnrollments", () => {
  beforeEach(() => { stubFetch(); resetState(); });

  it("raises a critical alert and publishes MONITORING_ALERT on a new sanctions hit", async () => {
    http.sanctions = { kind: "hits", hits: [{ list: "OFAC_SDN", name: "JOHN DOE", score: 0.95 }] };
    const { enrollmentId } = await enrollJohnDoe(1);
    http.events.length = 0; // ignore MONITORING_ENROLLED fan-out

    // A second sanctions hit appears in the next screening cycle.
    http.sanctions = {
      kind: "hits",
      hits: [
        { list: "OFAC_SDN", name: "JOHN DOE", score: 0.95 },
        { list: "UN_SC", name: "JOHN DOE", score: 0.99 },
      ],
    };
    forceDue(enrollmentId);

    const summary = await processDueMonitoringEnrollments();
    expect(summary).toMatchObject({ processed: 1, changed: 1, alertsRaised: 1, errors: 0 });

    const run = mocks.state.runs.find((r) => r.enrollment_id === enrollmentId)!;
    expect(run.result).toBe("change_detected");
    expect(run.snapshot.hits).toHaveLength(2);

    const alert = mocks.state.alerts.find((a) => a.enrollment_id === enrollmentId)!;
    expect(alert.alert_type).toBe("new_hit");
    expect(alert.severity).toBe("critical"); // new sanctions hit
    expect(alert.tenant_id).toBe(1);

    // Event fan-out happened after commit with critical severity.
    const alertEvents = http.events.filter((e) => e.event_type === "MONITORING_ALERT");
    expect(alertEvents).toHaveLength(1);
    expect(alertEvents[0].severity).toBe("critical");
    expect(alertEvents[0].subject_ref).toBe(REF);
    expect(alertEvents[0].payload.enrollmentId).toBe(enrollmentId);

    // Baseline advanced to the fresh snapshot; next run rescheduled +24h.
    const enr = mocks.state.enrollments.find((e) => e.id === enrollmentId)!;
    expect(enr.baseline_snapshot.hits).toHaveLength(2);
    expect(new Date(enr.next_run_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(mocks.state.auditLog.some((a) => a.action === "monitoring_change_detected")).toBe(true);
  });

  it("records a no_change run and no alerts when the snapshot is stable", async () => {
    http.sanctions = { kind: "hits", hits: [{ list: "OFAC_SDN", name: "JOHN DOE", score: 0.95 }] };
    const { enrollmentId } = await enrollJohnDoe(1);
    http.events.length = 0;
    forceDue(enrollmentId);

    const summary = await processDueMonitoringEnrollments();
    expect(summary).toMatchObject({ processed: 1, changed: 0, alertsRaised: 0, errors: 0 });
    expect(mocks.state.runs.find((r) => r.enrollment_id === enrollmentId)!.result).toBe("no_change");
    expect(mocks.state.alerts.filter((a) => a.enrollment_id === enrollmentId)).toHaveLength(0);
    expect(http.events.filter((e) => e.event_type === "MONITORING_ALERT")).toHaveLength(0);
  });

  it("detects a removed hit as a low-severity alert", async () => {
    http.sanctions = { kind: "hits", hits: [{ list: "OFAC_SDN", name: "JOHN DOE", score: 0.95 }] };
    const { enrollmentId } = await enrollJohnDoe(1);
    http.events.length = 0;
    http.sanctions = { kind: "hits", hits: [] }; // hit disappears from the list
    forceDue(enrollmentId);

    const summary = await processDueMonitoringEnrollments();
    expect(summary).toMatchObject({ processed: 1, changed: 1, alertsRaised: 1 });
    const alert = mocks.state.alerts.find((a) => a.enrollment_id === enrollmentId)!;
    expect(alert.alert_type).toBe("removed_hit");
    expect(alert.severity).toBe("low");
  });

  it("fails closed: provider outage records an error run, advances the schedule, never crashes", async () => {
    http.sanctions = { kind: "hits", hits: [] };
    const { enrollmentId } = await enrollJohnDoe(1);
    http.events.length = 0;
    http.sanctions = { kind: "unavailable" };
    forceDue(enrollmentId);

    const summary = await processDueMonitoringEnrollments();
    expect(summary).toMatchObject({ processed: 0, changed: 0, alertsRaised: 0, errors: 1 });

    const run = mocks.state.runs.find((r) => r.enrollment_id === enrollmentId)!;
    expect(run.result).toBe("error");
    expect(String(run.error)).toContain("sanctions");

    // Baseline untouched; schedule advanced (no hot loop); enrollment still active.
    const enr = mocks.state.enrollments.find((e) => e.id === enrollmentId)!;
    expect(enr.status).toBe("active");
    expect(enr.baseline_snapshot.hits).toHaveLength(0);
    expect(new Date(enr.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(mocks.state.auditLog.some((a) => a.action === "monitoring_run_error" && a.result === "failure")).toBe(true);
  });

  it("does not pick up paused, cancelled, or not-yet-due enrollments", async () => {
    const { enrollmentId } = await enrollJohnDoe(1); // next_run_at is +24h — not due
    const summary = await processDueMonitoringEnrollments();
    expect(summary).toMatchObject({ processed: 0, errors: 0 });
    expect(mocks.state.runs).toHaveLength(0);

    const caller = monitoringRouter.createCaller(makeCtx(1));
    await caller.pause({ enrollmentId });
    forceDue(enrollmentId); // paused rows must be skipped even when "due"
    const summary2 = await processDueMonitoringEnrollments();
    expect(summary2).toMatchObject({ processed: 0, errors: 0 });
    expect(mocks.state.runs).toHaveLength(0);
  });
});

// ─── Alerts: query ordering + acknowledge authorization ───────────────────────

describe("monitoring alerts", () => {
  beforeEach(() => { stubFetch(); resetState(); });

  async function raiseAlert(tenantId = 1) {
    http.sanctions = { kind: "hits", hits: [] };
    const { enrollmentId } = await enrollJohnDoe(tenantId);
    http.sanctions = { kind: "hits", hits: [{ list: "OFAC_SDN", name: "JOHN DOE", score: 0.99 }] };
    forceDue(enrollmentId);
    await processDueMonitoringEnrollments();
    return mocks.state.alerts.find((a) => a.enrollment_id === enrollmentId)!;
  }

  it("getAlerts is tenant-scoped, unacknowledged first", async () => {
    const alert = await raiseAlert(1);
    const caller = monitoringRouter.createCaller(makeCtx(1));
    const result = await caller.getAlerts();
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].id).toBe(alert.id);

    // Cross-tenant cannot see it
    const other = await monitoringRouter.createCaller(makeCtx(2)).getAlerts();
    expect(other.alerts).toHaveLength(0);

    // After acknowledgment it disappears unless includeAcknowledged is set
    await caller.acknowledgeAlert({ alertId: alert.id });
    expect((await caller.getAlerts()).alerts).toHaveLength(0);
    expect((await caller.getAlerts({ includeAcknowledged: true })).alerts).toHaveLength(1);
  });

  it("acknowledgeAlert requires admin or supervisor", async () => {
    const alert = await raiseAlert(1);
    const analyst = monitoringRouter.createCaller(makeCtx(1, 77, "analyst"));
    await expect(analyst.acknowledgeAlert({ alertId: alert.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const supervisor = monitoringRouter.createCaller(makeCtx(1, 78, "supervisor"));
    await expect(supervisor.acknowledgeAlert({ alertId: alert.id })).resolves.toMatchObject({ acknowledged: true });
    expect(mocks.state.auditLog.some((a) => a.action === "monitoring_alert_acknowledged")).toBe(true);

    // Single-ack: a second acknowledgment conflicts
    await expect(supervisor.acknowledgeAlert({ alertId: alert.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("acknowledgeAlert cannot cross tenants", async () => {
    const alert = await raiseAlert(1);
    const foreign = monitoringRouter.createCaller(makeCtx(2, 79, "admin"));
    await expect(foreign.acknowledgeAlert({ alertId: alert.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.state.alerts.find((a) => a.id === alert.id)!.acknowledged_at).toBeNull();
  });
});
