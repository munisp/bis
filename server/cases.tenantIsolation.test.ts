/**
 * Cases router — tenant isolation regression tests.
 *
 * Verifies that every casesRouter procedure that touches the `cases` table
 * (or case children: documents, timeline, stakeholders, comments, parties)
 * scopes its queries to the caller's tenant, mirroring the
 * investigationsRouter pattern. A cross-tenant case ref must behave as if
 * the case does not exist (NOT_FOUND), and list/stats queries must compose
 * `eq(cases.tenantId, ctx.tenantId)` into their WHERE clauses.
 *
 * The fake DB filters rows by the equality pairs found in the drizzle
 * condition tree, so a missing tenant filter returns cross-tenant rows and
 * fails the test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createFakeDb, type FakeDb } from "./test-utils/fakeDb";
import { hasEqCondition } from "./test-utils/conditionScan";

const dbHolder = vi.hoisted(() => ({ current: null as unknown as FakeDb }));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => dbHolder.current),
}));
vi.mock("./permify", () => ({
  permifyCheck: vi.fn().mockResolvedValue(true),
  permifyWriteRelationship: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./cache", () => ({
  withCache: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
  invalidateCache: vi.fn(),
  TTL: {},
}));
vi.mock("./dapr", () => ({
  publishInvestigationEvent: vi.fn().mockResolvedValue(undefined),
  publishKycEvent: vi.fn().mockResolvedValue(undefined),
  publishCaseEvent: vi.fn().mockResolvedValue(undefined),
  publishBillingEvent: vi.fn().mockResolvedValue(undefined),
  publishStablecoinEvent: vi.fn().mockResolvedValue(undefined),
  publishCriminalRecordEvent: vi.fn().mockResolvedValue(undefined),
  publishDaprScreeningEvent: vi.fn().mockResolvedValue(undefined),
  publishFieldVisitEvent: vi.fn().mockResolvedValue(undefined),
  publishMojaloopEvent: vi.fn().mockResolvedValue(undefined),
  publishCorporateCheckEvent: vi.fn().mockResolvedValue(undefined),
}));

import { appRouter } from "./routers";

const CASE_A = { id: 1, ref: "CASE-2026-000A", tenantId: 7, title: "Tenant 7 case", status: "open" };
const CASE_B = { id: 2, ref: "CASE-2026-000B", tenantId: 8, title: "Tenant 8 case", status: "open" };

function tenantContext(tenantId: number): TrpcContext {
  return {
    user: { id: 11, tenantId, role: "analyst", name: "Tenant Analyst", email: "analyst@t7.test" } as TrpcContext["user"],
    tenantId,
    isDemo: false,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function adminContext(): TrpcContext {
  return {
    user: { id: 1, tenantId: null, role: "admin", name: "Platform Admin", email: "admin@bis.test" } as TrpcContext["user"],
    tenantId: null,
    isDemo: false,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  dbHolder.current = createFakeDb({
    cases: [CASE_A as any, CASE_B as any],
    case_parties: [],
    case_documents: [],
    case_timeline: [],
    case_stakeholders: [],
    case_comments: [],
  });
});

describe("cases tenant isolation", () => {
  it("cases.get returns a case belonging to the caller's tenant", async () => {
    const caller = appRouter.createCaller(tenantContext(7));
    const result = await caller.cases.get({ ref: CASE_A.ref });
    expect(result.ref).toBe(CASE_A.ref);
  });

  it("cases.get returns NOT_FOUND for a cross-tenant case ref", async () => {
    const caller = appRouter.createCaller(tenantContext(7));
    await expect(caller.cases.get({ ref: CASE_B.ref })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cases.get allows a platform admin (tenantId null) to read any case", async () => {
    const caller = appRouter.createCaller(adminContext());
    const result = await caller.cases.get({ ref: CASE_B.ref });
    expect(result.ref).toBe(CASE_B.ref);
  });

  it("cases.list composes the tenant filter and never returns cross-tenant rows", async () => {
    const caller = appRouter.createCaller(tenantContext(7));
    const result = await caller.cases.list({});
    const refs = result.cases.map((c: any) => c.ref);
    expect(refs).toContain(CASE_A.ref);
    expect(refs).not.toContain(CASE_B.ref);
    const casesQueries = dbHolder.current.captured.filter(c => c.table === "cases");
    expect(casesQueries.length).toBeGreaterThan(0);
    for (const q of casesQueries) {
      expect(hasEqCondition(q.cond, "tenantId", 7)).toBe(true);
    }
  });

  it("cases.update returns NOT_FOUND for a cross-tenant case ref", async () => {
    const caller = appRouter.createCaller(tenantContext(7));
    await expect(
      caller.cases.update({ ref: CASE_B.ref, title: "Tampered title" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cases.addTimelineEvent returns NOT_FOUND for a cross-tenant case ref", async () => {
    const caller = appRouter.createCaller(tenantContext(7));
    await expect(
      caller.cases.addTimelineEvent({ caseRef: CASE_B.ref, eventType: "comment_added", title: "Cross-tenant write" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cases.inviteStakeholder returns NOT_FOUND for a cross-tenant case ref", async () => {
    const caller = appRouter.createCaller(tenantContext(7));
    await expect(
      caller.cases.inviteStakeholder({
        caseRef: CASE_B.ref,
        role: "reviewer",
        name: "Cross Tenant Stakeholder",
        email: "x@example.com",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cases.uploadDocument returns NOT_FOUND for a cross-tenant case ref", async () => {
    const caller = appRouter.createCaller(tenantContext(7));
    await expect(
      caller.cases.uploadDocument({
        caseRef: CASE_B.ref,
        fileName: "evidence.pdf",
        mimeType: "application/pdf",
        fileBase64: Buffer.from("%PDF-1.4 fake").toString("base64"),
        fileSize: 14,
        confidential: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cases.stats scopes every aggregate query to the caller's tenant", async () => {
    const caller = appRouter.createCaller(tenantContext(7));
    await caller.cases.stats();
    const casesQueries = dbHolder.current.captured.filter(c => c.table === "cases");
    expect(casesQueries.length).toBeGreaterThanOrEqual(3);
    for (const q of casesQueries) {
      expect(hasEqCondition(q.cond, "tenantId", 7)).toBe(true);
    }
  });

  it("cases.create persists the caller's tenantId on the new case", async () => {
    const caller = appRouter.createCaller(tenantContext(7));
    const created = await caller.cases.create({ title: "New tenant case", type: "fraud" } as any);
    expect((created as any).tenantId).toBe(7);
  });
});
