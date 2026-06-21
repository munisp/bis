/**
 * server/velocity.blocks.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the velocity-block DB-write path inside fluvioCheckVelocity.
 *
 * When the Fluvio sidecar returns { decision: "block" } the function MUST
 * persist an audit row to the velocity_blocks table so compliance officers
 * can review blocked transfers.
 *
 * Covered scenarios:
 *   1. "allow" decision → no DB insert
 *   2. "block" decision → one row inserted with correct field values
 *   3. "block" decision with optional tx_ref → tx_ref is persisted
 *   4. DB write failure is non-fatal (fail-open: still returns "block")
 *   5. Sidecar timeout → fail-open, no DB write
 *   6. Sidecar ECONNREFUSED → fail-open, no DB write
 *   7. Non-2xx from sidecar → fail-open (allow), no DB write
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module mocks (must be hoisted before any import that uses them) ──────────

vi.mock("./db");

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { getDb, __resetStore } from "./db";
import { fluvioCheckVelocity, type FluvioVelocityCheckInput } from "./fluvio";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_INPUT: FluvioVelocityCheckInput = {
  account_id: "ACC-TEST-001",
  amount_kobo: 500_000_00,
  currency: "NGN",
  tenant_id: "tenant-test",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fluvioCheckVelocity — velocity_blocks DB-write path", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    __resetStore();
    // Clear call history on the insert spy so tests are independent
    const db = await getDb();
    (db as any).insert.mockClear();

    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetStore();
  });

  // ── 1. Allow decision → no DB insert ────────────────────────────────────────
  it("does NOT insert a velocity_blocks row when the sidecar returns 'allow'", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ decision: "allow" }),
      text: async () => '{"decision":"allow"}',
    });

    const result = await fluvioCheckVelocity(BASE_INPUT);

    expect(result.decision).toBe("allow");
    expect(result.service_available).toBe(true);

    const db = await getDb();
    // insert should not have been called at all
    expect((db as any).insert).not.toHaveBeenCalled();
  });

  // ── 2. Block decision → row inserted with correct fields ────────────────────
  it("inserts a velocity_blocks row with correct field values when decision is 'block'", async () => {
    const sidecarBody = {
      decision: "block",
      reason: "burst limit exceeded",
      window_count: 12,
      window_seconds: 60,
      threshold: 10,
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sidecarBody,
      text: async () => JSON.stringify(sidecarBody),
    });

    const result = await fluvioCheckVelocity(BASE_INPUT);

    expect(result.decision).toBe("block");
    expect(result.reason).toBe("burst limit exceeded");
    expect(result.service_available).toBe(true);

    const db = await getDb();
    expect((db as any).insert).toHaveBeenCalledOnce();

    // Inspect the values passed to insert().values(...)
    const valuesCall = (db as any).insert.mock.results[0].value.values.mock.calls[0][0];

    expect(valuesCall.accountId).toBe(BASE_INPUT.account_id);
    expect(valuesCall.tenantId).toBe(BASE_INPUT.tenant_id);
    expect(valuesCall.amountKobo).toBe(BASE_INPUT.amount_kobo);
    expect(valuesCall.windowCount).toBe(12);
    expect(valuesCall.windowSeconds).toBe(60);
    expect(valuesCall.threshold).toBe(10);
    expect(valuesCall.decision).toBe("block");
    expect(valuesCall.reason).toBe("burst limit exceeded");
  });

  // ── 3. Block with tx_ref → tx_ref is persisted ──────────────────────────────
  it("persists tx_ref when the input carries a tx_ref field", async () => {
    // tx_ref is an optional extension field not in the typed interface; cast via any
    const inputWithTxRef = { ...BASE_INPUT, tx_ref: "TXN-VEL-001" } as any;
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        decision: "block",
        reason: "velocity",
        window_count: 5,
        window_seconds: 60,
        threshold: 3,
      }),
      text: async () => '{}',
    });

    await fluvioCheckVelocity(inputWithTxRef);

    const db = await getDb();
    expect((db as any).insert).toHaveBeenCalledOnce();
    const valuesCall = (db as any).insert.mock.results[0].value.values.mock.calls[0][0];
    expect(valuesCall.txRef).toBe("TXN-VEL-001");
  });

  // ── 4. DB write failure is non-fatal ────────────────────────────────────────
  it("returns 'block' even when the DB insert throws (non-fatal audit failure)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        decision: "block",
        reason: "threshold",
        window_count: 8,
        window_seconds: 60,
        threshold: 5,
      }),
      text: async () => '{}',
    });

    // Make the DB insert throw
    const db = await getDb();
    (db as any).insert.mockImplementation(() => {
      throw new Error("DB connection lost");
    });

    // Should NOT throw — DB failure is swallowed
    const result = await fluvioCheckVelocity(BASE_INPUT);
    expect(result.decision).toBe("block");
    expect(result.service_available).toBe(true);
  });

  // ── 5. Sidecar timeout → fail-open, no DB write ─────────────────────────────
  it("fails open (allow) and does not write to DB when the sidecar times out", async () => {
    // Simulate AbortError (timeout)
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValue(abortError);

    const result = await fluvioCheckVelocity(BASE_INPUT);

    expect(result.decision).toBe("allow");
    expect(result.service_available).toBe(false);

    const db = await getDb();
    expect((db as any).insert).not.toHaveBeenCalled();
  });

  // ── 6. Sidecar ECONNREFUSED → fail-open, no DB write ────────────────────────
  it("fails open (allow) and does not write to DB when the sidecar is unreachable", async () => {
    const connError = new Error("connect ECONNREFUSED 127.0.0.1:9999");
    connError.message = "ECONNREFUSED";
    mockFetch.mockRejectedValue(connError);

    const result = await fluvioCheckVelocity(BASE_INPUT);

    expect(result.decision).toBe("allow");
    expect(result.service_available).toBe(false);

    const db = await getDb();
    expect((db as any).insert).not.toHaveBeenCalled();
  });

  // ── 7. Non-2xx from sidecar → fail-open (allow), no DB write ────────────────
  it("fails open (allow) on non-2xx HTTP response and does not write to DB", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });

    const result = await fluvioCheckVelocity(BASE_INPUT);

    expect(result.decision).toBe("allow");
    // sidecar was reachable (no network error) but returned a non-2xx status
    expect(result.service_available).toBe(true);

    const db = await getDb();
    expect((db as any).insert).not.toHaveBeenCalled();
  });
});
