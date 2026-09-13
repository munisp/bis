/**
 * WP6 FIX C — flow-of-funds balance enforcement on TigerBeetle debit paths.
 *
 * Covers:
 *  1. Sufficient funds: debit proceeds and the transfer is posted.
 *  2. Insufficient funds: typed INSUFFICIENT_FUNDS rejection, no transfer.
 *  3. Idempotent replay: an existing claim returns early and does NOT
 *     re-enforce the balance check (no double-enforcement, no double-charge).
 *  4. A rejected attempt releases its claim row, so a retry after top-up
 *     can re-claim the same deterministic transfer ID.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: { tigerBeetleUrl: "http://tigerbeetle.test" },
}));
vi.mock("./db", () => ({ getDb: vi.fn(), getPgPool: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));
vi.mock("./circuitBreaker", () => ({
  withCircuitBreaker: vi.fn(async (_name, work) => work()),
}));

import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { billingRouter } from "./billing";
import {
  InsufficientFundsError,
  getTenantAvailableBalanceKobo,
  isInsufficientFundsError,
} from "./billingSettlement";
import type { TrpcContext } from "./_core/context";

function tenantContext(): TrpcContext {
  return {
    user: {
      id: 8,
      openId: "funds-user",
      email: "funds@example.test",
      name: "Funds Guard",
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

const FUNDED_ACCOUNT = { credits_posted: 1_000_000, debits_posted: 0, debits_pending: 0 };
const EMPTY_ACCOUNT = { credits_posted: 0, debits_posted: 0, debits_pending: 0 };
// standard tier = 150_000 kobo; available = 1_000_000 - 0 - 900_000 = 100_000
const HELD_ACCOUNT = { credits_posted: 1_000_000, debits_posted: 0, debits_pending: 900_000 };

function stubLedger(account: unknown) {
  const postedTransfers: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST" && u.endsWith("/transfers/create")) {
        postedTransfers.push(JSON.parse(String(init.body)));
        return { ok: true, json: async () => [] };
      }
      if ((!init?.method || init.method === "GET") && u.includes("/accounts/10000")) {
        return { ok: true, json: async () => account };
      }
      // /accounts/create and anything else
      return { ok: true, json: async () => [] };
    }),
  );
  return postedTransfers;
}

function makeDb(options?: { existing?: Record<string, unknown> }) {
  const deletes: unknown[] = [];
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: Record<string, unknown>) => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(async () =>
          options?.existing ? [] : [{ transferId: values.transferId }],
        ),
      })),
    })),
  }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => (options?.existing ? [options.existing] : [])),
    })),
  }));
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => [{ transferId: "reconciled" }]) })),
    })),
  }));
  const del = vi.fn(() => ({
    where: vi.fn(async () => {
      deletes.push("delete-claim");
      return [];
    }),
  }));
  return { insert, select, update, delete: del, deletes };
}

const debitInput = { tenantId: "42", investigationId: "INV-901", tier: "standard" as const };

describe("billing flow-of-funds balance enforcement (WP6 FIX C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("available balance subtracts pending debits (holds) but not pending credits", async () => {
    stubLedger({ credits_posted: 500_000, debits_posted: 100_000, debits_pending: 50_000, credits_pending: 900_000 });
    await expect(getTenantAvailableBalanceKobo(42)).resolves.toBe(350_000);
  });

  it("fails closed when the ledger balance cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    await expect(getTenantAvailableBalanceKobo(42)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("sufficient funds: posts the transfer and reconciles the claim", async () => {
    const posted = stubLedger(FUNDED_ACCOUNT);
    const db = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const result = await billingRouter.createCaller(tenantContext()).recordDebit(debitInput);

    expect(result).toMatchObject({ recorded: true, idempotent: false, amountKobo: 150_000 });
    expect(posted).toHaveLength(1);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("insufficient funds: typed INSUFFICIENT_FUNDS rejection, no transfer posted, claim released", async () => {
    const posted = stubLedger(EMPTY_ACCOUNT);
    const db = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const error = await billingRouter
      .createCaller(tenantContext())
      .recordDebit(debitInput)
      .catch((e: unknown) => e);

    expect(isInsufficientFundsError(error)).toBe(true);
    expect(error).toBeInstanceOf(InsufficientFundsError);
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as InsufficientFundsError).reason).toBe("INSUFFICIENT_FUNDS");
    expect((error as InsufficientFundsError).code).toBe("PRECONDITION_FAILED");
    expect((error as InsufficientFundsError).availableKobo).toBe(0);
    expect((error as InsufficientFundsError).requestedKobo).toBe(150_000);
    expect(posted).toHaveLength(0);
    // The claim row must be released so a retry after top-up can proceed.
    expect(db.delete).toHaveBeenCalledOnce();
  });

  it("insufficient funds due to outstanding holds (pending debits)", async () => {
    const posted = stubLedger(HELD_ACCOUNT);
    const db = makeDb();
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    await expect(
      billingRouter.createCaller(tenantContext()).recordDebit(debitInput),
    ).rejects.toSatisfy((e: unknown) => isInsufficientFundsError(e) && e.availableKobo === 100_000);
    expect(posted).toHaveLength(0);
  });

  it("idempotent replay: existing claim returns without re-enforcing the balance check", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }));
    vi.stubGlobal("fetch", fetchMock);
    const db = makeDb({ existing: { transferId: "existing", reconciledAt: new Date() } });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const result = await billingRouter.createCaller(tenantContext()).recordDebit(debitInput);

    expect(result).toMatchObject({ idempotent: true, recorded: true, pendingReconciliation: false });
    // No ledger call at all: neither the balance query nor a transfer post.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });
});
