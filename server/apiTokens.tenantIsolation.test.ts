/**
 * apiTokens.list — tenant filter composition regression tests.
 *
 * A non-admin caller passing input.tenantId must NEVER have their ownership
 * filter replaced: the tenant filter is ANDed on top of
 * eq(apiTokens.createdBy, ctx.user.id) (and the caller's own tenant), so a
 * non-admin can never list another tenant's tokens.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createFakeDb, type FakeDb } from "./test-utils/fakeDb";
import { collectEqPairs } from "./test-utils/conditionScan";

const dbHolder = vi.hoisted(() => ({ current: null as unknown as FakeDb }));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => dbHolder.current),
}));

import { apiTokensRouter } from "./apiTokens";

function ctxFor(user: { id: number; role: string; tenantId: number | null }): TrpcContext {
  return {
    user: { name: "Test User", email: "user@test.dev", ...user } as TrpcContext["user"],
    tenantId: user.tenantId,
    isDemo: false,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  dbHolder.current = createFakeDb({ api_tokens: [] });
});

describe("apiTokens.list tenant filter composition", () => {
  it("ANDs the ownership filter with a caller-supplied tenantId", async () => {
    const caller = apiTokensRouter.createCaller(ctxFor({ id: 11, role: "analyst", tenantId: 7 }));
    await caller.list({ tenantId: 8 });

    const query = dbHolder.current.captured.find(c => c.table === "api_tokens");
    expect(query).toBeDefined();
    const pairs = collectEqPairs(query!.cond);
    // Ownership filter survives even when input.tenantId is supplied
    expect(pairs).toContainEqual({ column: "createdBy", value: 11 });
    // The caller's own tenant scope is enforced too
    expect(pairs).toContainEqual({ column: "tenantId", value: 7 });
    // And the requested tenant filter is ANDed on top (never replaces ownership)
    expect(pairs).toContainEqual({ column: "tenantId", value: 8 });
  });

  it("restricts non-admins to their own tokens when no tenantId is supplied", async () => {
    const caller = apiTokensRouter.createCaller(ctxFor({ id: 11, role: "analyst", tenantId: 7 }));
    await caller.list({});

    const query = dbHolder.current.captured.find(c => c.table === "api_tokens");
    const pairs = collectEqPairs(query!.cond);
    expect(pairs).toContainEqual({ column: "createdBy", value: 11 });
    expect(pairs).toContainEqual({ column: "tenantId", value: 7 });
  });

  it("allows admins to filter by an arbitrary tenantId without an ownership filter", async () => {
    const caller = apiTokensRouter.createCaller(ctxFor({ id: 1, role: "admin", tenantId: null }));
    await caller.list({ tenantId: 8 });

    const query = dbHolder.current.captured.find(c => c.table === "api_tokens");
    const pairs = collectEqPairs(query!.cond);
    expect(pairs).toContainEqual({ column: "tenantId", value: 8 });
    expect(pairs.some(p => p.column === "createdBy")).toBe(false);
  });
});
