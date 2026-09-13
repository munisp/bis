/**
 * server/share-subscribe.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * WP4 coverage for shareable investigation reports + self-service signups:
 *
 *   - share-token lifecycle: create → view (atomic count) → revoke → rejected
 *   - redaction shape: forbidden keys (referees, raw payloads, notes, user IDs,
 *     raw scores, token hashes) are absent from the serialised one-pager
 *   - idempotency replay: a repeated signup idempotency key returns the
 *     original result and never re-settles payment
 *   - fail-closed signup: a failed provider payment activates NO subscription
 *   - tenant scoping: cross-tenant share creation / payment binding is denied
 *
 * The pg pool is replaced by a stateful in-memory handler that executes the
 * real SQL strings issued by the routers and by settlePaystackPayment. External
 * HTTP boundaries (Paystack verify, TigerBeetle ledger, event processor) are
 * intercepted with a stubbed global fetch; all business logic under test is
 * the production code path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.JWT_SECRET = "share-subscribe-test-secret";
  process.env.TIGERBEETLE_URL = "http://tigerbeetle.test";
  process.env.PAYSTACK_SECRET_KEY = "sk_test_share_subscribe";
  process.env.EVENT_PROCESSOR_URL = "http://events.test";
});

// ─── Stateful in-memory PostgreSQL ────────────────────────────────────────────

type Row = Record<string, any>;

type State = ReturnType<typeof makeState>;

function makeState() {
  return {
    tenants: new Map<number, string>([[1, "Acme Verification Ltd"], [2, "Other Tenant Co"]]),
    investigations: new Map<string, Row>(),
    shareLinks: [] as Row[],
    screening: [] as Row[],
    fieldVisits: [] as Row[],
    plans: new Map<string, Row>(),
    intents: new Map<string, Row>(),
    topups: [] as Row[],
    signups: [] as Row[],
    subscriptions: [] as Row[],
    entitlements: [] as Row[],
    usageEvents: [] as Row[],
    auditLog: [] as Row[],
  };
}

function rows(list: Row[]) {
  return { rows: list, rowCount: list.length };
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
    if (sql.startsWith('SELECT id, "subjectName"')) {
      const inv = state.investigations.get(String(values[0]));
      return rows(inv && inv.tenantId === values[1] && !inv.deletedAt ? [inv] : []);
    }

    // ── report_share_links ──────────────────────────────────────────────────
    if (sql.startsWith("INSERT INTO report_share_links")) {
      const [id, tenantId, investigationRef, tokenHash, createdBy, expiresAt] = values as any[];
      if (state.shareLinks.some((l) => l.token_hash === tokenHash)) {
        const err = new Error("duplicate key value violates unique constraint") as any;
        err.code = "23505";
        throw err;
      }
      const row = { id, tenant_id: tenantId, investigation_ref: investigationRef, token_hash: tokenHash, created_by: createdBy, expires_at: expiresAt, revoked_at: null, view_count: 0, last_viewed_at: null, created_at: new Date() };
      state.shareLinks.push(row);
      return rows([{ id: row.id, expires_at: row.expires_at, created_at: row.created_at }]);
    }
    if (sql.startsWith("UPDATE report_share_links SET view_count")) {
      const link = state.shareLinks.find((l) => l.token_hash === values[0] && l.revoked_at === null && new Date(l.expires_at).getTime() > Date.now());
      if (!link) return rows([]);
      link.view_count += 1;
      link.last_viewed_at = new Date();
      return rows([{ id: link.id, tenant_id: link.tenant_id, investigation_ref: link.investigation_ref }]);
    }
    if (sql.startsWith("UPDATE report_share_links SET revoked_at")) {
      const link = state.shareLinks.find((l) => l.id === values[0] && l.tenant_id === values[1] && l.revoked_at === null);
      if (!link) return rows([]);
      link.revoked_at = new Date();
      return rows([{ id: link.id, investigation_ref: link.investigation_ref }]);
    }
    if (sql.startsWith("SELECT id, investigation_ref, expires_at")) {
      const list = state.shareLinks
        .filter((l) => l.tenant_id === values[0] && (values.length < 2 || l.investigation_ref === values[1]))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return rows(list);
    }

    // ── screening / field visits / tenants ──────────────────────────────────
    if (sql.includes("FROM screening_results")) {
      const list = state.screening
        .filter((s) => s.investigationRef === values[0] && s.tenantId === values[1] && s.status === "completed")
        .sort((a, b) => String(a.screeningType).localeCompare(String(b.screeningType)));
      return rows(list.map((s) => ({ source: s.screeningType, outcome: s.outcome })));
    }
    if (sql.includes("FROM field_visit_reports")) {
      const list = state.fieldVisits.filter((v) => v.investigationId === values[0]);
      return rows(list.slice(0, 1));
    }
    if (sql.startsWith("SELECT name FROM tenants")) {
      const name = state.tenants.get(Number(values[0]));
      return rows(name ? [{ name }] : []);
    }

    // ── audit ───────────────────────────────────────────────────────────────
    if (sql.startsWith("INSERT INTO audit_log")) {
      state.auditLog.push({ tenantId: values[0], userId: values[1], action: values[2], targetRef: values[3], result: values[4] });
      return rows([]);
    }

    // ── plan_signups ────────────────────────────────────────────────────────
    if (sql.startsWith("SELECT id, plan_code, status, billing_ref FROM plan_signups")) {
      // Tenant-scoped replay lookup: WHERE tenant_id = $1 AND idempotency_key = $2
      return rows(state.signups.filter((s) => s.tenant_id === values[0] && s.idempotency_key === values[1]));
    }
    if (sql.startsWith("INSERT INTO plan_signups")) {
      const [id, tenantId, planCode, billingRef, idempotencyKey, createdBy] = values as any[];
      // UNIQUE (tenant_id, idempotency_key)
      if (state.signups.some((s) => s.tenant_id === tenantId && s.idempotency_key === idempotencyKey)) {
        if (sql.includes("ON CONFLICT")) return rows([]); // ON CONFLICT DO NOTHING
        const err = new Error("duplicate key value violates unique constraint") as any;
        err.code = "23505";
        throw err;
      }
      const status = sql.includes("'payment_failed'") ? "payment_failed" : "active";
      state.signups.push({ id, tenant_id: tenantId, plan_code: planCode, status, billing_ref: billingRef, idempotency_key: idempotencyKey, created_by: createdBy, created_at: new Date() });
      return rows([]);
    }

    // ── billing_plans ───────────────────────────────────────────────────────
    if (sql.startsWith("SELECT id, plan_code, billing_interval, price_kobo")) {
      const plan = state.plans.get(String(values[0]));
      return rows(plan && plan.active ? [plan] : []);
    }
    if (sql.startsWith("SELECT plan_code, display_name")) {
      return rows([...state.plans.values()].filter((p) => p.active).sort((a, b) => Number(a.price_kobo) - Number(b.price_kobo)));
    }

    // ── billing_payment_intents ─────────────────────────────────────────────
    if (sql.includes("FROM billing_payment_intents") && sql.includes("FOR UPDATE")) {
      const intent = state.intents.get(String(values[0]));
      return rows(intent ? [intent] : []);
    }
    if (sql.startsWith("SELECT tenant_id, purpose, amount_kobo FROM billing_payment_intents")) {
      const intent = state.intents.get(String(values[0]));
      return rows(intent ? [intent] : []);
    }
    if (sql.startsWith("UPDATE billing_payment_intents SET status = 'credited'")) {
      const intent = [...state.intents.values()].find((i) => i.id === values[0]);
      if (!intent || !["pending", "verified"].includes(intent.status)) return rows([]);
      intent.status = "credited";
      return rows([{ id: intent.id }]);
    }

    // ── billing_topups ──────────────────────────────────────────────────────
    if (sql.startsWith("INSERT INTO billing_topups")) {
      state.topups.push({ tenantId: values[0], reference: values[1], amountKobo: values[2], channel: values[3], tbTransferId: values[4] });
      return rows([]);
    }

    // ── tenant_subscriptions ────────────────────────────────────────────────
    if (sql.startsWith("SELECT id FROM tenant_subscriptions WHERE tenant_id")) {
      return rows(state.subscriptions.filter((s) => s.tenant_id === values[0] && s.provider_subscription_ref === values[1]).map((s) => ({ id: s.id })));
    }
    if (sql.startsWith("UPDATE tenant_subscriptions SET status = 'cancelled'")) {
      let count = 0;
      for (const s of state.subscriptions) {
        if (s.tenant_id === values[0] && ["pending", "active", "past_due", "cancelling"].includes(s.status)) {
          s.status = "cancelled";
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (sql.startsWith("INSERT INTO tenant_subscriptions")) {
      const [id, tenantId, planId, provider, providerRef, periodStart, periodEnd, createdBy] = values as any[];
      // Real schema: GLOBAL UNIQUE(provider, provider_subscription_ref)
      if (state.subscriptions.some((s) => s.provider === provider && s.provider_subscription_ref === providerRef)) {
        const err = new Error("duplicate key value violates unique constraint \"tenant_subscriptions_provider_ref_unique\"") as any;
        err.code = "23505";
        throw err;
      }
      state.subscriptions.push({ id, tenant_id: tenantId, plan_id: planId, provider, provider_subscription_ref: providerRef, status: "active", current_period_start: periodStart, current_period_end: periodEnd, cancel_at_period_end: false, created_by: createdBy, created_at: new Date() });
      return rows([]);
    }
    if (sql.includes("FROM tenant_subscriptions s JOIN billing_plans")) {
      const sub = [...state.subscriptions]
        .filter((s) => s.tenant_id === values[0] && ["pending", "active", "past_due", "cancelling"].includes(s.status))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
      if (!sub) return rows([]);
      const plan = [...state.plans.values()].find((p) => String(p.id) === String(sub.plan_id));
      return rows([{ ...sub, plan_code: plan?.plan_code, display_name: plan?.display_name, billing_interval: plan?.billing_interval, price_kobo: plan?.price_kobo, included_completed_checks: plan?.included_completed_checks }]);
    }

    // ── billing_entitlements / usage ────────────────────────────────────────
    if (sql.startsWith("INSERT INTO billing_entitlements")) {
      const [id, tenantId, subscriptionId, totalUnits, periodStart, periodEnd, sourceReference] = values as any[];
      // Real schema: GLOBAL UNIQUE(source_reference)
      if (state.entitlements.some((e) => e.source_reference === sourceReference)) {
        const err = new Error("duplicate key value violates unique constraint \"billing_entitlements_source_reference_key\"") as any;
        err.code = "23505";
        throw err;
      }
      state.entitlements.push({ id, tenant_id: tenantId, subscription_id: subscriptionId, total_units: totalUnits, consumed_units: 0, reserved_units: 0, period_start: periodStart, period_end: periodEnd, status: "active", source_reference: sourceReference });
      return rows([]);
    }
    if (sql.includes("COALESCE(SUM(total_units)")) {
      const active = state.entitlements.filter((e) => e.tenant_id === values[0] && e.status === "active" && new Date(e.period_end).getTime() > Date.now());
      return rows([{
        total_units: active.reduce((n, e) => n + Number(e.total_units), 0),
        consumed_units: active.reduce((n, e) => n + Number(e.consumed_units), 0),
        reserved_units: active.reduce((n, e) => n + Number(e.reserved_units), 0),
      }]);
    }
    if (sql.includes("FROM billing_usage_events")) {
      return rows([{ completed_checks: state.usageEvents.filter((u) => u.tenant_id === values[0]).length }]);
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
vi.mock("./permify", () => ({ permifyCheck: vi.fn(async () => true), permifyWriteRelationship: vi.fn(async () => undefined) }));

// ─── External HTTP boundary (Paystack verify, TigerBeetle, event processor) ──

const fetchCalls = { paystackVerify: 0, tigerBeetleTransfer: 0, tigerBeetleAccount: 0, events: 0 };
let paystackBehaviour: "success" | "failed" | "rejected" = "success";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.paystack.co/transaction/verify/")) {
      fetchCalls.paystackVerify += 1;
      const reference = decodeURIComponent(url.split("/transaction/verify/")[1]);
      const intent = mocks.state.intents.get(reference);
      if (paystackBehaviour === "rejected") return jsonResponse({ status: false, message: "Could not resolve transaction" }, 404);
      if (paystackBehaviour === "failed") {
        return jsonResponse({ status: true, data: { status: "failed", amount: intent?.amount_kobo ?? 0, currency: "NGN", reference } });
      }
      return jsonResponse({ status: true, data: { status: "success", amount: Number(intent?.amount_kobo ?? 0), currency: "NGN", reference, channel: "card" } });
    }
    if (url.startsWith("http://tigerbeetle.test/accounts/create")) {
      fetchCalls.tigerBeetleAccount += 1;
      return jsonResponse([{ index: 0, result: 0 }]);
    }
    if (url.startsWith("http://tigerbeetle.test/transfers/create")) {
      fetchCalls.tigerBeetleTransfer += 1;
      return jsonResponse([{ index: 0, result: 0 }]);
    }
    if (url.startsWith("http://events.test/v1/events")) {
      fetchCalls.events += 1;
      return jsonResponse({ accepted: true });
    }
    throw new Error(`stubFetch: unexpected URL ${url} ${init?.method ?? "GET"}`);
  }));
}

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { shareableReportsRouter, __shareableReportsInternals } from "./shareableReports";
import { selfServiceBillingRouter } from "./selfServiceBilling";
import type { TrpcContext } from "./_core/context";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(tenantId: number | null, userId = 10): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `wp4-user-${userId}`,
      email: `wp4-user-${userId}@example.invalid`,
      name: "WP4 Operator",
      loginMethod: "keycloak",
      role: "admin",
      tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    tenantId,
    isDemo: false,
    authMethod: "keycloak",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const PLAN_PRO = {
  id: "7",
  plan_code: "pro_monthly",
  display_name: "Professional Monthly",
  billing_interval: "monthly",
  price_kobo: 15_000_000,
  included_completed_checks: 40,
  overage_price_kobo: 250_000,
  active: true,
  version: 1,
};

const REF = "BIS-2026-ABC123";

function seedInvestigation(overrides: Partial<Row> = {}) {
  mocks.state.investigations.set(REF, {
    id: 501,
    ref: REF,
    tenantId: 1,
    subjectName: "Adaeze Okonkwo",
    status: "completed",
    riskTier: null,
    riskScore: 82.4,
    completedAt: new Date("2026-02-01T10:00:00Z"),
    deletedAt: null,
    ...overrides,
  });
}

function seedScreening() {
  mocks.state.screening.push(
    { investigationRef: REF, tenantId: 1, screeningType: "nin_trace", outcome: "clear", status: "completed" },
    { investigationRef: REF, tenantId: 1, screeningType: "efcc_watchlist", outcome: "adverse", status: "completed" },
    { investigationRef: REF, tenantId: 1, screeningType: "pep_check", outcome: "consider", status: "completed" },
  );
  mocks.state.fieldVisits.push({ investigationId: 501, outcome: "confirmed", submittedAt: new Date("2026-01-30T09:00:00Z") });
}

function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
  return into;
}

beforeEach(() => {
  const fresh = makeState();
  Object.assign(mocks.state, fresh);
  mocks.state.tenants = fresh.tenants;
  paystackBehaviour = "success";
  fetchCalls.paystackVerify = 0;
  fetchCalls.tigerBeetleTransfer = 0;
  fetchCalls.tigerBeetleAccount = 0;
  fetchCalls.events = 0;
  stubFetch();
});

// ─── Share-token lifecycle ────────────────────────────────────────────────────

describe("shareableReports — token lifecycle", () => {
  it("creates a bis_sl_ token, stores only its SHA-256 hash, and audits + publishes", async () => {
    seedInvestigation();
    const caller = shareableReportsRouter.createCaller(makeCtx(1));
    const result = await caller.createShareLink({ investigationRef: REF, expiresInDays: 7 });

    expect(result.token).toMatch(/^bis_sl_[A-Za-z0-9_-]{32}$/);
    expect(result.investigationRef).toBe(REF);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

    expect(mocks.state.shareLinks).toHaveLength(1);
    const stored = mocks.state.shareLinks[0];
    expect(stored.token_hash).toBe(__shareableReportsInternals.hashShareToken(result.token));
    expect(JSON.stringify(stored)).not.toContain(result.token);
    expect(mocks.state.auditLog.some((a) => a.action === "Report share link created" && a.tenantId === 1)).toBe(true);
    expect(fetchCalls.events).toBe(1);
  });

  it("serves the redacted report, atomically counting views, until revoked", async () => {
    seedInvestigation();
    seedScreening();
    const caller = shareableReportsRouter.createCaller(makeCtx(1));
    const { token, shareLinkId } = await caller.createShareLink({ investigationRef: REF, expiresInDays: 7 });

    const first = await shareableReportsRouter.createCaller(makeCtx(null)).getSharedReport({ token });
    const second = await shareableReportsRouter.createCaller(makeCtx(null)).getSharedReport({ token });
    expect(first.subjectName).toBe("Adaeze Okonkwo");
    expect(second.subjectName).toBe("Adaeze Okonkwo");
    expect(mocks.state.shareLinks[0].view_count).toBe(2);
    expect(mocks.state.shareLinks[0].last_viewed_at).toBeInstanceOf(Date);

    await caller.revokeShareLink({ shareLinkId });
    await expect(shareableReportsRouter.createCaller(makeCtx(null)).getSharedReport({ token }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    // Revoked links cannot accrue further views.
    expect(mocks.state.shareLinks[0].view_count).toBe(2);
  });

  it("rejects expired links", async () => {
    seedInvestigation();
    const caller = shareableReportsRouter.createCaller(makeCtx(1));
    const { token } = await caller.createShareLink({ investigationRef: REF, expiresInDays: 1 });
    mocks.state.shareLinks[0].expires_at = new Date(Date.now() - 60_000);
    await expect(shareableReportsRouter.createCaller(makeCtx(null)).getSharedReport({ token }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects unknown tokens and caps expiry at 30 days", async () => {
    await expect(
      shareableReportsRouter.createCaller(makeCtx(null)).getSharedReport({ token: `bis_sl_${"a".repeat(32)}` }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    seedInvestigation();
    await expect(
      shareableReportsRouter.createCaller(makeCtx(1)).createShareLink({ investigationRef: REF, expiresInDays: 31 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lists share links tenant-scoped without token hashes", async () => {
    seedInvestigation();
    const caller = shareableReportsRouter.createCaller(makeCtx(1));
    await caller.createShareLink({ investigationRef: REF, expiresInDays: 7 });
    await caller.createShareLink({ investigationRef: REF, expiresInDays: 14 });

    const own = await caller.listShareLinks({});
    expect(own).toHaveLength(2);
    expect(own[0].viewCount).toBe(0);
    expect(own[0].active).toBe(true);
    const keys = collectKeys(own);
    expect(keys.has("token_hash")).toBe(false);
    expect(keys.has("tokenHash")).toBe(false);
    expect(keys.has("created_by")).toBe(false);

    const other = await shareableReportsRouter.createCaller(makeCtx(2)).listShareLinks({});
    expect(other).toHaveLength(0);
  });
});

// ─── Redaction shape ──────────────────────────────────────────────────────────

describe("shareableReports — redaction shape", () => {
  it("returns only the whitelisted one-pager and derives band from score", async () => {
    seedInvestigation();
    seedScreening();
    const caller = shareableReportsRouter.createCaller(makeCtx(1));
    const { token } = await caller.createShareLink({ investigationRef: REF, expiresInDays: 7 });
    const report = await shareableReportsRouter.createCaller(makeCtx(null)).getSharedReport({ token });

    expect(report).toEqual({
      subjectName: "Adaeze Okonkwo",
      investigationRef: REF,
      riskBand: "critical", // derived from 82.4 — the raw score never appears
      screening: [
        { source: "efcc_watchlist", outcome: "fail" },
        { source: "nin_trace", outcome: "pass" },
        { source: "pep_check", outcome: "consider" },
      ],
      fieldVisit: { outcome: "confirmed", conductedAt: "2026-01-30T09:00:00.000Z" },
      thinFile: false,
      generatedAt: expect.any(String),
      completedAt: "2026-02-01T10:00:00.000Z",
      tenantName: "Acme Verification Ltd",
    });

    const keys = collectKeys(report);
    const forbidden = [
      "riskScore", "risk_score", "rawResult", "raw_result", "payload", "summary",
      "referee", "refereeName", "source_display_name", "notes", "findings",
      "createdBy", "created_by", "userId", "user_id", "agentId", "agentName",
      "token", "tokenHash", "token_hash", "nin", "bvn",
    ];
    for (const key of forbidden) expect(keys.has(key)).toBe(false);
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain("82.4");
    expect(serialised).not.toContain("rawResult");
    expect(serialised).not.toContain("referee");
  });

  it("flags thin files when no completed screening exists", async () => {
    seedInvestigation({ status: "thin_file", riskScore: null, riskTier: null });
    const caller = shareableReportsRouter.createCaller(makeCtx(1));
    const { token } = await caller.createShareLink({ investigationRef: REF, expiresInDays: 7 });
    const report = await shareableReportsRouter.createCaller(makeCtx(null)).getSharedReport({ token });
    expect(report.thinFile).toBe(true);
    expect(report.riskBand).toBe("unrated");
    expect(report.screening).toEqual([]);
    expect(report.fieldVisit).toBeNull();
  });
});

// ─── Tenant scoping ───────────────────────────────────────────────────────────

describe("tenant scoping", () => {
  it("denies share creation for another tenant's investigation", async () => {
    seedInvestigation({ tenantId: 2 });
    await expect(
      shareableReportsRouter.createCaller(makeCtx(1)).createShareLink({ investigationRef: REF, expiresInDays: 7 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.state.shareLinks).toHaveLength(0);
  });

  it("denies revoking another tenant's share link", async () => {
    seedInvestigation();
    const { shareLinkId } = await shareableReportsRouter.createCaller(makeCtx(1))
      .createShareLink({ investigationRef: REF, expiresInDays: 7 });
    await expect(
      shareableReportsRouter.createCaller(makeCtx(2)).revokeShareLink({ shareLinkId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.state.shareLinks[0].revoked_at).toBeNull();
  });

  it("requires an authenticated tenant context for mutations", async () => {
    const anonymous = { ...makeCtx(null), user: null };
    await expect(
      shareableReportsRouter.createCaller(anonymous).createShareLink({ investigationRef: REF, expiresInDays: 7 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // Authenticated but tenant-less operators are also denied.
    await expect(
      shareableReportsRouter.createCaller(makeCtx(null)).createShareLink({ investigationRef: REF, expiresInDays: 7 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── Self-service signup ──────────────────────────────────────────────────────

function seedPaidPlanAndIntent(overrides: Partial<Row> = {}) {
  mocks.state.plans.set("pro_monthly", { ...PLAN_PRO });
  mocks.state.intents.set("BIS-TOP-ABCDEF0123456789WXYZ0123", {
    id: "intent-1",
    tenant_id: 1,
    provider_reference: "BIS-TOP-ABCDEF0123456789WXYZ0123",
    amount_kobo: PLAN_PRO.price_kobo,
    currency: "NGN",
    purpose: "subscription_invoice",
    status: "pending",
    expires_at: new Date(Date.now() + 30 * 60 * 1000),
    ...overrides,
  });
}

const TENANT2_REF = "BIS-TOP-ZYXWVU9876543210DCBA9876";

function seedTenant2Intent() {
  mocks.state.intents.set(TENANT2_REF, {
    id: "intent-2",
    tenant_id: 2,
    provider_reference: TENANT2_REF,
    amount_kobo: PLAN_PRO.price_kobo,
    currency: "NGN",
    purpose: "subscription_invoice",
    status: "pending",
    expires_at: new Date(Date.now() + 30 * 60 * 1000),
  });
}

describe("selfServiceBilling — plans and signup", () => {
  it("lists the public plan catalogue from billing_plans", async () => {
    mocks.state.plans.set("pro_monthly", { ...PLAN_PRO });
    mocks.state.plans.set("starter_monthly", { ...PLAN_PRO, id: "3", plan_code: "starter_monthly", display_name: "Starter", price_kobo: 5_000_000, included_completed_checks: 10 });
    mocks.state.plans.set("retired", { ...PLAN_PRO, id: "9", plan_code: "retired", active: false });
    const plans = await selfServiceBillingRouter.createCaller(makeCtx(null)).listPublicPlans();
    expect(plans.map((p) => p.planCode)).toEqual(["starter_monthly", "pro_monthly"]);
    expect(plans[0].currency).toBe("NGN");
  });

  it("activates a paid subscription through the existing settlement path", async () => {
    seedPaidPlanAndIntent();
    const caller = selfServiceBillingRouter.createCaller(makeCtx(1));
    const result = await caller.signup({
      planCode: "pro_monthly",
      idempotencyKey: "signup-key-0001",
      paymentReference: "BIS-TOP-ABCDEF0123456789WXYZ0123",
    });

    expect(result.status).toBe("active");
    expect(result.idempotent).toBe(false);
    expect(result.billingRef).toBe("BIS-TOP-ABCDEF0123456789WXYZ0123");
    expect(fetchCalls.paystackVerify).toBe(1);
    expect(fetchCalls.tigerBeetleTransfer).toBe(1);

    expect(mocks.state.subscriptions).toHaveLength(1);
    expect(mocks.state.subscriptions[0].status).toBe("active");
    expect(mocks.state.subscriptions[0].provider).toBe("paystack");
    expect(mocks.state.entitlements).toHaveLength(1);
    expect(mocks.state.entitlements[0].total_units).toBe(40);
    expect(mocks.state.signups).toHaveLength(1);
    expect(mocks.state.intents.get("BIS-TOP-ABCDEF0123456789WXYZ0123")!.status).toBe("credited");
    expect(mocks.state.topups).toHaveLength(1);
    expect(mocks.state.auditLog.some((a) => a.action.includes("pro_monthly") && a.result === "success")).toBe(true);
    expect(fetchCalls.events).toBe(1);

    const mine = await caller.mySubscription();
    expect(mine.subscription?.planCode).toBe("pro_monthly");
    expect(mine.subscription?.status).toBe("active");

    const usage = await caller.usageSummary();
    expect(usage).toMatchObject({ tenantId: 1, includedChecks: 40, consumedChecks: 0, reservedChecks: 0, remainingChecks: 40 });
  });

  it("replays the idempotency key with the original result and no second settlement", async () => {
    seedPaidPlanAndIntent();
    const caller = selfServiceBillingRouter.createCaller(makeCtx(1));
    const input = { planCode: "pro_monthly", idempotencyKey: "signup-key-0002", paymentReference: "BIS-TOP-ABCDEF0123456789WXYZ0123" };

    const first = await caller.signup(input);
    const replay = await caller.signup(input);

    expect(replay.idempotent).toBe(true);
    expect(replay.signupId).toBe(first.signupId);
    expect(replay.subscriptionId).toBe(first.subscriptionId);
    expect(replay.billingRef).toBe(first.billingRef);
    expect(fetchCalls.paystackVerify).toBe(1);
    expect(fetchCalls.tigerBeetleTransfer).toBe(1);
    expect(mocks.state.signups).toHaveLength(1);
    expect(mocks.state.subscriptions).toHaveLength(1);
  });

  it("fails closed: a failed payment activates no subscription or entitlement", async () => {
    seedPaidPlanAndIntent();
    paystackBehaviour = "failed";
    const caller = selfServiceBillingRouter.createCaller(makeCtx(1));

    await expect(caller.signup({
      planCode: "pro_monthly",
      idempotencyKey: "signup-key-0003",
      paymentReference: "BIS-TOP-ABCDEF0123456789WXYZ0123",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(mocks.state.subscriptions).toHaveLength(0);
    expect(mocks.state.entitlements).toHaveLength(0);
    // The failed attempt is durably recorded; it never activates anything.
    expect(mocks.state.signups).toHaveLength(1);
    expect(mocks.state.signups[0].status).toBe("payment_failed");
    expect(mocks.state.intents.get("BIS-TOP-ABCDEF0123456789WXYZ0123")!.status).toBe("pending");
    expect(mocks.state.topups).toHaveLength(0);
    expect(fetchCalls.tigerBeetleTransfer).toBe(0);
    expect(mocks.state.auditLog.some((a) => a.result === "failure")).toBe(true);

    const mine = await caller.mySubscription();
    expect(mine.subscription).toBeNull();

    // Replay of the failed key returns the original failure result and never
    // re-settles payment.
    const verifyCalls = fetchCalls.paystackVerify;
    const replay = await caller.signup({
      planCode: "pro_monthly",
      idempotencyKey: "signup-key-0003",
      paymentReference: "BIS-TOP-ABCDEF0123456789WXYZ0123",
    });
    expect(replay.idempotent).toBe(true);
    expect(replay.status).toBe("payment_failed");
    expect(replay.subscriptionId).toBeNull();
    expect(fetchCalls.paystackVerify).toBe(verifyCalls);
    expect(fetchCalls.tigerBeetleTransfer).toBe(0);
    expect(mocks.state.subscriptions).toHaveLength(0);
  });

  it("rejects a payment intent bound to another tenant or wrong amount", async () => {
    seedPaidPlanAndIntent({ tenant_id: 2 });
    const caller = selfServiceBillingRouter.createCaller(makeCtx(1));
    await expect(caller.signup({
      planCode: "pro_monthly",
      idempotencyKey: "signup-key-0004",
      paymentReference: "BIS-TOP-ABCDEF0123456789WXYZ0123",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.state.subscriptions).toHaveLength(0);

    seedPaidPlanAndIntent({ amount_kobo: 1 });
    await expect(caller.signup({
      planCode: "pro_monthly",
      idempotencyKey: "signup-key-0005",
      paymentReference: "BIS-TOP-ABCDEF0123456789WXYZ0123",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.state.subscriptions).toHaveLength(0);
  });

  it("rejects unknown plans and paid signups without a payment reference", async () => {
    const caller = selfServiceBillingRouter.createCaller(makeCtx(1));
    await expect(caller.signup({ planCode: "ghost_plan", idempotencyKey: "signup-key-0006" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    seedPaidPlanAndIntent();
    await expect(caller.signup({ planCode: "pro_monthly", idempotencyKey: "signup-key-0007" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.state.subscriptions).toHaveLength(0);
  });

  it("scopes mySubscription and usageSummary to the caller's tenant", async () => {
    seedPaidPlanAndIntent();
    await selfServiceBillingRouter.createCaller(makeCtx(1)).signup({
      planCode: "pro_monthly",
      idempotencyKey: "signup-key-0008",
      paymentReference: "BIS-TOP-ABCDEF0123456789WXYZ0123",
    });
    const other = selfServiceBillingRouter.createCaller(makeCtx(2));
    expect((await other.mySubscription()).subscription).toBeNull();
    const usage = await other.usageSummary();
    expect(usage.includedChecks).toBe(0);
    expect(usage.remainingChecks).toBe(0);
  });

  it("never leaks another tenant's signup on a cross-tenant idempotency-key replay", async () => {
    seedPaidPlanAndIntent();
    seedTenant2Intent();
    const SHARED_KEY = "shared-key-cross-tenant";

    // Tenant 1 signs up with the key.
    const first = await selfServiceBillingRouter.createCaller(makeCtx(1)).signup({
      planCode: "pro_monthly",
      idempotencyKey: SHARED_KEY,
      paymentReference: "BIS-TOP-ABCDEF0123456789WXYZ0123",
    });
    expect(first.status).toBe("active");

    // Tenant 2 presents the SAME key: it must behave as a brand-new key for
    // tenant 2 — never returning tenant 1's signupId, subscription, or
    // billing reference.
    const foreign = await selfServiceBillingRouter.createCaller(makeCtx(2)).signup({
      planCode: "pro_monthly",
      idempotencyKey: SHARED_KEY,
      paymentReference: TENANT2_REF,
    });
    expect(foreign.idempotent).toBe(false);
    expect(foreign.signupId).not.toBe(first.signupId);
    expect(foreign.subscriptionId).not.toBe(first.subscriptionId);
    expect(foreign.billingRef).toBe(TENANT2_REF);
    expect(foreign.billingRef).not.toBe(first.billingRef);
    expect(JSON.stringify(foreign)).not.toContain("BIS-TOP-ABCDEF0123456789WXYZ0123");
    expect(JSON.stringify(foreign)).not.toContain(first.signupId);

    // Both tenants now hold their own row under the same key value.
    expect(mocks.state.signups).toHaveLength(2);
    expect(mocks.state.signups.map((s) => s.tenant_id).sort()).toEqual([1, 2]);

    // Same-tenant replay still returns the original result, untouched.
    const replay1 = await selfServiceBillingRouter.createCaller(makeCtx(1)).signup({
      planCode: "pro_monthly",
      idempotencyKey: SHARED_KEY,
      paymentReference: "BIS-TOP-ABCDEF0123456789WXYZ0123",
    });
    expect(replay1.idempotent).toBe(true);
    expect(replay1.signupId).toBe(first.signupId);
    expect(replay1.subscriptionId).toBe(first.subscriptionId);
    expect(replay1.billingRef).toBe(first.billingRef);

    const replay2 = await selfServiceBillingRouter.createCaller(makeCtx(2)).signup({
      planCode: "pro_monthly",
      idempotencyKey: SHARED_KEY,
      paymentReference: TENANT2_REF,
    });
    expect(replay2.idempotent).toBe(true);
    expect(replay2.signupId).toBe(foreign.signupId);
    expect(replay2.billingRef).toBe(TENANT2_REF);

    // Each tenant settled exactly once; no replay triggered a re-settlement.
    expect(mocks.state.subscriptions).toHaveLength(2);
    expect(mocks.state.topups).toHaveLength(2);

    // Lock the fix in at the SQL level: every plan_signups lookup must be
    // tenant-scoped (regression guard against the original global-key bug).
    const replaySelects = mocks.query.mock.calls
      .map((c) => String(c[0]).replace(/\s+/g, " "))
      .filter((s) => s.startsWith("SELECT id, plan_code, status, billing_ref FROM plan_signups"));
    expect(replaySelects.length).toBeGreaterThan(0);
    for (const s of replaySelects) {
      expect(s).toContain("tenant_id = $1 AND idempotency_key = $2");
    }
  });

  it("allows two tenants to use the same idempotency key on a FREE plan (tenant-namespaced refs)", async () => {
    mocks.state.plans.set("free_monthly", {
      id: "1", plan_code: "free_monthly", display_name: "Free",
      billing_interval: "monthly", price_kobo: 0, included_completed_checks: 3,
      overage_price_kobo: 0, active: true, version: 1,
    });
    const SHARED_KEY = "free-key-shared";

    // Tenant 1 free signup: no payment reference needed or accepted.
    const first = await selfServiceBillingRouter.createCaller(makeCtx(1)).signup({
      planCode: "free_monthly",
      idempotencyKey: SHARED_KEY,
    });
    expect(first.status).toBe("active");
    expect(first.billingRef).toBe(`self-serve-free:1:${SHARED_KEY}`);
    expect(fetchCalls.paystackVerify).toBe(0);
    expect(fetchCalls.tigerBeetleTransfer).toBe(0);

    // Tenant 2 with the SAME key must succeed with its own subscription —
    // the global UNIQUE(provider, provider_subscription_ref) must not collide.
    const second = await selfServiceBillingRouter.createCaller(makeCtx(2)).signup({
      planCode: "free_monthly",
      idempotencyKey: SHARED_KEY,
    });
    expect(second.status).toBe("active");
    expect(second.idempotent).toBe(false);
    expect(second.signupId).not.toBe(first.signupId);
    expect(second.subscriptionId).not.toBe(first.subscriptionId);
    expect(second.billingRef).toBe(`self-serve-free:2:${SHARED_KEY}`);
    expect(JSON.stringify(second)).not.toContain(first.billingRef!);

    expect(mocks.state.subscriptions).toHaveLength(2);
    expect(new Set(mocks.state.subscriptions.map((s) => s.provider_subscription_ref)).size).toBe(2);
    expect(mocks.state.entitlements).toHaveLength(2);

    // Same-tenant replays return each tenant's original result.
    const replay1 = await selfServiceBillingRouter.createCaller(makeCtx(1)).signup({
      planCode: "free_monthly",
      idempotencyKey: SHARED_KEY,
    });
    expect(replay1.idempotent).toBe(true);
    expect(replay1.signupId).toBe(first.signupId);
    expect(replay1.subscriptionId).toBe(first.subscriptionId);

    const replay2 = await selfServiceBillingRouter.createCaller(makeCtx(2)).signup({
      planCode: "free_monthly",
      idempotencyKey: SHARED_KEY,
    });
    expect(replay2.idempotent).toBe(true);
    expect(replay2.signupId).toBe(second.signupId);
    expect(replay2.subscriptionId).toBe(second.subscriptionId);
  });
});
