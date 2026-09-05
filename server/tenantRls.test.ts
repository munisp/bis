import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { beginTenantTransaction, commitTenantTransaction } from "./tenantRls";

function clientForTenant(tenantId: number) {
  let currentSettingReads = 0;
  const query = vi.fn(async (text: string) => {
    if (text.includes("current_setting")) {
      currentSettingReads += 1;
      return { rows: [{ tenant_id: currentSettingReads === 1 ? null : String(tenantId) }] };
    }
    return { rows: [] };
  });
  return { query } as unknown as PoolClient & { query: ReturnType<typeof vi.fn> };
}

describe("beginTenantTransaction", () => {
  it.each([
    [0, "zero"],
    [-1, "negative integer"],
    [Number.NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "infinity"],
    [Number.MAX_SAFE_INTEGER + 1, "unsafe integer"],
    ["7" as unknown as number, "numeric string"],
    ["7; SELECT pg_sleep(1)" as unknown as number, "SQL-like string"],
    [true as unknown as number, "boolean"],
    [1n as unknown as number, "bigint"],
    [{ valueOf: () => 7 } as unknown as number, "coercion object"],
    [null as unknown as number, "null"],
    [undefined as unknown as number, "undefined"],
  ])("rejects %s (%s) before issuing a pooled-client query", async (tenantId) => {
    const client = { query: vi.fn() } as unknown as PoolClient & { query: ReturnType<typeof vi.fn> };
    await expect(beginTenantTransaction(client, tenantId)).rejects.toThrow("positive trusted tenant ID");
    expect(client.query).not.toHaveBeenCalled();
  });

  it("resets, begins, transaction-binds, verifies, and commits a valid tenant scope", async () => {
    const client = clientForTenant(7);
    await beginTenantTransaction(client, 7);
    await commitTenantTransaction(client);

    expect(client.query.mock.calls.map(([text]) => text)).toEqual([
      "BEGIN",
      "RESET bis.tenant_id",
      "SELECT current_setting('bis.tenant_id', true) AS tenant_id",
      "SELECT set_config('bis.tenant_id', $1, true)",
      "SELECT current_setting('bis.tenant_id', true) AS tenant_id",
      "COMMIT",
    ]);
    expect(client.query.mock.calls[3]?.[1]).toEqual(["7"]);
  });
});
