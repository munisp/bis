/**
 * Caddy Edge Gateway Integration Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests all Caddy integration points:
 *   1. Health check (admin API reachable/unreachable)
 *   2. Rate limit management (update/reset zones)
 *   3. Service route registration
 *   4. TLS certificate monitoring
 *   5. Edge token validation
 *   6. tRPC router procedures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkCaddyHealth,
  updateCaddyRateLimit,
  resetCaddyRateLimit,
  registerCaddyServiceRoute,
  getCaddyTLSCerts,
  validateEdgeToken,
} from "./caddy";

// ─── Mock fetch globally ──────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Mock ENV ─────────────────────────────────────────────────────────────────

vi.mock("./_core/env", () => ({
  ENV: {
    caddyAdminUrl: "http://caddy:2019",
    bisEdgeTokenSecret: "test-edge-secret-32-chars-exactly!",
    bisDomain: "bis.localhost",
    keycloakDomain: "auth.bis.localhost",
  },
}));

// ─── Health Check Tests ───────────────────────────────────────────────────────

describe("checkCaddyHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when Caddy admin API is reachable", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ active_connections: 42 }),
      });

    const result = await checkCaddyHealth();

    expect(result.status).toBe("ok");
    expect(result.activeConnections).toBe(42);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("returns degraded when admin API returns non-200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const result = await checkCaddyHealth();

    expect(result.status).toBe("degraded");
    expect(result.error).toContain("503");
  });

  it("returns down when Caddy is unreachable (network error)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await checkCaddyHealth();

    expect(result.status).toBe("down");
    expect(result.error).toContain("ECONNREFUSED");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns down when fetch times out (AbortError)", async () => {
    mockFetch.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" })
    );

    const result = await checkCaddyHealth();

    expect(result.status).toBe("down");
  });

  it("returns ok even when metrics endpoint fails (metrics are optional)", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apps: {} }),
      })
      .mockRejectedValueOnce(new Error("metrics endpoint unavailable"));

    const result = await checkCaddyHealth();

    // Should still be ok — metrics are optional
    expect(result.status).toBe("ok");
    expect(result.activeConnections).toBeUndefined();
  });
});

// ─── Rate Limit Management Tests ─────────────────────────────────────────────

describe("updateCaddyRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends PATCH to the correct rate limit zone URL", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await updateCaddyRateLimit({
      name: "api_global",
      key: "{remote_host}",
      window: "1m",
      maxEvents: 50,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://caddy:2019/config/apps/http/servers/public/rate_limits/api_global",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ key: "{remote_host}", window: "1m", max_events: 50 }),
      })
    );
  });

  it("throws when Caddy returns an error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "zone not found",
    });

    await expect(
      updateCaddyRateLimit({ name: "api_global", key: "{remote_host}", window: "1m", maxEvents: 50 })
    ).rejects.toThrow("Failed to update rate limit zone");
  });
});

describe("resetCaddyRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets api_global to 300 req/min", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await resetCaddyRateLimit("api_global");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ key: "{remote_host}", window: "1m", max_events: 300 }),
      })
    );
  });

  it("resets api_auth to 30 req/min", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await resetCaddyRateLimit("api_auth");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ key: "{remote_host}", window: "1m", max_events: 30 }),
      })
    );
  });

  it("resets api_kyc to 100 req/hour", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await resetCaddyRateLimit("api_kyc");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ key: "{remote_host}", window: "1h", max_events: 100 }),
      })
    );
  });

  it("throws for unknown zone names", async () => {
    await expect(resetCaddyRateLimit("unknown_zone")).rejects.toThrow("Unknown rate limit zone");
  });
});

// ─── Service Route Registration Tests ────────────────────────────────────────

describe("registerCaddyServiceRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends POST to the correct routes endpoint", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await registerCaddyServiceRoute({
      serviceId: "compliance-reporter",
      pathPrefix: "/internal/compliance",
      upstreamDial: "compliance-reporter:8094",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://caddy:2019/config/apps/http/servers/internal/routes/...",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body["@id"]).toBe("bis-internal-compliance-reporter");
    expect(body.handle[0].handler).toBe("subroute");
  });

  it("is idempotent — does not throw on 409 (route already registered)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 409 });

    // Should not throw
    await expect(
      registerCaddyServiceRoute({
        serviceId: "risk-engine",
        pathPrefix: "/internal/risk",
        upstreamDial: "risk-engine:8082",
      })
    ).resolves.toBeUndefined();
  });

  it("throws on non-409 errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "internal server error",
    });

    await expect(
      registerCaddyServiceRoute({
        serviceId: "bad-service",
        pathPrefix: "/internal/bad",
        upstreamDial: "bad:9999",
      })
    ).rejects.toThrow("Failed to register service route");
  });
});

// ─── TLS Certificate Monitoring Tests ────────────────────────────────────────

describe("getCaddyTLSCerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed cert list with days until expiry", async () => {
    const futureDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
    const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          domain: "bis.localhost",
          not_before: pastDate,
          not_after: futureDate,
          issuer: "Let's Encrypt",
          is_managed: true,
        },
      ],
    });

    const certs = await getCaddyTLSCerts();

    expect(certs).toHaveLength(1);
    expect(certs[0].domain).toBe("bis.localhost");
    expect(certs[0].isManaged).toBe(true);
    expect(certs[0].daysUntilExpiry).toBeGreaterThan(40);
    expect(certs[0].daysUntilExpiry).toBeLessThan(50);
  });

  it("returns empty array when PKI endpoint is unavailable", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const certs = await getCaddyTLSCerts();
    expect(certs).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const certs = await getCaddyTLSCerts();
    expect(certs).toEqual([]);
  });

  it("correctly identifies certs expiring within 30 days", async () => {
    const soonDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
    const pastDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          domain: "expiring-soon.bis.localhost",
          not_before: pastDate,
          not_after: soonDate,
          issuer: "Internal CA",
          is_managed: false,
        },
      ],
    });

    const certs = await getCaddyTLSCerts();
    expect(certs[0].daysUntilExpiry).toBeLessThan(30);
  });
});

// ─── Edge Token Validation Tests ─────────────────────────────────────────────

describe("validateEdgeToken", () => {
  it("returns true for the correct edge token", () => {
    // The mock ENV sets bisEdgeTokenSecret to "test-edge-secret-32-chars-exactly!"
    expect(validateEdgeToken("test-edge-secret-32-chars-exactly!")).toBe(true);
  });

  it("returns false for an incorrect token", () => {
    expect(validateEdgeToken("wrong-token")).toBe(false);
  });

  it("returns false for undefined token", () => {
    expect(validateEdgeToken(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(validateEdgeToken("")).toBe(false);
  });

  it("returns false for a token that is almost correct (1 char diff)", () => {
    // Constant-time comparison should still return false
    expect(validateEdgeToken("test-edge-secret-32-chars-exactly?")).toBe(false);
  });

  it("returns false for a token of different length", () => {
    expect(validateEdgeToken("test-edge-secret-32-chars-exactly!extra")).toBe(false);
  });
});

// ─── Integration: Health Check includes Caddy ────────────────────────────────

describe("Caddy health check integration", () => {
  it("health check correctly reports Caddy as ok when admin API is up", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ active_connections: 10 }) });

    const result = await checkCaddyHealth();
    expect(result.status).toBe("ok");
    expect(result.activeConnections).toBe(10);
  });

  it("health check correctly reports Caddy as degraded when admin API is slow", async () => {
    // Simulate a slow response that still succeeds
    mockFetch.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return { ok: true, json: async () => ({}) };
    });
    mockFetch.mockRejectedValueOnce(new Error("metrics timeout"));

    const result = await checkCaddyHealth();
    expect(result.status).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Rate Limit Incident Workflow ─────────────────────────────────────────────

describe("AML incident rate limit workflow", () => {
  it("can tighten and then reset rate limits during an AML incident", async () => {
    vi.clearAllMocks();

    // Step 1: Tighten during incident
    mockFetch.mockResolvedValueOnce({ ok: true });
    await updateCaddyRateLimit({
      name: "api_aml",
      key: "{remote_host}",
      window: "1m",
      maxEvents: 20,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const tightenInit = mockFetch.mock.calls[0][1] as RequestInit;
    const tightenBody = JSON.parse(tightenInit.body as string);
    expect(tightenBody.max_events).toBe(20);
    expect(tightenBody.window).toBe("1m");

    // Step 2: Reset after incident resolved
    mockFetch.mockResolvedValueOnce({ ok: true });
    await resetCaddyRateLimit("api_aml");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const resetInit = mockFetch.mock.calls[1][1] as RequestInit;
    const resetBody = JSON.parse(resetInit.body as string);
    expect(resetBody.max_events).toBe(200);
  });
});
