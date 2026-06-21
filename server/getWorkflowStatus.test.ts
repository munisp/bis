/**
 * server/getWorkflowStatus.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the paymentRails.getWorkflowStatus tRPC procedure.
 *
 * The procedure:
 *   1. Fetches the transaction row from the DB by txRef
 *   2. Calls getPaymentWorkflowStatus() to get the Temporal saga status
 *   3. Maps the DB status to a user-friendly stage label via mapStatus()
 *   4. Returns a combined response with both DB and workflow state
 *
 * Covered scenarios:
 *   1. Happy path — found row, Temporal returns "RUNNING" → stage = "Processing"
 *   2. Completed transfer — DB status "completed" → stage = "Confirmed", dbStatus = "posted"
 *   3. Failed transfer — DB status "failed" → stage = "Failed", dbStatus = "failed"
 *   4. Under-review transfer — DB status "under_review" → stage = "Under Review"
 *   5. Flagged transfer — DB status "flagged" → stage = "Flagged — Compliance Review"
 *   6. Reversed transfer — DB status "reversed" → stage = "Reversed", dbStatus = "reversed"
 *   7. Blocked transfer — DB status "blocked" → stage = "Blocked", dbStatus = "voided"
 *   8. NOT_FOUND when txRef does not exist
 *   9. Temporal down → workflow.status = "unknown" (non-blocking)
 *  10. Unauthenticated caller → UNAUTHORIZED
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

function makeUserCtx(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "test@bis.test",
    name: "Test User",
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

/** Seed a transaction row into the mock DB's select() return value. */
function seedTransaction(db: Awaited<ReturnType<typeof getDb>>, row: Record<string, unknown>) {
  (db as any).select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([row]),
      }),
    }),
  });
}

/** Make the mock DB return an empty result (no transaction found). */
function seedNoTransaction(db: Awaited<ReturnType<typeof getDb>>) {
  (db as any).select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });
}

const BASE_TX_ROW = {
  id: 42,
  txRef: "TXN-WF-001",
  status: "pending",
  amount: 50000,
  currency: "NGN",
  originatorName: "Alice Sender",
  beneficiaryName: "Bob Receiver",
  tigerBeetleId: "tb-001",
  createdAt: new Date("2025-01-01T10:00:00Z"),
  updatedAt: new Date("2025-01-01T10:01:00Z"),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("paymentRails.getWorkflowStatus", () => {
  let db: Awaited<ReturnType<typeof getDb>>;

  beforeEach(async () => {
    __resetStore();
    db = await getDb();
  });

  afterEach(() => {
    __resetStore();
  });

  // ── 1. Happy path ────────────────────────────────────────────────────────────
  it("returns combined DB + Temporal status for a pending transfer", async () => {
    seedTransaction(db, { ...BASE_TX_ROW, status: "pending" });

    const { getPaymentWorkflowStatus } = await import("./temporal");
    (getPaymentWorkflowStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "RUNNING", result: null });

    const caller = appRouter.createCaller(makeUserCtx());
    const result = await caller.paymentRails.getWorkflowStatus({ txRef: "TXN-WF-001" });

    expect(result.txRef).toBe("TXN-WF-001");
    expect(result.id).toBe(42);
    expect(result.dbStatus).toBe("pending");
    expect(result.stage).toBe("Processing");
    expect(result.workflow.status).toBe("RUNNING");
    expect(result.currency).toBe("NGN");
    expect(result.originatorName).toBe("Alice Sender");
    expect(result.beneficiaryName).toBe("Bob Receiver");
  });

  // ── 2. Completed transfer ────────────────────────────────────────────────────
  it("maps DB status 'completed' → dbStatus 'posted' and stage 'Confirmed'", async () => {
    seedTransaction(db, { ...BASE_TX_ROW, status: "completed" });

    const { getPaymentWorkflowStatus } = await import("./temporal");
    (getPaymentWorkflowStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "COMPLETED", result: { success: true } });

    const caller = appRouter.createCaller(makeUserCtx());
    const result = await caller.paymentRails.getWorkflowStatus({ txRef: "TXN-WF-001" });

    expect(result.dbStatus).toBe("posted");
    expect(result.stage).toBe("Confirmed");
    expect(result.workflow.status).toBe("COMPLETED");
  });

  // ── 3. Failed transfer ───────────────────────────────────────────────────────
  it("maps DB status 'failed' → dbStatus 'failed' and stage 'Failed'", async () => {
    seedTransaction(db, { ...BASE_TX_ROW, status: "failed" });

    const { getPaymentWorkflowStatus } = await import("./temporal");
    (getPaymentWorkflowStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "FAILED" });

    const caller = appRouter.createCaller(makeUserCtx());
    const result = await caller.paymentRails.getWorkflowStatus({ txRef: "TXN-WF-001" });

    expect(result.dbStatus).toBe("failed");
    expect(result.stage).toBe("Failed");
  });

  // ── 4. Under-review transfer ─────────────────────────────────────────────────
  it("maps DB status 'under_review' → dbStatus 'pending' and stage 'Under Review'", async () => {
    seedTransaction(db, { ...BASE_TX_ROW, status: "under_review" });

    const { getPaymentWorkflowStatus } = await import("./temporal");
    (getPaymentWorkflowStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "RUNNING" });

    const caller = appRouter.createCaller(makeUserCtx());
    const result = await caller.paymentRails.getWorkflowStatus({ txRef: "TXN-WF-001" });

    expect(result.dbStatus).toBe("pending");
    expect(result.stage).toBe("Under Review");
  });

  // ── 5. Flagged transfer ──────────────────────────────────────────────────────
  it("maps DB status 'flagged' → dbStatus 'pending' and stage 'Flagged — Compliance Review'", async () => {
    seedTransaction(db, { ...BASE_TX_ROW, status: "flagged" });

    const { getPaymentWorkflowStatus } = await import("./temporal");
    (getPaymentWorkflowStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "RUNNING" });

    const caller = appRouter.createCaller(makeUserCtx());
    const result = await caller.paymentRails.getWorkflowStatus({ txRef: "TXN-WF-001" });

    expect(result.dbStatus).toBe("pending");
    expect(result.stage).toBe("Flagged — Compliance Review");
  });

  // ── 6. Reversed transfer ─────────────────────────────────────────────────────
  it("maps DB status 'reversed' → dbStatus 'reversed' and stage 'Reversed'", async () => {
    seedTransaction(db, { ...BASE_TX_ROW, status: "reversed" });

    const { getPaymentWorkflowStatus } = await import("./temporal");
    (getPaymentWorkflowStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "CANCELLED" });

    const caller = appRouter.createCaller(makeUserCtx());
    const result = await caller.paymentRails.getWorkflowStatus({ txRef: "TXN-WF-001" });

    expect(result.dbStatus).toBe("reversed");
    expect(result.stage).toBe("Reversed");
  });

  // ── 7. Blocked transfer ──────────────────────────────────────────────────────
  it("maps DB status 'blocked' → dbStatus 'voided' and stage 'Blocked'", async () => {
    seedTransaction(db, { ...BASE_TX_ROW, status: "blocked" });

    const { getPaymentWorkflowStatus } = await import("./temporal");
    (getPaymentWorkflowStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "TERMINATED" });

    const caller = appRouter.createCaller(makeUserCtx());
    const result = await caller.paymentRails.getWorkflowStatus({ txRef: "TXN-WF-001" });

    expect(result.dbStatus).toBe("voided");
    expect(result.stage).toBe("Blocked");
  });

  // ── 8. NOT_FOUND ─────────────────────────────────────────────────────────────
  it("throws NOT_FOUND when the txRef does not exist in the DB", async () => {
    seedNoTransaction(db);

    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.paymentRails.getWorkflowStatus({ txRef: "TXN-DOES-NOT-EXIST" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── 9. Temporal down → workflow.status = "unknown" ───────────────────────────
  it("returns workflow.status 'unknown' when Temporal is unreachable (non-blocking)", async () => {
    seedTransaction(db, { ...BASE_TX_ROW, status: "pending" });

    const { getPaymentWorkflowStatus } = await import("./temporal");
    (getPaymentWorkflowStatus as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("fetch failed")
    );

    const caller = appRouter.createCaller(makeUserCtx());
    // Should NOT throw — Temporal failure is caught
    const result = await caller.paymentRails.getWorkflowStatus({ txRef: "TXN-WF-001" });

    expect(result.workflow.status).toBe("unknown");
    expect(result.dbStatus).toBe("pending"); // DB status is still correct
  });

  // ── 10. Unauthenticated caller ───────────────────────────────────────────────
  it("throws UNAUTHORIZED when called without a session", async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(
      caller.paymentRails.getWorkflowStatus({ txRef: "TXN-WF-001" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
