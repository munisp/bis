import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./cache", () => ({
  withCache: vi.fn((_key, _ttl, work) => work()),
  invalidateCache: vi.fn(),
  TTL: { ALERTS_LIST: 60 },
}));
vi.mock("./permify", () => ({ permifyCheck: vi.fn(async () => true), permifyWriteRelationship: vi.fn() }));
vi.mock("./dapr", () => ({ publishAmlAlert: vi.fn(), publishTransactionEvent: vi.fn() }));
vi.mock("./temporal", () => ({ startAmlWorkflow: vi.fn() }));
vi.mock("./lakehouse", () => ({ writeLakehouseEvent: vi.fn() }));
vi.mock("./fluvio", () => ({ fluvioPublishAmlEvent: vi.fn(), fluvioPublishTransactionEvent: vi.fn() }));

import { getDb } from "./db";
import { amlAlerts, transactions } from "../drizzle/schema";
import { amlRouter } from "./aml";
import type { TrpcContext } from "./_core/context";

function tenantContext(): TrpcContext {
  return {
    user: {
      id: 21, openId: "aml-guard-user", email: "aml@example.test", name: "AML Guard",
      loginMethod: "keycloak", role: "analyst", tenantId: 42, pushToken: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    tenantId: 42, isDemo: false, authMethod: "keycloak",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function makeDb(options?: { alert?: Record<string, unknown>; updateRows?: unknown[] }) {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: Record<string, unknown>) => {
      inserted.push({ table, values });
      return {
        returning: vi.fn(async () => table === transactions
          ? [{ id: 90, txRef: "TXN-AML-90", ...values }]
          : [{ id: 91, ...values }]),
      };
    }),
  }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({ where: vi.fn(async () => options?.alert ? [options.alert] : []) })),
  }));
  const update = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => options?.updateRows ?? []) })) })),
  }));
  return { insert, select, update, inserted };
}

describe("AML tenant and lifecycle guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists the authenticated tenant on AML transactions created through the monitoring router", async () => {
    const db = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    await amlRouter.createCaller(tenantContext()).transactions.create({
      type: "nip", amount: 25_000, currency: "NGN",
      originatorName: "Originator", originatorCountry: "NG",
      beneficiaryName: "Beneficiary", beneficiaryCountry: "NG",
    });

    expect(db.inserted[0]).toMatchObject({ table: transactions, values: expect.objectContaining({ tenantId: 42 }) });
  });

  it("rejects an illegal review transition before mutating an AML alert", async () => {
    const db = makeDb({ alert: { id: 11, tenantId: 42, status: "filed" } });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    await expect(amlRouter.createCaller(tenantContext()).alerts.review({ id: 11, status: "cleared" }))
      .rejects.toThrow("Illegal AML alert transition");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects a settlement attempt that is not an accepted tenant-owned SEPA payment", async () => {
    const db = makeDb({ updateRows: [] });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    await expect(amlRouter.createCaller(tenantContext()).sepa.settle({ id: 12 }))
      .rejects.toThrow("Only a tenant-owned accepted SEPA payment can be settled");
  });

  it("rejects an acknowledgement that is not a sent tenant-owned Travel Rule record", async () => {
    const db = makeDb({ updateRows: [] });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    await expect(amlRouter.createCaller(tenantContext()).travelRule.acknowledge({ id: 13 }))
      .rejects.toThrow("Only a tenant-owned sent Travel Rule record can be acknowledged");
  });
});
