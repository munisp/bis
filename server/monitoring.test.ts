/**
 * Ongoing-monitoring engine tests.
 *
 * Covers: snapshot diff detection (new/removed/changed/no-change), next_run_at
 * cadence math, acknowledge authorization (admin/supervisor only), tenant
 * isolation on every read/write path, and scheduler alert fan-out including
 * fail-closed error runs. The pg pool and the gateway/provider network
 * boundary are replaced with in-memory fakes; all engine logic (normalization,
 * diffing, cadence math, transactions, alert fan-out) under test is real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const holder = vi.hoisted(() => ({
  pool: null as unknown as FakePg,
  gatewayPayloads: {
    sanctions: { clear: true, hits: [] as unknown[] } as unknown,
    pep: { isPEP: false } as unknown,
  },
  gatewayFail: { sanctions: false, pep: false },
}));

vi.mock("./db", () => ({
  getPgPool: vi.fn(async () => holder.pool),
  getDb: vi.fn(async () => null),
}));

import {
  computeNextRunAt,
  diffSnapshots,
  monitoringRouter,
  normalizeGatewayHits,
  processDueMonitoringEnrollments,
  type MonitoringSnapshot,
} from "./monitoring";

// ─── In-memory PostgreSQL fake ────────────────────────────────────────────────

interface FakeEnrollment {
  id: string;
  tenant_id: number;
  investigation_ref: string;
  subject_name: string;
  subject_identifiers: Record<string, unknown>;
  list_set: string[];
  frequency: "daily" | "weekly" | "monthly";
  status: "active" | "paused" | "cancelled";
  last_run_at: Date | null;
  next_run_at: Date | null;
  baseline_snapshot: MonitoringSnapshot | null;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

interface FakeStore {
  investigations: Array<{ ref: string; subjectName: string; nin: string | null; bvn: string | null; tenantId: number; deletedAt: Date | null }>;
  enrollments: FakeEnrollment[];
  runs: Array<{ id: number; tenant_id: number; enrollment_id: string; started_at: Date; result: string; snapshot: MonitoringSnapshot | null; error: string | null; created_at: Date }>;
  alerts: Array<{ id: string; tenant_id: number; enrollment_id: string; run_id: number | null; alert_type: string; severity: string; delta: unknown; acknowledged_at: Date | null; acknowledged_by: number | null; created_at: Date }>;
  runIdSeq: number;
}

function norm(q: string): string {
  return q.replace(/\s+/g, " ").trim();
}

class FakePg {
  store: FakeStore;

  constructor(seed?: Partial<FakeStore>) {
    this.store = {
      investigations: [],
      enrollments: [],
      runs: [],
      alerts: [],
      runIdSeq: 1,
      ...seed,
    };
  }

  connect() {
    return { query: (text: string, params?: unknown[]) => this.query(text, params), release: vi.fn() };
  }

  async query(raw: string, params: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const q = norm(raw);
    if (q === "BEGIN" || q === "COMMIT" || q === "ROLLBACK") return { rows: [], rowCount: 0 };
    const now = new Date();

    // enroll: tenant-scoped investigation ownership lookup
    if (q.startsWith('SELECT ref, "subjectName", nin, bvn FROM investigations')) {
      const rows = this.store.investigations
        .filter(i => i.ref === params[0] && i.tenantId === params[1] && i.deletedAt === null)
        .map(i => ({ ref: i.ref, subjectName: i.subjectName, nin: i.nin, bvn: i.bvn }));
      return { rows, rowCount: rows.length };
    }
    // enroll: live duplicate check
    if (q.startsWith("SELECT id FROM monitoring_enrollments WHERE tenant_id = $1 AND investigation_ref = $2")) {
      const rows = this.store.enrollments.filter(e => e.tenant_id === params[0] && e.investigation_ref === params[1] && e.status !== "cancelled");
      return { rows: rows.map(e => ({ id: e.id })), rowCount: rows.length };
    }
    // enroll: insert
    if (q.startsWith("INSERT INTO monitoring_enrollments")) {
      this.store.enrollments.push({
        id: params[0] as string,
        tenant_id: params[1] as number,
        investigation_ref: params[2] as string,
        subject_name: params[3] as string,
        subject_identifiers: JSON.parse(params[4] as string),
        list_set: params[5] as string[],
        frequency: params[6] as FakeEnrollment["frequency"],
        status: "active",
        last_run_at: null,
        next_run_at: params[7] as Date,
        baseline_snapshot: JSON.parse(params[8] as string),
        created_by: params[9] as number,
        created_at: now,
        updated_at: now,
      });
      return { rows: [], rowCount: 1 };
    }
    // pause
    if (q.startsWith("UPDATE monitoring_enrollments SET status = 'paused'")) {
      const row = this.store.enrollments.find(e => e.id === params[0] && e.tenant_id === params[1] && e.status === "active");
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "paused";
      row.next_run_at = null;
      return { rows: [{ id: row.id, investigation_ref: row.investigation_ref }], rowCount: 1 };
    }
    // resume: read then update
    if (q.startsWith("SELECT frequency, investigation_ref FROM monitoring_enrollments")) {
      const row = this.store.enrollments.find(e => e.id === params[0] && e.tenant_id === params[1] && e.status === "paused");
      return { rows: row ? [{ frequency: row.frequency, investigation_ref: row.investigation_ref }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("UPDATE monitoring_enrollments SET status = 'active', next_run_at = $3")) {
      const row = this.store.enrollments.find(e => e.id === params[0] && e.tenant_id === params[1] && e.status === "paused");
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "active";
      row.next_run_at = params[2] as Date;
      return { rows: [], rowCount: 1 };
    }
    // cancel
    if (q.startsWith("UPDATE monitoring_enrollments SET status = 'cancelled'")) {
      const row = this.store.enrollments.find(e => e.id === params[0] && e.tenant_id === params[1] && (e.status === "active" || e.status === "paused"));
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "cancelled";
      row.next_run_at = null;
      return { rows: [{ investigation_ref: row.investigation_ref }], rowCount: 1 };
    }
    // list
    if (q.startsWith("SELECT id, investigation_ref, subject_name, list_set, frequency, status,")) {
      const [tenantId, status, limit, offset] = params as [number, string | null, number, number];
      const filtered = this.store.enrollments
        .filter(e => e.tenant_id === tenantId && (status === null || e.status === status))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || a.id.localeCompare(b.id));
      return { rows: filtered.slice(offset, offset + limit), rowCount: filtered.length };
    }
    if (q.startsWith("SELECT count(*)::int AS total FROM monitoring_enrollments")) {
      const [tenantId, status] = params as [number, string | null];
      const total = this.store.enrollments.filter(e => e.tenant_id === tenantId && (status === null || e.status === status)).length;
      return { rows: [{ total }], rowCount: 1 };
    }
    // getEnrollment
    if (q.startsWith("SELECT id, investigation_ref, subject_name, subject_identifiers")) {
      const row = this.store.enrollments.find(e => e.id === params[0] && e.tenant_id === params[1]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT id, started_at, finished_at, result, error, created_at FROM monitoring_runs")) {
      const rows = this.store.runs
        .filter(r => r.enrollment_id === params[0] && r.tenant_id === params[1])
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id - a.id)
        .slice(0, 20);
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("SELECT count(*) FILTER")) {
      const rows = this.store.alerts.filter(a => a.enrollment_id === params[0] && a.tenant_id === params[1]);
      return { rows: [{ unacknowledged: rows.filter(a => a.acknowledged_at === null).length, total: rows.length }], rowCount: 1 };
    }
    // getAlerts
    if (q.startsWith("SELECT a.id, a.enrollment_id")) {
      const [tenantId, enrollmentId, unackOnly, limit, offset] = params as [number, string | null, boolean, number, number];
      const rows = this.store.alerts
        .filter(a => a.tenant_id === tenantId)
        .filter(a => enrollmentId === null || a.enrollment_id === enrollmentId)
        .filter(a => !unackOnly || a.acknowledged_at === null)
        .sort((a, b) =>
          Number(b.acknowledged_at === null) - Number(a.acknowledged_at === null) ||
          b.created_at.getTime() - a.created_at.getTime() ||
          a.id.localeCompare(b.id),
        )
        .slice(offset, offset + limit)
        .map(a => {
          const e = this.store.enrollments.find(en => en.id === a.enrollment_id)!;
          return { ...a, investigation_ref: e.investigation_ref, subject_name: e.subject_name };
        });
      return { rows, rowCount: rows.length };
    }
    // acknowledgeAlert
    if (q.startsWith("UPDATE monitoring_alerts SET acknowledged_at = NOW()")) {
      const row = this.store.alerts.find(a => a.id === params[0] && a.tenant_id === params[1] && a.acknowledged_at === null);
      if (!row) return { rows: [], rowCount: 0 };
      row.acknowledged_at = now;
      row.acknowledged_by = params[2] as number;
      return { rows: [{ id: row.id, enrollment_id: row.enrollment_id, alert_type: row.alert_type }], rowCount: 1 };
    }
    // scheduler: candidate listing
    if (q.startsWith("SELECT id FROM monitoring_enrollments WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= NOW()")) {
      const rows = this.store.enrollments
        .filter(e => e.status === "active" && e.next_run_at !== null && e.next_run_at <= now)
        .sort((a, b) => a.next_run_at!.getTime() - b.next_run_at!.getTime() || a.id.localeCompare(b.id))
        .slice(0, params[0] as number)
        .map(e => ({ id: e.id }));
      return { rows, rowCount: rows.length };
    }
    // scheduler: locked claim
    if (q.startsWith("SELECT id, tenant_id, investigation_ref, subject_name, subject_identifiers,") && q.includes("FOR UPDATE SKIP LOCKED")) {
      const row = this.store.enrollments.find(e => e.id === params[0] && e.status === "active" && e.next_run_at !== null && e.next_run_at <= now);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    // scheduler: run insert (error and success variants)
    if (q.startsWith("INSERT INTO monitoring_runs")) {
      const isReturning = q.includes("RETURNING id");
      const run = {
        id: this.store.runIdSeq++,
        tenant_id: params[0] as number,
        enrollment_id: params[1] as string,
        started_at: params[2] as Date,
        result: isReturning ? (params[3] as string) : "error",
        snapshot: isReturning ? JSON.parse(params[4] as string) : null,
        error: isReturning ? null : (params[3] as string),
        created_at: now,
      };
      this.store.runs.push(run);
      return { rows: isReturning ? [{ id: run.id }] : [], rowCount: 1 };
    }
    // scheduler: enrollment updates
    if (q.startsWith("UPDATE monitoring_enrollments SET last_run_at = NOW(), next_run_at = $2, baseline_snapshot = $3::jsonb")) {
      const row = this.store.enrollments.find(e => e.id === params[0])!;
      row.last_run_at = now;
      row.next_run_at = params[1] as Date;
      row.baseline_snapshot = JSON.parse(params[2] as string);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE monitoring_enrollments SET last_run_at = NOW(), next_run_at = $2 WHERE")) {
      const row = this.store.enrollments.find(e => e.id === params[0])!;
      row.last_run_at = now;
      row.next_run_at = params[1] as Date;
      return { rows: [], rowCount: 1 };
    }
    // scheduler: alert insert
    if (q.startsWith("INSERT INTO monitoring_alerts")) {
      this.store.alerts.push({
        id: params[0] as string,
        tenant_id: params[1] as number,
        enrollment_id: params[2] as string,
        run_id: params[3] as number | null,
        alert_type: params[4] as string,
        severity: params[5] as string,
        delta: JSON.parse(params[6] as string),
        acknowledged_at: null,
        acknowledged_by: null,
        created_at: now,
      });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`FakePg: unmatched SQL: ${q}`);
  }
}

// ─── Gateway fetch stub (network boundary only) ───────────────────────────────

function stubGatewayFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: unknown) => {
    const u = String(url);
    if (u.includes("/v1/events")) {
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }
    if (u.includes("/v1/sanctions/")) {
      if (holder.gatewayFail.sanctions) return { ok: false, status: 503, json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => holder.gatewayPayloads.sanctions } as Response;
    }
    if (u.includes("/v1/pep/")) {
      if (holder.gatewayFail.pep) return { ok: false, status: 503, json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => holder.gatewayPayloads.pep } as Response;
    }
    throw new Error(`unexpected fetch: ${u} ${JSON.stringify(init)}`);
  }));
}

function eventsPublished(): Array<Record<string, any>> {
  return vi.mocked(fetch).mock.calls
    .filter(c => String(c[0]).includes("/v1/events"))
    .map(c => JSON.parse(String((c[1] as RequestInit).body)));
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

function ctxFor(user: { id: number; role: string; tenantId: number | null }): TrpcContext {
  return {
    user: { name: "Test User", email: "user@test.dev", ...user } as TrpcContext["user"],
    tenantId: user.tenantId,
    isDemo: false,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function seedEnrollment(overrides: Partial<FakeEnrollment> = {}): FakeEnrollment {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenant_id: 7,
    investigation_ref: "INV-2026-AAAA",
    subject_name: "Adaeze Okafor",
    subject_identifiers: { dob: "1990-05-01" },
    list_set: ["sanctions", "pep"],
    frequency: "daily",
    status: "active",
    last_run_at: null,
    next_run_at: new Date(Date.now() - 60_000), // due
    baseline_snapshot: { screenedAt: new Date().toISOString(), lists: ["pep", "sanctions"], hits: [] },
    created_by: 11,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

/** What normalizeGatewayHits produces from the gateway payload below. */
const sanctionsHit = {
  hitKey: "sanctions:adaeze okafor",
  listName: "sanctions",
  matchedName: "Adaeze Okafor",
  matchScore: 0.97,
  status: "active",
  severity: "critical" as const,
};

const SANCTIONS_PAYLOAD_WITH_HIT = { clear: false, hits: [{ list: "sanctions", name: "Adaeze Okafor", score: 0.97 }] };

beforeEach(() => {
  holder.pool = new FakePg();
  holder.gatewayPayloads = { sanctions: { clear: true, hits: [] }, pep: { isPEP: false } };
  holder.gatewayFail = { sanctions: false, pep: false };
  stubGatewayFetch();
});

// ─── Gateway payload normalization ────────────────────────────────────────────

describe("normalizeGatewayHits", () => {
  it("normalizes sanctions hits with critical severity", () => {
    expect(normalizeGatewayHits("sanctions", "Adaeze Okafor", SANCTIONS_PAYLOAD_WITH_HIT)).toEqual([sanctionsHit]);
  });

  it("normalizes a positive PEP payload into one warning hit", () => {
    const hits = normalizeGatewayHits("pep", "Adaeze Okafor", { isPEP: true, roles: ["Senator"] });
    expect(hits).toEqual([{
      hitKey: "pep:adaeze okafor",
      listName: "pep",
      matchedName: "Adaeze Okafor",
      matchScore: null,
      status: "PEP: Senator",
      severity: "warning",
    }]);
  });

  it("returns no hits for clear or malformed payloads", () => {
    expect(normalizeGatewayHits("sanctions", "Adaeze Okafor", { clear: true, hits: [] })).toEqual([]);
    expect(normalizeGatewayHits("pep", "Adaeze Okafor", { isPEP: false })).toEqual([]);
    expect(normalizeGatewayHits("sanctions", "Adaeze Okafor", null)).toEqual([]);
  });
});

// ─── Pure diff + cadence math ─────────────────────────────────────────────────

describe("diffSnapshots", () => {
  const base: MonitoringSnapshot = { screenedAt: "2026-01-01T00:00:00.000Z", lists: ["sanctions"], hits: [sanctionsHit] };

  it("detects no change for identical snapshots", () => {
    const delta = diffSnapshots(base, { ...base, screenedAt: "2026-01-02T00:00:00.000Z" });
    expect(delta.newHits).toHaveLength(0);
    expect(delta.removedHits).toHaveLength(0);
    expect(delta.changedHits).toHaveLength(0);
  });

  it("detects a new hit", () => {
    const pep = { hitKey: "pep:adaeze okafor", listName: "pep", matchedName: "Adaeze Okafor", matchScore: null, status: "active", severity: "warning" as const };
    const delta = diffSnapshots({ ...base, hits: [] }, { ...base, hits: [pep] });
    expect(delta.newHits).toEqual([pep]);
    expect(delta.removedHits).toHaveLength(0);
  });

  it("detects a removed hit", () => {
    const delta = diffSnapshots(base, { ...base, hits: [] });
    expect(delta.removedHits).toEqual([sanctionsHit]);
    expect(delta.newHits).toHaveLength(0);
  });

  it("detects a changed hit when severity or status moves", () => {
    const escalated = { ...sanctionsHit, status: "confirmed" };
    const delta = diffSnapshots(base, { ...base, hits: [escalated] });
    expect(delta.changedHits).toEqual([{ before: sanctionsHit, after: escalated }]);
    expect(delta.newHits).toHaveLength(0);
    expect(delta.removedHits).toHaveLength(0);
  });
});

describe("computeNextRunAt", () => {
  const from = new Date("2026-01-15T10:30:00.000Z");

  it("adds one day for daily frequency", () => {
    expect(computeNextRunAt("daily", from).toISOString()).toBe("2026-01-16T10:30:00.000Z");
  });

  it("adds seven days for weekly frequency", () => {
    expect(computeNextRunAt("weekly", from).toISOString()).toBe("2026-01-22T10:30:00.000Z");
  });

  it("adds one calendar month for monthly frequency", () => {
    expect(computeNextRunAt("monthly", from).toISOString()).toBe("2026-02-15T10:30:00.000Z");
  });

  it("clamps monthly rollover to the last day of the target month (Jan 31 → Feb 28)", () => {
    const jan31 = new Date("2026-01-31T09:00:00.000Z");
    expect(computeNextRunAt("monthly", jan31).toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });
});

// ─── Router: enroll + lifecycle + tenant isolation ────────────────────────────

describe("monitoring.enroll", () => {
  beforeEach(() => {
    holder.pool.store.investigations.push({
      ref: "INV-2026-AAAA", subjectName: "Adaeze Okafor", nin: "12345678901", bvn: null, tenantId: 7, deletedAt: null,
    });
  });

  it("enrolls with a baseline snapshot and scheduled next run", async () => {
    holder.gatewayPayloads.sanctions = SANCTIONS_PAYLOAD_WITH_HIT;
    const caller = monitoringRouter.createCaller(ctxFor({ id: 11, role: "analyst", tenantId: 7 }));
    const result = await caller.enroll({ investigationRef: "INV-2026-AAAA", frequency: "weekly", listSet: ["sanctions", "pep"] });
    expect(result.status).toBe("active");

    const stored = holder.pool.store.enrollments[0];
    expect(stored.tenant_id).toBe(7);
    expect(stored.investigation_ref).toBe("INV-2026-AAAA");
    expect(stored.baseline_snapshot?.hits).toEqual([sanctionsHit]);
    expect(stored.next_run_at!.getTime()).toBeGreaterThan(Date.now());
    expect(stored.next_run_at!.getTime()).toBeLessThanOrEqual(Date.now() + 8 * 24 * 3600 * 1000);
    // NIN from the investigation is merged into stored identifiers
    expect(stored.subject_identifiers.nin).toBe("12345678901");
    // The enrollment event is published
    expect(eventsPublished().some(e => e.event_type === "MONITORING_ENROLLED")).toBe(true);
  });

  it("fails closed when the baseline screening cannot complete", async () => {
    holder.gatewayFail.sanctions = true;
    const caller = monitoringRouter.createCaller(ctxFor({ id: 11, role: "analyst", tenantId: 7 }));
    await expect(caller.enroll({ investigationRef: "INV-2026-AAAA", frequency: "daily", listSet: ["sanctions"] }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(holder.pool.store.enrollments).toHaveLength(0);
  });

  it("rejects investigations owned by another tenant", async () => {
    const caller = monitoringRouter.createCaller(ctxFor({ id: 11, role: "analyst", tenantId: 8 }));
    await expect(caller.enroll({ investigationRef: "INV-2026-AAAA", frequency: "daily", listSet: ["sanctions"] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(holder.pool.store.enrollments).toHaveLength(0);
  });

  it("rejects duplicate live enrollments", async () => {
    holder.pool.store.enrollments.push(seedEnrollment());
    const caller = monitoringRouter.createCaller(ctxFor({ id: 11, role: "analyst", tenantId: 7 }));
    await expect(caller.enroll({ investigationRef: "INV-2026-AAAA", frequency: "daily", listSet: ["sanctions"] }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("monitoring lifecycle state machine", () => {
  it("pauses, resumes (rescheduling next_run_at), and cancels", async () => {
    holder.pool.store.enrollments.push(seedEnrollment());
    const caller = monitoringRouter.createCaller(ctxFor({ id: 11, role: "analyst", tenantId: 7 }));
    const id = "11111111-1111-4111-8111-111111111111";

    expect((await caller.pause({ enrollmentId: id })).status).toBe("paused");
    expect(holder.pool.store.enrollments[0].status).toBe("paused");
    expect(holder.pool.store.enrollments[0].next_run_at).toBeNull();

    // Cannot pause twice
    await expect(caller.pause({ enrollmentId: id })).rejects.toMatchObject({ code: "CONFLICT" });

    const resumed = await caller.resume({ enrollmentId: id });
    expect(resumed.status).toBe("active");
    expect(resumed.nextRunAt.getTime()).toBeGreaterThan(Date.now());

    expect((await caller.cancel({ enrollmentId: id })).status).toBe("cancelled");
    await expect(caller.cancel({ enrollmentId: id })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("tenant isolation", () => {
  beforeEach(() => {
    holder.pool.store.enrollments.push(seedEnrollment());
    holder.pool.store.alerts.push({
      id: "22222222-2222-4222-8222-222222222222",
      tenant_id: 7,
      enrollment_id: "11111111-1111-4111-8111-111111111111",
      run_id: 1,
      alert_type: "new_hit",
      severity: "critical",
      delta: { hit: sanctionsHit },
      acknowledged_at: null,
      acknowledged_by: null,
      created_at: new Date(),
    });
  });

  it("scopes list and getEnrollment to the caller tenant", async () => {
    const other = monitoringRouter.createCaller(ctxFor({ id: 99, role: "analyst", tenantId: 8 }));
    expect((await other.list({})).enrollments).toHaveLength(0);
    await expect(other.getEnrollment({ enrollmentId: "11111111-1111-4111-8111-111111111111" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    const own = monitoringRouter.createCaller(ctxFor({ id: 11, role: "analyst", tenantId: 7 }));
    expect((await own.list({})).enrollments).toHaveLength(1);
    const detail = await own.getEnrollment({ enrollmentId: "11111111-1111-4111-8111-111111111111" });
    expect(detail.alerts.unacknowledged).toBe(1);
  });

  it("scopes getAlerts to the caller tenant with unacknowledged first", async () => {
    const other = monitoringRouter.createCaller(ctxFor({ id: 99, role: "analyst", tenantId: 8 }));
    expect((await other.getAlerts({})).alerts).toHaveLength(0);

    const own = monitoringRouter.createCaller(ctxFor({ id: 11, role: "analyst", tenantId: 7 }));
    const { alerts } = await own.getAlerts({});
    expect(alerts).toHaveLength(1);
    expect(alerts[0].acknowledged_at).toBeNull();
    expect(alerts[0].investigation_ref).toBe("INV-2026-AAAA");
  });

  it("blocks lifecycle mutations across tenants", async () => {
    const other = monitoringRouter.createCaller(ctxFor({ id: 99, role: "admin", tenantId: 8 }));
    const id = "11111111-1111-4111-8111-111111111111";
    await expect(other.pause({ enrollmentId: id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(other.cancel({ enrollmentId: id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(holder.pool.store.enrollments[0].status).toBe("active");
  });
});

describe("monitoring.acknowledgeAlert authorization", () => {
  const alertId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    holder.pool.store.enrollments.push(seedEnrollment());
    holder.pool.store.alerts.push({
      id: alertId,
      tenant_id: 7,
      enrollment_id: "11111111-1111-4111-8111-111111111111",
      run_id: 1,
      alert_type: "new_hit",
      severity: "critical",
      delta: { hit: sanctionsHit },
      acknowledged_at: null,
      acknowledged_by: null,
      created_at: new Date(),
    });
  });

  it("rejects non-reviewer roles", async () => {
    const caller = monitoringRouter.createCaller(ctxFor({ id: 11, role: "analyst", tenantId: 7 }));
    await expect(caller.acknowledgeAlert({ alertId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(holder.pool.store.alerts[0].acknowledged_at).toBeNull();
  });

  it("allows admins and records the acknowledger exactly once", async () => {
    const admin = monitoringRouter.createCaller(ctxFor({ id: 1, role: "admin", tenantId: 7 }));
    expect((await admin.acknowledgeAlert({ alertId })).acknowledged).toBe(true);
    expect(holder.pool.store.alerts[0].acknowledged_by).toBe(1);
    // Second acknowledgement is a conflict — no silent re-ack
    await expect(admin.acknowledgeAlert({ alertId })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("blocks acknowledgement from another tenant even for admins", async () => {
    const foreign = monitoringRouter.createCaller(ctxFor({ id: 2, role: "admin", tenantId: 8 }));
    await expect(foreign.acknowledgeAlert({ alertId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(holder.pool.store.alerts[0].acknowledged_at).toBeNull();
  });
});

// ─── Scheduler: alert fan-out, no-change, fail-closed error ───────────────────

describe("processDueMonitoringEnrollments", () => {
  it("detects a new sanctions hit, records the run, raises a critical alert, and publishes MONITORING_ALERT", async () => {
    holder.pool.store.enrollments.push(seedEnrollment());
    holder.gatewayPayloads.sanctions = SANCTIONS_PAYLOAD_WITH_HIT;

    const result = await processDueMonitoringEnrollments();
    expect(result).toEqual({ claimed: 1, changed: 1, noChange: 0, errors: 0 });

    const run = holder.pool.store.runs[0];
    expect(run.result).toBe("change_detected");
    expect(run.snapshot?.hits).toEqual([sanctionsHit]);

    const alert = holder.pool.store.alerts[0];
    expect(alert.alert_type).toBe("new_hit");
    expect(alert.severity).toBe("critical");
    expect(alert.tenant_id).toBe(7);

    // Baseline advances and cadence is rescheduled
    const enrollment = holder.pool.store.enrollments[0];
    expect(enrollment.baseline_snapshot?.hits).toEqual([sanctionsHit]);
    expect(enrollment.next_run_at!.getTime()).toBeGreaterThan(Date.now());

    const alerts = eventsPublished().filter(e => e.event_type === "MONITORING_ALERT");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].subject_ref).toBe("INV-2026-AAAA");
  });

  it("records no_change without raising alerts when the snapshot is stable", async () => {
    holder.pool.store.enrollments.push(seedEnrollment({
      baseline_snapshot: { screenedAt: new Date().toISOString(), lists: ["pep", "sanctions"], hits: [sanctionsHit] },
    }));
    holder.gatewayPayloads.sanctions = SANCTIONS_PAYLOAD_WITH_HIT;

    const result = await processDueMonitoringEnrollments();
    expect(result).toEqual({ claimed: 1, changed: 0, noChange: 1, errors: 0 });
    expect(holder.pool.store.runs[0].result).toBe("no_change");
    expect(holder.pool.store.alerts).toHaveLength(0);
    expect(eventsPublished()).toHaveLength(0);
  });

  it("fails closed on screening errors: error run row, unchanged baseline, no alerts", async () => {
    const baseline = { screenedAt: new Date().toISOString(), lists: ["pep", "sanctions"], hits: [sanctionsHit] };
    holder.pool.store.enrollments.push(seedEnrollment({ baseline_snapshot: baseline }));
    holder.gatewayFail.sanctions = true;

    const result = await processDueMonitoringEnrollments();
    expect(result).toEqual({ claimed: 1, changed: 0, noChange: 0, errors: 1 });

    const run = holder.pool.store.runs[0];
    expect(run.result).toBe("error");
    expect(run.error).toBe("screening_failed:provider_http_503");
    expect(holder.pool.store.alerts).toHaveLength(0);
    // Baseline is preserved — an error must never look like "all clear"
    expect(holder.pool.store.enrollments[0].baseline_snapshot).toEqual(baseline);
    expect(holder.pool.store.enrollments[0].status).toBe("active");
    expect(eventsPublished()).toHaveLength(0);
  });

  it("raises removed_hit alerts when a previously matched hit disappears", async () => {
    holder.pool.store.enrollments.push(seedEnrollment({
      baseline_snapshot: { screenedAt: new Date().toISOString(), lists: ["pep", "sanctions"], hits: [sanctionsHit] },
    }));
    // default gateway payloads are clear → the hit disappeared

    const result = await processDueMonitoringEnrollments();
    expect(result.changed).toBe(1);
    expect(holder.pool.store.alerts[0].alert_type).toBe("removed_hit");
    expect(holder.pool.store.alerts[0].severity).toBe("info");
    // Removed hits are not critical — but the event is still published
    const alerts = eventsPublished().filter(e => e.event_type === "MONITORING_ALERT");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
  });

  it("skips paused, cancelled, and not-yet-due enrollments", async () => {
    holder.pool.store.enrollments.push(
      seedEnrollment({ id: "33333333-3333-4333-8333-333333333333", status: "paused", next_run_at: null }),
      seedEnrollment({ id: "44444444-4444-4444-8444-444444444444", status: "cancelled", next_run_at: null }),
      seedEnrollment({ id: "55555555-5555-4555-8555-555555555555", next_run_at: new Date(Date.now() + 3_600_000) }),
    );
    const result = await processDueMonitoringEnrollments();
    expect(result).toEqual({ claimed: 0, changed: 0, noChange: 0, errors: 0 });
    expect(holder.pool.store.runs).toHaveLength(0);
  });
});
