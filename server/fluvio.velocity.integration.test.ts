/**
 * Fluvio Velocity Processor — Integration Test
 *
 * Spins up a lightweight mock HTTP server on an ephemeral port that simulates
 * the fluvio-velocity sidecar.  Tests verify:
 *
 *   1. A single transfer is allowed (below threshold)
 *   2. A burst of 11 transfers in 60 s triggers a "block" decision
 *   3. A transfer above the ₦5,000,000 single-transfer limit is blocked
 *   4. The BFF fails open when the sidecar is unreachable (ECONNREFUSED)
 *   5. The BFF fails open when the sidecar returns HTTP 500
 *   6. The BFF fails open when the sidecar times out (>500 ms)
 *   7. Velocity decisions are tenant-isolated (different tenants have independent counters)
 *   8. The velocity check correctly passes account_id, amount_kobo, currency, tenant_id
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FluvioVelocityCheckInput, FluvioVelocityDecision } from "./fluvio";

// ── Mock sidecar state ──────────────────────────────────────────────────────

interface MockState {
  /** Simulate HTTP 500 response */
  returnError: boolean;
  /** Simulate a slow response (>500 ms timeout) */
  returnTimeout: boolean;
  /** Force a specific decision regardless of counters */
  forcedDecision: "allow" | "block" | null;
  /** Per-account transfer counts for burst detection */
  transferCounts: Map<string, number>;
  /** Last received request body for assertion */
  lastRequest: FluvioVelocityCheckInput | null;
}

const BURST_LIMIT = 10;          // block after >10 transfers in window
const SINGLE_LIMIT_KOBO = 500_000_000; // ₦5,000,000 in kobo

const state: MockState = {
  returnError: false,
  returnTimeout: false,
  forcedDecision: null,
  transferCounts: new Map(),
  lastRequest: null,
};

function resetState() {
  state.returnError = false;
  state.returnTimeout = false;
  state.forcedDecision = null;
  state.transferCounts.clear();
  state.lastRequest = null;
}

// ── Mock HTTP server ────────────────────────────────────────────────────────

let mockPort: number;
let originalEnv: string | undefined;

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/v1/velocity/check" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      if (state.returnTimeout) {
        // Delay beyond the 500 ms hard timeout — never respond
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ decision: "allow" }));
        }, 2_000);
        return;
      }

      if (state.returnError) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
        return;
      }

      const input = JSON.parse(body) as FluvioVelocityCheckInput;
      state.lastRequest = input;

      // Forced decision override
      if (state.forcedDecision !== null) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ decision: state.forcedDecision }));
        return;
      }

      // Single-transfer amount limit
      if (input.amount_kobo > SINGLE_LIMIT_KOBO) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          decision: "block",
          reason: `Single transfer exceeds ₦5,000,000 limit (${input.amount_kobo} kobo)`,
        }));
        return;
      }

      // Burst limit: tenant-isolated counter keyed by `${tenant_id}:${account_id}`
      const key = `${input.tenant_id}:${input.account_id}`;
      const count = (state.transferCounts.get(key) ?? 0) + 1;
      state.transferCounts.set(key, count);

      if (count > BURST_LIMIT) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          decision: "block",
          reason: `Burst limit exceeded: ${count} transfers in window (limit ${BURST_LIMIT})`,
        }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ decision: "allow" }));
    });
  } else if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      mockPort = addr.port;
      resolve();
    });
  });
  // Point fluvio.ts at the mock sidecar
  originalEnv = process.env.FLUVIO_VELOCITY_URL;
  process.env.FLUVIO_VELOCITY_URL = `http://127.0.0.1:${mockPort}`;
});

afterAll(async () => {
  // Restore env
  if (originalEnv !== undefined) {
    process.env.FLUVIO_VELOCITY_URL = originalEnv;
  } else {
    delete process.env.FLUVIO_VELOCITY_URL;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetState();
});

// ── Helper: dynamically import fluvioCheckVelocity after env is set ─────────

async function checkVelocity(input: FluvioVelocityCheckInput): Promise<FluvioVelocityDecision> {
  // Re-import on each call so the module picks up the updated FLUVIO_VELOCITY_URL env.
  // vitest caches modules, so we use a cache-busting query string.
  const { fluvioCheckVelocity } = await import(`./fluvio?t=${Date.now()}`);
  return fluvioCheckVelocity(input) as Promise<FluvioVelocityDecision>;
}

const BASE_INPUT: FluvioVelocityCheckInput = {
  account_id: "acc-001",
  amount_kobo: 10_000_00, // ₦10,000
  currency: "NGN",
  tenant_id: "tenant-alpha",
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Fluvio velocity processor — integration tests", () => {
  it("allows a single transfer below all thresholds", async () => {
    const result = await checkVelocity(BASE_INPUT);
    expect(result.decision).toBe("allow");
    expect(result.service_available).toBe(true);
  });

  it("blocks after a burst of 11 transfers in the window", async () => {
    // First 10 should be allowed
    for (let i = 0; i < BURST_LIMIT; i++) {
      const r = await checkVelocity(BASE_INPUT);
      expect(r.decision).toBe("allow");
    }
    // 11th should be blocked
    const blocked = await checkVelocity(BASE_INPUT);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toMatch(/burst limit exceeded/i);
    expect(blocked.service_available).toBe(true);
  });

  it("blocks a single transfer exceeding ₦5,000,000", async () => {
    const bigTransfer: FluvioVelocityCheckInput = {
      ...BASE_INPUT,
      amount_kobo: 600_000_000, // ₦6,000,000
    };
    const result = await checkVelocity(bigTransfer);
    expect(result.decision).toBe("block");
    expect(result.reason).toMatch(/₦5,000,000/);
    expect(result.service_available).toBe(true);
  });

  it("fails open when the sidecar is unreachable (ECONNREFUSED)", async () => {
    // Simulate ECONNREFUSED by making globalThis.fetch throw a network error
    const originalFetch = globalThis.fetch;
    const networkError = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(networkError);
    try {
      const { fluvioCheckVelocity } = await import("./fluvio");
      const result = await (fluvioCheckVelocity as (i: FluvioVelocityCheckInput) => Promise<FluvioVelocityDecision>)(BASE_INPUT);
      expect(result.decision).toBe("allow");
      expect(result.service_available).toBe(false);
    } finally {
      vi.spyOn(globalThis, "fetch").mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it("fails open when the sidecar returns HTTP 500", async () => {
    state.returnError = true;
    const result = await checkVelocity(BASE_INPUT);
    expect(result.decision).toBe("allow");
    expect(result.service_available).toBe(true);
  });

  it("fails open when the sidecar exceeds the 500 ms hard timeout", async () => {
    state.returnTimeout = true;
    const start = Date.now();
    const result = await checkVelocity(BASE_INPUT);
    const elapsed = Date.now() - start;
    expect(result.decision).toBe("allow");
    expect(result.service_available).toBe(false);
    // Should resolve well under 2 s (the mock delay) — hard timeout is 500 ms
    expect(elapsed).toBeLessThan(1_500);
  }, 10_000);

  it("isolates velocity counters by tenant_id", async () => {
    const tenantA: FluvioVelocityCheckInput = { ...BASE_INPUT, tenant_id: "tenant-alpha" };
    const tenantB: FluvioVelocityCheckInput = { ...BASE_INPUT, tenant_id: "tenant-beta" };

    // Exhaust tenant-alpha's burst limit
    for (let i = 0; i < BURST_LIMIT; i++) {
      await checkVelocity(tenantA);
    }
    const blockedA = await checkVelocity(tenantA);
    expect(blockedA.decision).toBe("block");

    // tenant-beta should still be allowed (independent counter)
    const allowedB = await checkVelocity(tenantB);
    expect(allowedB.decision).toBe("allow");
  });

  it("correctly passes account_id, amount_kobo, currency, tenant_id to the sidecar", async () => {
    const input: FluvioVelocityCheckInput = {
      account_id: "acc-verify",
      amount_kobo: 50_000_00,
      currency: "USD",
      tenant_id: "tenant-verify",
    };
    await checkVelocity(input);
    expect(state.lastRequest).not.toBeNull();
    expect(state.lastRequest?.account_id).toBe("acc-verify");
    expect(state.lastRequest?.amount_kobo).toBe(50_000_00);
    expect(state.lastRequest?.currency).toBe("USD");
    expect(state.lastRequest?.tenant_id).toBe("tenant-verify");
  });
});
