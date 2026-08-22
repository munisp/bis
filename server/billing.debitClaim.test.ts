import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: { tigerBeetleUrl: "http://tigerbeetle.test" },
}));
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));
vi.mock("./circuitBreaker", () => ({
  withCircuitBreaker: vi.fn(async (_name, work) => work()),
}));

import { getDb } from "./db";
import { tigerbeetleTransfers } from "../drizzle/schema";
import { billingRouter } from "./billing";
import type { TrpcContext } from "./_core/context";

function tenantContext(): TrpcContext {
  return {
    user: {
      id: 8,
      openId: "debit-claim-user",
      email: "debit@example.test",
      name: "Debit Claim",
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
  };
}

function makeDb(options?: { existing?: Record<string, unknown> }) {
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: Record<string, unknown>) => {
      inserts.push({ table, values });
      return {
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () =>
            options?.existing ? [] : [{ transferId: values.transferId }]
          ),
        })),
      };
    }),
  }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => (options?.existing ? [options.existing] : [])),
    })),
  }));
  const update = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  }));
  return { insert, select, update, inserts };
}

const debitInput = {
  tenantId: "42",
  investigationId: "INV-900",
  tier: "standard" as const,
};

describe("billing recordDebit durable claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }))
    );
  });

  it("persists a tenant-scoped debit claim before the TigerBeetle account and transfer calls", async () => {
    const db = makeDb();
    const order: string[] = [];
    (db.insert as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          order.push("claim");
          db.inserts.push({ table, values });
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn(async () => [{ transferId: values.transferId }]),
            })),
          };
        }),
      })
    );
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        order.push("ledger");
        return { ok: true, json: async () => [] };
      }
    );

    const result = await billingRouter
      .createCaller(tenantContext())
      .recordDebit(debitInput);

    expect(result).toMatchObject({ recorded: true, tenantId: "42" });
    expect(order[0]).toBe("claim");
    expect(db.inserts[0]).toMatchObject({
      table: tigerbeetleTransfers,
      values: expect.objectContaining({
        tenantId: 42,
        txRef: "INV-900",
        amount: 150_000,
      }),
    });
    expect(db.update).toHaveBeenCalledOnce();
  });

  it("does not invoke TigerBeetle when a duplicate debit claim remains pending reconciliation", async () => {
    const db = makeDb({
      existing: { transferId: "existing", reconciledAt: null },
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const result = await billingRouter
      .createCaller(tenantContext())
      .recordDebit(debitInput);

    expect(result).toMatchObject({
      idempotent: true,
      recorded: false,
      pendingReconciliation: true,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
