/**
 * WP2 — Ongoing monitoring tests.
 *
 * Covers: snapshot diff detection (new / removed / changed / no-change),
 * frequency → next_run_at math, authZ on acknowledgeAlert (admin/supervisor
 * only), enrollment tenant isolation, and scheduler alert fan-out
 * (monitoring_runs + monitoring_alerts + MONITORING_ALERT event + audit).
 *
 * The DB is faked at the pg-pool boundary (getPgPool) with SQL-pattern
 * routing — no screening matching is mocked: runListScreening is exercised
 * against gateway-shaped payloads via a stubbed fetch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

// ─── Fake pg pool ─────────────────────────────────────────────────────────────

type QueryResult = { rows: any[]; rowCount: number | null };

interface FakeState {
  investigations: Record<string, any | undefined>; // keyed by `${tenantId}:${ref}`
  enrollment: any | null; // row returned by scheduler/pause SELECT ... FOR UPDATE
  dueIds: Array<{ id: string }>;
  ackRowCount: number; // rowCount for UPDATE monitoring_alerts ... acknowledged
  existingEnrollmentCount: number; // active/paused enrollment conflict check
  listRows: any[]; // rows for the tenant-scoped enrollment list query
  alertRows: any[]; // rows for the tenant-scoped alerts query
}

class FakeClient {
  queries: Array<{ text: string; params: unknown[] }> = [];
  constructor(private state: FakeState) {}

  async query(text: string, params: unknown[] = []): Promise<QueryResult> {
    this.queries.push({ text, params });
    const t = text.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(t)) return { rows: [], rowCount: 0 };
    if (/FROM investigations WHERE ref = \$1/.test(t)) {
      const row = this.state.investigations[`${params[1]}:${params[0]}`];
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/SELECT id FROM monitoring_enrollments WHERE tenant_id = \$1 AND investigation_ref/.test(t)) {
      return { rows: [], rowCount: this.state.existingEnrollmentCount };
    }
    if (/FROM monitoring_enrollments WHERE id = \$1 AND status = 'active' FOR UPDATE/.test(t)) {
      return this.state.enrollment ? { rows: [this.state.enrollment], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/FROM monitoring_enrollments WHERE id = \$1 AND tenant_id = \$2 FOR UPDATE/.test(t)) {
      const row = this.state.enrollment && this.state.enrollment.tenant_id === params[1] ? this.state.enrollment : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/FROM monitoring_enrollments WHERE status = 'active' AND next_run_at IS NOT NULL/.test(t)) {
      return { rows: this.state.dueIds, rowCount: this.state.dueIds.length };
    }
    if (/INSERT INTO monitoring_enrollments/.test(t)) return { rows: [], rowCount: 1 };
    if (/INSERT INTO monitoring_runs/.test(t)) return { rows: [], rowCount: 1 };
    if (/INSERT INTO monitoring_alerts/.test(t)) return { rows: [], rowCount: 1 };
    if (/INSERT INTO audit_log/.test(t)) return { rows: [], rowCount: 1 };
    if (/UPDATE monitoring_alerts SET acknowledged_at/.test(t)) {
      const ok = this.state.ackRowCount === 1;
      return { rows: ok ? [{ id: params[1], enrollment_id: "enr-1", alert_type: "new_hit" }] : [], rowCount: this.state.ackRowCount };
    }
    if (/UPDATE monitoring_enrollments/.test(t)) return { rows: [], rowCount: 1 };
    if (/FROM monitoring_enrollments WHERE tenant_id = \$1/.test(t)) {
      return { rows: this.state.listRows, rowCount: this.state.listRows.length };
    }
    if (/FROM monitoring_alerts WHERE tenant_id = \$1/.test(t)) {
      return { rows: this.state.alertRows, rowCount: this.state.alertRows.length };
    }
    throw new Error(`FakeClient: unmatched SQL: ${t}`);
  }
  release() {}
}

class FakePool {
  clients: FakeClient[] = [];
  constructor(private state: FakeState) {}
  async connect() {
    const c = new FakeClient(this.state);
    this.clients.push(c);
    return c;
  }
  async query(text: string, params: unknown[] = []) {
    const c = new FakeClient(this.state);
    this.clients.push(c);
    return c.query(text, params);
  }
  allQueries() {
    return this.clients.flatMap((c) => c.queries);
  }
}

const dbHolder = vi.hoisted(() => ({ pool: null as unknown as FakePool }));

vi.mock("./db", () => ({
  getPgPool: vi.fn(async () => dbHolder.pool),
  getDb: vi.fn(async () => null),
}));

import {
  alertSeverity,
  buildSnapshot,
  computeNextRunAt,
  diffSnapshots,
  hasDelta,
  monitoringRouter,
  runListScreening,
  type MonitoringSnapshot,
} from "./monitoring";
import { processDueEnrollment, runDueEnrollments, type MonitoringSchedulerDeps } from "./monitoringScheduler";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function ctxFor(tenantId: number | null, role = "analyst"): TrpcContext {
  return {
    user: { id: 42, tenantId, role, name: "Op", email: "op@t.test" } as TrpcContext["user"],
    tenantId,
    isDemo: false,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const SANCTIONS_HIT_PAYLOAD = {
  queried: "Jane Doe",
  hits: [{ list: "OFAC_SDN", name: "Jane Doe", score: 0.97, entityType: "individual", programs: ["SDGT"], reason: "Exact name match" }],
  clear: false,
  checkedAt: "2026-01-01T00:00:00Z",
};
const SANCTIONS_CLEAR_PAYLOAD = { queried: "Jane Doe", hits: [], clear: true, checkedAt: "2026-01-01T00:00:00Z" };

function stubGatewayFetch(payloads: Record<string, any>, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: any) => {
    calls.push(String(url));
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const key = Object.keys(payloads).find((k) => path.startsWith(k));
    if (key === undefined || status !== 200) return { ok: false, status, json: async () => ({}) } as any;
    return { ok: true, status: 200, json: async () => payloads[key] } as any;
  }));
  return calls;
}

function baselineWithHit(): MonitoringSnapshot {
  return buildSnapshot("Jane Doe", { sanctions: SANCTIONS_HIT_PAYLOAD });
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe("computeNextRunAt", () => {
  const from = new Date("2026-03-10T12:00:00Z");
  it("daily → +1 day", () => {
    expect(computeNextRunAt("daily", from).toISOString()).toBe("2026-03-11T12:00:00.000Z");
  });
  it("weekly → +7 days", () => {
    expect(computeNextRunAt("weekly", from).toISOString()).toBe("2026-03-17T12:00:00.000Z");
  });
  it("monthly → +1 calendar month (UTC)", () => {
    expect(computeNextRunAt("monthly", from).toISOString()).toBe("2026-04-10T12:00:00.000Z");
  });
  it("does not mutate the input date", () => {
    computeNextRunAt("weekly", from);
    expect(from.toISOString()).toBe("2026-03-10T12:00:00.000Z");
  });
});

describe("buildSnapshot / diffSnapshots", () => {
  it("normalizes gateway sanctions payloads into stable hits", () => {
    const snap = buildSnapshot("Jane Doe", { sanctions: SANCTIONS_HIT_PAYLOAD });
    expect(snap.lists.sanctions.clear).toBe(false);
    expect(snap.lists.sanctions.hits).toHaveLength(1);
    expect(snap.lists.sanctions.hits[0].list).toBe("OFAC_SDN");
    expect(snap.lists.sanctions.hits[0].hitId).toMatch(/^[0-9a-f]{24}$/);
  });

  it("treats a positive PEP result as a hit", () => {
    const snap = buildSnapshot("Jane Doe", { pep: { queried: "Jane Doe", isPEP: true, roles: ["Senator"], party: "APC", country: "NG" } });
    expect(snap.lists.pep.hits).toHaveLength(1);
    expect(snap.lists.pep.hits[0].reason).toContain("Senator");
  });

  it("detects no change between identical snapshots", () => {
    const base = baselineWithHit();
    const current = baselineWithHit();
    const delta = diffSnapshots(base, current);
    expect(hasDelta(delta)).toBe(false);
  });

  it("detects a new hit", () => {
    const base = buildSnapshot("Jane Doe", { sanctions: SANCTIONS_CLEAR_PAYLOAD });
    const current = baselineWithHit();
    const delta = diffSnapshots(base, current);
    expect(delta.newHits).toHaveLength(1);
    expect(delta.removedHits).toHaveLength(0);
    expect(hasDelta(delta)).toBe(true);
  });

  it("detects a removed hit", () => {
    const delta = diffSnapshots(baselineWithHit(), buildSnapshot("Jane Doe", { sanctions: SANCTIONS_CLEAR_PAYLOAD }));
    expect(delta.removedHits).toHaveLength(1);
    expect(delta.newHits).toHaveLength(0);
  });

  it("detects a status change (score changed on the same hit)", () => {
    const changed = { ...SANCTIONS_HIT_PAYLOAD, hits: [{ ...SANCTIONS_HIT_PAYLOAD.hits[0], score: 0.81 }] };
    const delta = diffSnapshots(baselineWithHit(), buildSnapshot("Jane Doe", { sanctions: changed }));
    expect(delta.statusChanges).toHaveLength(1);
    expect(delta.statusChanges[0].before.score).toBe(0.97);
    expect(delta.statusChanges[0].after.score).toBe(0.81);
    expect(delta.newHits).toHaveLength(0);
  });

  it("detects change from a null baseline (first run after legacy enrollment)", () => {
    const delta = diffSnapshots(null, baselineWithHit());
    expect(delta.newHits).toHaveLength(1);
  });

  it("severity: new sanctions hit is critical, PEP is high, removal is info", () => {
    const hit = baselineWithHit().lists.sanctions.hits[0];
    expect(alertSeverity("new_hit", hit)).toBe("critical");
    expect(alertSeverity("new_hit", { ...hit, list: "pep" })).toBe("high");
    expect(alertSeverity("status_change", hit)).toBe("warning");
    expect(alertSeverity("removed_hit", hit)).toBe("info");
  });
});

describe("runListScreening (existing gateway entry points, fail-closed)", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("calls /v1/sanctions and /v1/pep on the gateway with the BIS key", async () => {
    stubGatewayFetch({ "/v1/sanctions/": SANCTIONS_CLEAR_PAYLOAD, "/v1/pep/": { isPEP: false, roles: [] } });
    const out = await runListScreening("Jane Doe", ["sanctions", "pep"]);
    expect(out.sanctions.clear).toBe(true);
    expect(out.pep.isPEP).toBe(false);
    const calls = (fetch as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((u: string) => u.includes("/v1/sanctions/Jane%20Doe"))).toBe(true);
    expect(calls.some((u: string) => u.includes("/v1/pep/Jane%20Doe"))).toBe(true);
  });

  it("dedupes the shared sanctions/watchlist endpoint", async () => {
    stubGatewayFetch({ "/v1/sanctions/": SANCTIONS_CLEAR_PAYLOAD });
    const out = await runListScreening("Jane Doe", ["sanctions", "watchlist"]);
    expect(out.sanctions).toBeDefined();
    expect(out.watchlist).toBeDefined();
    expect((fetch as any).mock.calls).toHaveLength(1);
  });

  it("fails closed when a provider is unavailable", async () => {
    stubGatewayFetch({}, 503);
    await expect(runListScreening("Jane Doe", ["sanctions"])).rejects.toThrow(/HTTP 503/);
  });
});

// ─── Router: enroll / state machine / authZ / tenant isolation ───────────────

describe("monitoringRouter", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeState(): FakeState {
    return {
      investigations: { "7:INV-2026-AAAA": { ref: "INV-2026-AAAA", subjectName: "Jane Doe", nin: null, bvn: null, rcNumber: null } },
      enrollment: null,
      dueIds: [],
      ackRowCount: 1,
      existingEnrollmentCount: 0,
      listRows: [],
      alertRows: [],
    };
  }

  it("enroll stores a baseline snapshot and schedules next_run_at per frequency", async () => {
    const state = makeState();
    dbHolder.pool = new FakePool(state);
    stubGatewayFetch({ "/v1/sanctions/": SANCTIONS_HIT_PAYLOAD });
    const caller = monitoringRouter.createCaller(ctxFor(7));
    const res = await caller.enroll({ investigationRef: "INV-2026-AAAA", listSet: ["sanctions"], frequency: "weekly" });
    expect(res.status).toBe("active");
    expect(res.baseline.lists.sanctions.hits).toHaveLength(1);
    // weekly → next_run_at 7 days out
    const diffDays = (res.nextRunAt.getTime() - Date.now()) / 86_400_000;
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThan(7.1);
    // INSERT captured baseline + audit inside one transaction
    const insert = dbHolder.pool.allQueries().find((q) => /INSERT INTO monitoring_enrollments/.test(q.text));
    expect(insert).toBeDefined();
    const snapshotParam = JSON.parse(String(insert!.params[8]));
    expect(snapshotParam.lists.sanctions.hits[0].list).toBe("OFAC_SDN");
    expect(insert!.params[1]).toBe(7); // tenant_id
    expect(dbHolder.pool.allQueries().some((q) => /INSERT INTO audit_log/.test(q.text))).toBe(true);
    const txOps = dbHolder.pool.clients[0].queries.map((q) => q.text.trim().split(" ")[0]);
    expect(txOps[0]).toBe("BEGIN");
    expect(txOps[txOps.length - 1]).toBe("COMMIT");
  });

  it("enroll is tenant-isolated: another tenant's investigation is NOT_FOUND", async () => {
    const state = makeState();
    dbHolder.pool = new FakePool(state);
    stubGatewayFetch({ "/v1/sanctions/": SANCTIONS_CLEAR_PAYLOAD });
    const caller = monitoringRouter.createCaller(ctxFor(8)); // investigation belongs to tenant 7
    await expect(caller.enroll({ investigationRef: "INV-2026-AAAA", listSet: ["sanctions"], frequency: "daily" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(dbHolder.pool.allQueries().some((q) => /INSERT INTO monitoring_enrollments/.test(q.text))).toBe(false);
  });

  it("enroll fails closed when the screening provider is down (no enrollment written)", async () => {
    const state = makeState();
    dbHolder.pool = new FakePool(state);
    stubGatewayFetch({}, 503);
    const caller = monitoringRouter.createCaller(ctxFor(7));
    await expect(caller.enroll({ investigationRef: "INV-2026-AAAA", listSet: ["sanctions"], frequency: "daily" }))
      .rejects.toThrow(/HTTP 503/);
    expect(dbHolder.pool.allQueries().some((q) => /INSERT INTO monitoring_enrollments/.test(q.text))).toBe(false);
    expect(dbHolder.pool.clients[0].queries.some((q) => q.text.trim().startsWith("ROLLBACK"))).toBe(true);
  });

  it("enroll rejects when the investigation already has a live enrollment", async () => {
    const state = makeState();
    state.existingEnrollmentCount = 1;
    dbHolder.pool = new FakePool(state);
    stubGatewayFetch({ "/v1/sanctions/": SANCTIONS_CLEAR_PAYLOAD });
    const caller = monitoringRouter.createCaller(ctxFor(7));
    await expect(caller.enroll({ investigationRef: "INV-2026-AAAA", listSet: ["sanctions"], frequency: "daily" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("state machine: pause active→paused, resume paused→active (recomputes next_run_at), cancel terminal", async () => {
    const state = makeState();
    state.enrollment = { id: "enr-1", tenant_id: 7, status: "active", frequency: "daily", investigation_ref: "INV-2026-AAAA" };
    dbHolder.pool = new FakePool(state);
    const caller = monitoringRouter.createCaller(ctxFor(7));
    await expect(caller.pause({ enrollmentId: crypto.randomUUID() })).resolves.toMatchObject({ status: "paused" });

    state.enrollment.status = "paused";
    await expect(caller.resume({ enrollmentId: crypto.randomUUID() })).resolves.toMatchObject({ status: "active" });
    const resumeUpdate = dbHolder.pool.allQueries().find((q) => /SET status = 'active', next_run_at/.test(q.text));
    expect(resumeUpdate).toBeDefined();

    state.enrollment.status = "cancelled";
    await expect(caller.pause({ enrollmentId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    // every transition audited
    expect(dbHolder.pool.allQueries().filter((q) => /INSERT INTO audit_log/.test(q.text)).length).toBeGreaterThanOrEqual(2);
  });

  it("state machine is tenant-isolated: enrollment of another tenant is NOT_FOUND", async () => {
    const state = makeState();
    state.enrollment = { id: "enr-1", tenant_id: 8, status: "active", frequency: "daily", investigation_ref: "INV-2026-BBBB" };
    dbHolder.pool = new FakePool(state);
    const caller = monitoringRouter.createCaller(ctxFor(7));
    await expect(caller.pause({ enrollmentId: crypto.randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("acknowledgeAlert: analyst role is rejected", async () => {
    dbHolder.pool = new FakePool(makeState());
    const caller = monitoringRouter.createCaller(ctxFor(7, "analyst"));
    await expect(caller.acknowledgeAlert({ alertId: crypto.randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("acknowledgeAlert: supervisor and admin may acknowledge", async () => {
    dbHolder.pool = new FakePool(makeState());
    await expect(monitoringRouter.createCaller(ctxFor(7, "supervisor")).acknowledgeAlert({ alertId: crypto.randomUUID() }))
      .resolves.toMatchObject({ acknowledged: true });
    dbHolder.pool = new FakePool(makeState());
    await expect(monitoringRouter.createCaller(ctxFor(7, "admin")).acknowledgeAlert({ alertId: crypto.randomUUID() }))
      .resolves.toMatchObject({ acknowledged: true });
  });

  it("acknowledgeAlert: cross-tenant or already-acked alert is NOT_FOUND", async () => {
    const state = makeState();
    state.ackRowCount = 0; // WHERE id=$2 AND tenant_id=$3 AND acknowledged_at IS NULL matched nothing
    dbHolder.pool = new FakePool(state);
    const caller = monitoringRouter.createCaller(ctxFor(7, "supervisor"));
    await expect(caller.acknowledgeAlert({ alertId: crypto.randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("unauthenticated callers are rejected", async () => {
    dbHolder.pool = new FakePool(makeState());
    const anon = { user: null, tenantId: null, isDemo: false, req: {}, res: {} } as unknown as TrpcContext;
    await expect(monitoringRouter.createCaller(anon).list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("list is tenant-scoped with filters; getAlerts orders unacknowledged first", async () => {
    const state = makeState();
    state.listRows = [{ id: "enr-1", tenant_id: 7, investigation_ref: "INV-2026-AAAA", status: "active" }];
    state.alertRows = [{ id: "al-1", tenant_id: 7, acknowledged_at: null }, { id: "al-2", tenant_id: 7, acknowledged_at: "2026-03-01" }];
    dbHolder.pool = new FakePool(state);
    const caller = monitoringRouter.createCaller(ctxFor(7));

    const list = await caller.list({ status: "active", frequency: "daily" });
    expect(list.enrollments).toHaveLength(1);
    const listQuery = dbHolder.pool.allQueries().find((q) => /FROM monitoring_enrollments WHERE tenant_id = \$1/.test(q.text));
    expect(listQuery!.params[0]).toBe(7);
    expect(listQuery!.text).toContain("status = $2");
    expect(listQuery!.text).toContain("frequency = $3");

    const alerts = await caller.getAlerts({});
    expect(alerts.alerts).toHaveLength(2);
    const alertQuery = dbHolder.pool.allQueries().find((q) => /FROM monitoring_alerts WHERE tenant_id = \$1/.test(q.text));
    expect(alertQuery!.params[0]).toBe(7);
    expect(alertQuery!.text).toContain("ORDER BY (acknowledged_at IS NULL) DESC");
  });
});

// ─── Scheduler: alert fan-out ─────────────────────────────────────────────────

describe("monitoringScheduler.processDueEnrollment", () => {
  const ENROLLMENT_ID = "11111111-2222-4333-8444-555555555555";

  function enrollmentWith(baseline: MonitoringSnapshot | null) {
    return {
      id: ENROLLMENT_ID,
      tenant_id: 7,
      investigation_ref: "INV-2026-AAAA",
      subject_name: "Jane Doe",
      list_set: ["sanctions"],
      frequency: "daily",
      status: "active",
      baseline_snapshot: baseline,
    };
  }

  function deps(screenPayload: any): { deps: MonitoringSchedulerDeps; published: any[] } {
    const published: any[] = [];
    return {
      deps: {
        screen: vi.fn(async () => ({ sanctions: screenPayload })),
        publish: vi.fn(async (_t: string, _r: string, _s: string, p: unknown) => { published.push(p); }),
        now: () => new Date("2026-03-10T00:00:00Z"),
      },
      published,
    };
  }

  it("no-change run: writes run row, advances schedule, no alerts, no events", async () => {
    const state: FakeState = { investigations: {}, enrollment: enrollmentWith(baselineWithHit()), dueIds: [], ackRowCount: 0, existingEnrollmentCount: 0, listRows: [], alertRows: [] };
    const pool = new FakePool(state);
    const { deps: d, published } = deps(SANCTIONS_HIT_PAYLOAD);
    const outcome = await processDueEnrollment(pool as any, ENROLLMENT_ID, d);
    expect(outcome).toBe("processed");
    const runInsert = pool.allQueries().find((q) => /INSERT INTO monitoring_runs/.test(q.text));
    expect(runInsert!.params[4]).toBe("no_change");
    expect(pool.allQueries().some((q) => /INSERT INTO monitoring_alerts/.test(q.text))).toBe(false);
    expect(published).toHaveLength(0);
    const sched = pool.allQueries().find((q) => /SET last_run_at = \$1, next_run_at/.test(q.text));
    expect(sched).toBeDefined();
    expect((sched!.params[1] as Date).toISOString()).toBe("2026-03-11T00:00:00.000Z"); // daily +1
  });

  it("new sanctions hit: change_detected + critical alert row + MONITORING_ALERT event + baseline updated", async () => {
    const state: FakeState = { investigations: {}, enrollment: enrollmentWith(buildSnapshot("Jane Doe", { sanctions: SANCTIONS_CLEAR_PAYLOAD })), dueIds: [], ackRowCount: 0, existingEnrollmentCount: 0, listRows: [], alertRows: [] };
    const pool = new FakePool(state);
    const { deps: d, published } = deps(SANCTIONS_HIT_PAYLOAD);
    const outcome = await processDueEnrollment(pool as any, ENROLLMENT_ID, d);
    expect(outcome).toBe("processed");

    const runInsert = pool.allQueries().find((q) => /INSERT INTO monitoring_runs/.test(q.text));
    expect(runInsert!.params[4]).toBe("change_detected");

    const alertInsert = pool.allQueries().find((q) => /INSERT INTO monitoring_alerts/.test(q.text));
    expect(alertInsert).toBeDefined();
    expect(alertInsert!.params[1]).toBe(7); // tenant fanned out from enrollment
    expect(alertInsert!.params[3]).toBe("new_hit");
    expect(alertInsert!.params[4]).toBe("critical");

    expect(published).toHaveLength(1);
    expect(published[0].alertType).toBe("new_hit");
    expect(published[0].severity).toBe("critical");
    expect((d.publish as any).mock.calls[0][0]).toBe("MONITORING_ALERT");
    expect((d.publish as any).mock.calls[0][1]).toBe("INV-2026-AAAA");

    const baselineUpdate = pool.allQueries().find((q) => /SET baseline_snapshot = \$1::jsonb/.test(q.text));
    expect(baselineUpdate).toBeDefined();
    expect(JSON.parse(String(baselineUpdate!.params[0])).lists.sanctions.hits).toHaveLength(1);
    expect(pool.allQueries().some((q) => /INSERT INTO audit_log/.test(q.text))).toBe(true);
  });

  it("removed hit: removed_hit alert with info severity", async () => {
    const state: FakeState = { investigations: {}, enrollment: enrollmentWith(baselineWithHit()), dueIds: [], ackRowCount: 0, existingEnrollmentCount: 0, listRows: [], alertRows: [] };
    const pool = new FakePool(state);
    const { deps: d, published } = deps(SANCTIONS_CLEAR_PAYLOAD);
    await processDueEnrollment(pool as any, ENROLLMENT_ID, d);
    const alertInsert = pool.allQueries().find((q) => /INSERT INTO monitoring_alerts/.test(q.text));
    expect(alertInsert!.params[3]).toBe("removed_hit");
    expect(alertInsert!.params[4]).toBe("info");
    expect(published[0].alertType).toBe("removed_hit");
  });

  it("screening failure: result='error' run recorded, baseline untouched, loop never crashes", async () => {
    const state: FakeState = { investigations: {}, enrollment: enrollmentWith(baselineWithHit()), dueIds: [], ackRowCount: 0, existingEnrollmentCount: 0, listRows: [], alertRows: [] };
    const pool = new FakePool(state);
    const published: any[] = [];
    const d: MonitoringSchedulerDeps = {
      screen: vi.fn(async () => { throw new Error("provider down"); }),
      publish: vi.fn(async (_t: string, _r: string, _s: string, p: unknown) => { published.push(p); }),
      now: () => new Date("2026-03-10T00:00:00Z"),
    };
    const outcome = await processDueEnrollment(pool as any, ENROLLMENT_ID, d);
    expect(outcome).toBe("error");
    const errRun = pool.allQueries().find((q) => /INSERT INTO monitoring_runs/.test(q.text) && q.text.includes("'error', NULL"));
    expect(errRun).toBeDefined();
    expect(String(errRun!.params[4])).toContain("provider down");
    expect(pool.allQueries().some((q) => /baseline_snapshot = /.test(q.text))).toBe(false);
    expect(published).toHaveLength(0);
  });

  it("skips enrollments that are no longer active", async () => {
    const state: FakeState = { investigations: {}, enrollment: null, dueIds: [], ackRowCount: 0, existingEnrollmentCount: 0, listRows: [], alertRows: [] };
    const pool = new FakePool(state);
    const { deps: d } = deps(SANCTIONS_HIT_PAYLOAD);
    expect(await processDueEnrollment(pool as any, ENROLLMENT_ID, d)).toBe("skipped");
    expect((d.screen as any).mock.calls).toHaveLength(0);
  });

  it("runDueEnrollments claims due rows with FOR UPDATE SKIP LOCKED and processes each", async () => {
    const state: FakeState = {
      investigations: {},
      enrollment: enrollmentWith(baselineWithHit()),
      dueIds: [{ id: ENROLLMENT_ID }],
      ackRowCount: 0,
      existingEnrollmentCount: 0,
      listRows: [],
      alertRows: [],
    };
    const pool = new FakePool(state);
    const { deps: d } = deps(SANCTIONS_HIT_PAYLOAD);
    const summary = await runDueEnrollments(pool as any, d);
    expect(summary).toEqual({ processed: 1, errors: 0, skipped: 0 });
    const claim = pool.allQueries().find((q) => /FOR UPDATE SKIP LOCKED/.test(q.text));
    expect(claim).toBeDefined();
  });
});
