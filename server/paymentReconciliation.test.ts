import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const connect = vi.fn(async () => ({ query, release: vi.fn() }));
  const getPgPool = vi.fn(async () => ({ connect }));
  const withTenantTransaction = vi.fn(async (_client: unknown, _tenantId: number, work: (client: { query: typeof query }) => Promise<unknown>) => work({ query }));
  return { query, connect, getPgPool, withTenantTransaction };
});

vi.mock("./db", () => ({ getPgPool: mocks.getPgPool }));
vi.mock("./tenantRls", () => ({ withTenantTransaction: mocks.withTenantTransaction }));
vi.mock("./permify", () => ({ permifyCheck: vi.fn(async () => true) }));

import { paymentReconciliationRouter } from "./paymentReconciliation";
import type { TrpcContext } from "./_core/context";

const digest = "a".repeat(64);
const context = (userId: number): TrpcContext => ({
  user: {
    id: userId,
    openId: `payment-reconciler-${userId}`,
    email: `payment-reconciler-${userId}@example.invalid`,
    name: "Payment Reconciler",
    loginMethod: "keycloak",
    role: "admin",
    tenantId: 42,
    pushToken: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  tenantId: 42,
  isDemo: false,
  authMethod: "keycloak",
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
});

const evidence = {
  reconciliationCaseId: "11111111-1111-4111-8111-111111111111",
  reasonCode: "MATCHING_SETTLEMENT_CONFIRMED" as const,
  ledgerEvidenceRef: "ledger:transfer:stable-reference",
  ledgerEvidenceSha256: digest,
  providerEvidenceRef: "provider:callback:stable-reference",
  providerEvidenceSha256: digest,
};

function lockedCase(claimedBy: number) {
  return {
    id: evidence.reconciliationCaseId,
    transaction_id: 101,
    outbox_id: 201,
    tenant_id: 42,
    status: "under_review",
    last_error_code: "TEMPORAL_WORKFLOW_START_FAILED",
    claimed_by: claimedBy,
    transaction_status: "under_review",
    outbox_status: "dead_letter",
  };
}

describe("paymentReconciliationRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset();
    mocks.connect.mockResolvedValue({ query: mocks.query, release: vi.fn() });
  });

  it("rejects resolution by the same reviewer who claimed the case before mutating durable state", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [lockedCase(7)] });

    await expect(paymentReconciliationRouter.createCaller(context(7)).confirmSettled(evidence)).rejects.toMatchObject({ code: "CONFLICT" });

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain("FOR UPDATE OF c, t, o");
  });

  it("records an evidence-bound settled resolution and transaction completion atomically for an independent reviewer", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [lockedCase(7)] })
      .mockResolvedValueOnce({ rows: [{ id: evidence.reconciliationCaseId }] })
      .mockResolvedValueOnce({ rows: [{ id: 101 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await paymentReconciliationRouter.createCaller(context(8)).confirmSettled(evidence);

    expect(result).toEqual({ reconciliationCaseId: evidence.reconciliationCaseId, status: "confirmed_settled" });
    expect(String(mocks.query.mock.calls[1]?.[0])).toContain("SET status = $2");
    expect(mocks.query.mock.calls[1]?.[1]).toContain("confirmed_settled");
    expect(String(mocks.query.mock.calls[2]?.[0])).toContain("SET status = 'completed'");
    expect(String(mocks.query.mock.calls[3]?.[0])).toContain("INSERT INTO payment_reconciliation_events");
  });

  it("requeues only the existing dead-letter outbox with its deterministic identity after independent no-effect evidence", async () => {
    const retryEvidence = { ...evidence, reasonCode: "NO_EXTERNAL_EFFECT_CONFIRMED" as const };
    mocks.query
      .mockResolvedValueOnce({ rows: [lockedCase(7)] })
      .mockResolvedValueOnce({ rows: [{ id: evidence.reconciliationCaseId }] })
      .mockResolvedValueOnce({ rows: [{ id: 201 }] })
      .mockResolvedValueOnce({ rows: [{ id: 101 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await paymentReconciliationRouter.createCaller(context(8)).approveDeterministicRetry(retryEvidence);

    expect(result.status).toBe("approved_retry");
    expect(String(mocks.query.mock.calls[2]?.[0])).toContain("SET status = 'queued', attempts = 0");
    expect(mocks.query.mock.calls[2]?.[1]).toEqual([201, 42, 101]);
    expect(String(mocks.query.mock.calls[3]?.[0])).toContain("SET status = 'pending'");
  });
});
