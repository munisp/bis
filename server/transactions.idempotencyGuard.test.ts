import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { getDb } from "./db";
import { amlAlerts, transactions } from "../drizzle/schema";
import { transactionsRouter } from "./transactions";
import type { TrpcContext } from "./_core/context";

function tenantContext(): TrpcContext {
  return {
    user: {
      id: 17,
      openId: "transaction-guard-user",
      email: "transaction@example.test",
      name: "Transaction Guard",
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

const baseInput = {
  txType: "nip" as const,
  amount: 100_000,
  currency: "NGN",
  originatorName: "Originator",
  originatorCountry: "NG",
  beneficiaryName: "Beneficiary",
  beneficiaryCountry: "NG",
  idempotencyKey: "tenant-scoped-idempotency-key",
};

function makeDb(options?: {
  selectResults?: unknown[][];
  insertError?: Error;
}) {
  const selectResults = [...(options?.selectResults ?? [])];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => selectResults.shift() ?? []),
    })),
  }));
  const alertValues: Record<string, unknown>[] = [];
  const insert = vi.fn((table: unknown) => {
    if (table === transactions) {
      return {
        values: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (options?.insertError) throw options.insertError;
            return [{ id: 501, txRef: "TXN-GUARD-501", status: "pending" }];
          }),
        })),
      };
    }
    if (table === amlAlerts) {
      return {
        values: vi.fn(async (values: Record<string, unknown>) => {
          alertValues.push(values);
        }),
      };
    }
    throw new Error("Unexpected insert table");
  });
  return { select, insert, alertValues };
}

describe("transactions create idempotency and tenant guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the same tenant-owned transaction after a duplicate-key insert race", async () => {
    const existing = {
      id: 501,
      txRef: "TXN-GUARD-501",
      tenantId: 42,
      status: "pending",
    };
    const db = makeDb({
      selectResults: [[], [existing]],
      insertError: new Error("duplicate key"),
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const result = await transactionsRouter
      .createCaller(tenantContext())
      .create(baseInput);

    expect(result).toEqual(existing);
    expect(db.insert).toHaveBeenCalledWith(transactions);
  });

  it("persists the authenticated tenant on automatically generated AML alerts", async () => {
    const db = makeDb({ selectResults: [[]] });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    await transactionsRouter.createCaller(tenantContext()).create({
      ...baseInput,
      originatorCountry: "KP",
      beneficiaryCountry: "IR",
      narration: "offshore nominee payment",
    });

    expect(db.alertValues).toHaveLength(1);
    expect(db.alertValues[0]).toMatchObject({
      tenantId: 42,
      transactionId: 501,
      status: "open",
    });
  });
});
