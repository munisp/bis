import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./mojaloop", () => ({ getActiveRail: vi.fn(() => "nip") }));
vi.mock("./dapr", () => ({ publishPaymentEvent: vi.fn(async () => {}) }));
vi.mock("./fluvio", () => ({
  fluvioCheckVelocity: vi.fn(async () => ({ decision: "allow", service_available: true })),
  fluvioPublishPaymentEvent: vi.fn(async () => ({ accepted: true })),
}));
vi.mock("./temporal", () => ({
  getPaymentWorkflowStatus: vi.fn(),
  cancelPaymentTransferWorkflow: vi.fn(),
}));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));

import { getDb } from "./db";
import { paymentRailsRouter } from "./paymentRails";
import type { TrpcContext } from "./_core/context";

const tenantContext = (): TrpcContext => ({
  user: {
    id: 7,
    openId: "payment-guard-user",
    email: "payments@example.test",
    name: "Payment Guard",
    loginMethod: "keycloak",
    role: "analyst",
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

const request = {
  originatorAccountId: "1000000001",
  beneficiaryAccountId: "2000000002",
  beneficiaryBankCode: "058",
  beneficiaryName: "Beneficiary",
  amount: 2500.5,
  reference: "PAYMENT-GUARD-001",
} as const;

function makeClaimDb(options?: { selectResults?: unknown[][]; insertError?: Error }) {
  const selectResults = [...(options?.selectResults ?? [])];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: vi.fn(async () => selectResults.shift() ?? []) })),
    })),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => {
        if (options?.insertError) throw options.insertError;
        return [{ id: 991, txRef: request.reference, status: "pending" }];
      }),
    })),
  }));
  const execute = vi.fn(async () => ({ rows: [] }));
  const transaction = vi.fn(async (callback: (transactionDb: { insert: typeof insert; execute: typeof execute }) => unknown) =>
    callback({ insert, execute })
  );
  return { select, transaction, insert, execute };
}

describe("paymentRails.initiateTransfer payment guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atomically creates a durable claim and workflow-start outbox row without calling a rail", async () => {
    const db = makeClaimDb();
    const order: string[] = [];
    (db.insert as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => {
          order.push("claim");
          return [{ id: 991, txRef: request.reference, status: "pending" }];
        }),
      })),
    }));
    (db.execute as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      order.push("outbox");
      return { rows: [] };
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const result = await paymentRailsRouter.createCaller(tenantContext()).initiateTransfer(request);

    expect(result).toMatchObject({ success: true, txRef: request.reference, status: "pending", rail: "nip" });
    expect(order).toEqual(["claim", "outbox"]);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it("returns the existing tenant-owned claim on a duplicate-reference insert race without creating a second outbox row", async () => {
    const existing = { id: 991, txRef: request.reference, status: "pending" };
    const db = makeClaimDb({ selectResults: [[], [existing]], insertError: new Error("duplicate key") });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const result = await paymentRailsRouter.createCaller(tenantContext()).initiateTransfer(request);

    expect(result).toMatchObject({ success: true, idempotent: true, txRef: request.reference });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("rejects same-account transfers and sub-kobo amounts before any database side effect", async () => {
    const db = makeClaimDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = paymentRailsRouter.createCaller(tenantContext());

    await expect(caller.initiateTransfer({ ...request, beneficiaryAccountId: request.originatorAccountId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.initiateTransfer({ ...request, amount: 0.001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
