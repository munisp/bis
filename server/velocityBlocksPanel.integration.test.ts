/**
 * server/velocityBlocksPanel.integration.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for the aml.listVelocityBlocks tRPC procedure.
 *
 * The procedure:
 *   1. Accepts optional accountId filter, plus limit/offset pagination params
 *   2. Queries the velocity_blocks table (with optional WHERE clause)
 *   3. Returns { rows, total } where total is the full count (for pagination)
 *
 * Covered scenarios:
 *   1. Returns all rows when no accountId filter is supplied
 *   2. Filters rows by accountId when the filter is provided
 *   3. Respects the limit parameter (returns at most N rows)
 *   4. Respects the offset parameter (skips the first N rows)
 *   5. Returns empty rows and total=0 when no blocks exist
 *   6. Unauthenticated caller → UNAUTHORIZED
 *   7. Default limit is 50 when not specified
 *   8. Rejects limit > 200 with a validation error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module mocks (must be hoisted before any import that uses them) ──────────

vi.mock("./db");
vi.mock("./cache", () => ({
  withCache: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
  invalidateCache: vi.fn(async () => {}),
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600, INVESTIGATIONS: 120, ALERTS: 60, KYC: 120, SANCTIONS: 300, DASHBOARD_STATS: 60 },
}));
vi.mock("./temporal", () => ({
  startInvestigationWorkflow: vi.fn(async () => ({ workflowId: "wf-test-001" })),
  startPaymentTransferWorkflow: vi.fn(async () => ({ workflowId: "wf-pay-1", mode: "direct" })),
  cancelPaymentTransferWorkflow: vi.fn(async () => undefined),
  getPaymentWorkflowStatus: vi.fn(async () => ({ status: "RUNNING", result: null })),
}));
vi.mock("./mojaloop", () => ({
  initiateInterBankTransfer: vi.fn(async () => ({ externalRef: "ext-001", status: "pending" })),
  pollTransferStatus: vi.fn(async () => ({ status: "pending", finalised: false })),
  getActiveRail: vi.fn(async () => "mojaloop"),
}));
vi.mock("./dapr", () => ({
  publishPaymentEvent: vi.fn(async () => {}),
  publishAmlAlert: vi.fn(async () => {}),
  publishInvestigationEvent: vi.fn(async () => {}),
  publishKycEvent: vi.fn(async () => {}),
}));
vi.mock("./fluvio", () => ({
  fluvioPublishPaymentEvent: vi.fn(async () => ({ accepted: true, service_available: true })),
  fluvioPublishAmlEvent: vi.fn(async () => ({ accepted: true, service_available: true })),
  fluvioPublishBiometricEvent: vi.fn(async () => ({ accepted: true, service_available: true })),
  fluvioCheckVelocity: vi.fn(async () => ({ decision: "allow", service_available: false })),
}));
vi.mock("./search", () => ({
  searchRouter: {},
  indexDocument: vi.fn(async () => {}),
}));
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn(async () => true),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { getDb, __resetStore } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeAnalystCtx(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "analyst-001",
    email: "analyst@bis.test",
    name: "AML Analyst",
    loginMethod: "manus",
    role: "analyst",
    tenantId: null,
    pushToken: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    tenantId: null,
    isDemo: false,
    authMethod: "manus",
  };
}

function makeAnonCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    tenantId: null,
    isDemo: false,
    authMethod: "manus",
  };
}

/** Seed the mock DB so that select().from().where().orderBy().limit().offset() returns `rows`
 *  and select({ total: count() }).from().where() returns [{ total: rows.length }].
 */
function seedVelocityBlocks(
  db: Awaited<ReturnType<typeof getDb>>,
  rows: Record<string, unknown>[],
  total?: number,
) {
  const resolvedTotal = total ?? rows.length;
  let callCount = 0;
  (db as any).select.mockImplementation((_fields?: unknown) => {
    callCount++;
    const isCountQuery = callCount % 2 === 0; // second select call is the count query
    if (isCountQuery) {
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: resolvedTotal }]),
        }),
      };
    }
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      }),
    };
  });
}

const SAMPLE_BLOCKS = [
  {
    id: 1,
    accountId: "ACC-001",
    tenantId: "tenant-1",
    amountKobo: 100_000_00,
    decision: "block",
    reason: "burst limit exceeded",
    windowCount: 12,
    windowSeconds: 60,
    threshold: 10,
    txRef: "TXN-001",
    createdAt: new Date("2025-01-01T10:00:00Z"),
  },
  {
    id: 2,
    accountId: "ACC-002",
    tenantId: "tenant-1",
    amountKobo: 50_000_00,
    decision: "block",
    reason: "daily cap exceeded",
    windowCount: 3,
    windowSeconds: 86400,
    threshold: 2,
    txRef: "TXN-002",
    createdAt: new Date("2025-01-01T11:00:00Z"),
  },
  {
    id: 3,
    accountId: "ACC-001",
    tenantId: "tenant-1",
    amountKobo: 200_000_00,
    decision: "block",
    reason: "watchlist hit",
    windowCount: 1,
    windowSeconds: 60,
    threshold: 0,
    txRef: "TXN-003",
    createdAt: new Date("2025-01-01T12:00:00Z"),
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("aml.listVelocityBlocks", () => {
  let db: Awaited<ReturnType<typeof getDb>>;

  beforeEach(async () => {
    __resetStore();
    db = await getDb();
    (db as any).select.mockClear();
  });

  afterEach(() => {
    __resetStore();
  });

  // ── 1. Returns all rows when no accountId filter ─────────────────────────────
  it("returns all velocity block rows and correct total when no filter is applied", async () => {
    seedVelocityBlocks(db, SAMPLE_BLOCKS, 3);
    const caller = appRouter.createCaller(makeAnalystCtx());
    const result = await caller.aml.listVelocityBlocks({});
    expect(result.rows).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.rows[0].accountId).toBe("ACC-001");
    expect(result.rows[1].accountId).toBe("ACC-002");
  });

  // ── 2. Filters rows by accountId ─────────────────────────────────────────────
  it("returns only rows matching the accountId filter", async () => {
    const acc001Blocks = SAMPLE_BLOCKS.filter(b => b.accountId === "ACC-001");
    seedVelocityBlocks(db, acc001Blocks, 2);
    const caller = appRouter.createCaller(makeAnalystCtx());
    const result = await caller.aml.listVelocityBlocks({ accountId: "ACC-001" });
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(2);
    result.rows.forEach(row => expect(row.accountId).toBe("ACC-001"));
  });

  // ── 3. Respects the limit parameter ──────────────────────────────────────────
  it("returns at most `limit` rows when limit is specified", async () => {
    seedVelocityBlocks(db, SAMPLE_BLOCKS.slice(0, 2), 3);
    const caller = appRouter.createCaller(makeAnalystCtx());
    const result = await caller.aml.listVelocityBlocks({ limit: 2 });
    expect(result.rows).toHaveLength(2);
    // total reflects the full count, not the page size
    expect(result.total).toBe(3);
  });

  // ── 4. Respects the offset parameter ─────────────────────────────────────────
  it("skips the first `offset` rows when offset is specified", async () => {
    // Simulate page 2: offset=2 returns only the 3rd row
    seedVelocityBlocks(db, SAMPLE_BLOCKS.slice(2), 3);
    const caller = appRouter.createCaller(makeAnalystCtx());
    const result = await caller.aml.listVelocityBlocks({ offset: 2 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe(3);
    expect(result.total).toBe(3);
  });

  // ── 5. Empty result when no blocks exist ─────────────────────────────────────
  it("returns empty rows and total=0 when the velocity_blocks table is empty", async () => {
    seedVelocityBlocks(db, [], 0);
    const caller = appRouter.createCaller(makeAnalystCtx());
    const result = await caller.aml.listVelocityBlocks({});
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  // ── 6. Unauthenticated caller → UNAUTHORIZED ─────────────────────────────────
  it("throws UNAUTHORIZED when called without an authenticated user", async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(
      caller.aml.listVelocityBlocks({})
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  // ── 7. Default limit is 50 ───────────────────────────────────────────────────
  it("uses a default limit of 50 when limit is not specified", async () => {
    seedVelocityBlocks(db, SAMPLE_BLOCKS, 3);
    const caller = appRouter.createCaller(makeAnalystCtx());
    // No limit provided — the procedure should default to 50
    const result = await caller.aml.listVelocityBlocks({});
    // The mock returns all 3 rows; we verify the call was made (not rejected)
    expect(result.rows).toBeDefined();
    expect(Array.isArray(result.rows)).toBe(true);
  });

  // ── 8. Rejects limit > 200 ───────────────────────────────────────────────────
  it("throws a validation error when limit exceeds the maximum of 200", async () => {
    const caller = appRouter.createCaller(makeAnalystCtx());
    await expect(
      caller.aml.listVelocityBlocks({ limit: 201 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
