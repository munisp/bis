/**
 * Caddy Edge Gateway Integration
 * ─────────────────────────────────────────────────────────────────────────────
 * This module provides the BIS BFF with:
 *   1. Health check integration — Caddy is included in /api/health
 *   2. Dynamic rate limit management — tighten limits during AML/fraud incidents
 *   3. Service route registration — new polyglot services self-register with Caddy
 *   4. TLS certificate monitoring — alert when certs are near expiry
 *   5. Edge token validation — verify incoming requests carry the Caddy edge token
 *
 * Caddy Admin API: http://caddy:2019 (internal only — never expose publicly)
 * Docs: https://caddyserver.com/docs/api
 */

import { ENV } from "./_core/env";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CaddyHealthResult {
  status: "ok" | "degraded" | "down";
  version?: string;
  activeConnections?: number;
  tlsCertsManaged?: number;
  latencyMs?: number;
  error?: string;
}

export interface CaddyRateLimitZone {
  name: string;
  key: string;
  window: string;
  maxEvents: number;
}

export interface CaddyServiceRoute {
  serviceId: string;
  pathPrefix: string;
  upstreamDial: string;
  requireAuth?: boolean;
  requireMTLS?: boolean;
}

export interface CaddyTLSCert {
  domain: string;
  notBefore: string;
  notAfter: string;
  issuer: string;
  isManaged: boolean;
  daysUntilExpiry?: number;
}

// ─── Health Check ─────────────────────────────────────────────────────────────

/**
 * Check Caddy edge gateway health via the Admin API.
 * Returns status "down" if Caddy is unreachable (non-fatal in dev mode).
 */
export async function checkCaddyHealth(): Promise<CaddyHealthResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const resp = await fetch(`${ENV.caddyAdminUrl}/config/`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    }).finally(() => clearTimeout(timeout));

    const latencyMs = Date.now() - start;

    if (!resp.ok) {
      return {
        status: "degraded",
        latencyMs,
        error: `Admin API returned HTTP ${resp.status}`,
      };
    }

    // Try to get metrics for connection count
    let activeConnections: number | undefined;
    try {
      const metricsResp = await fetch(`${ENV.caddyAdminUrl}/metrics`, {
        headers: { Accept: "application/json" },
      });
      if (metricsResp.ok) {
        const metrics = await metricsResp.json() as { active_connections?: number };
        activeConnections = metrics.active_connections;
      }
    } catch {
      // Metrics endpoint is optional — not all Caddy builds expose it
    }

    return {
      status: "ok",
      latencyMs,
      activeConnections,
    };
  } catch (err: unknown) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "unreachable",
    };
  }
}

// ─── Rate Limit Management ────────────────────────────────────────────────────

/**
 * Dynamically update a Caddy rate limit zone.
 * Called during AML/fraud incidents to tighten rate limits at the edge.
 *
 * @example
 * // Tighten global API rate limit during an AML incident
 * await updateCaddyRateLimit({
 *   name: "api_global",
 *   key: "{remote_host}",
 *   window: "1m",
 *   maxEvents: 50,  // down from 300
 * });
 */
export async function updateCaddyRateLimit(zone: CaddyRateLimitZone): Promise<void> {
  const url = `${ENV.caddyAdminUrl}/config/apps/http/servers/public/rate_limits/${zone.name}`;

  const resp = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: zone.key,
      window: zone.window,
      max_events: zone.maxEvents,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`[Caddy] Failed to update rate limit zone '${zone.name}': ${body}`);
  }
}

/**
 * Reset a Caddy rate limit zone to its default values.
 * Called after an AML incident is resolved.
 */
export async function resetCaddyRateLimit(zoneName: string): Promise<void> {
  const defaults: Record<string, { window: string; maxEvents: number }> = {
    api_global: { window: "1m", maxEvents: 300 },
    api_auth: { window: "1m", maxEvents: 30 },
    api_kyc: { window: "1h", maxEvents: 100 },
    api_sar: { window: "1h", maxEvents: 50 },
    api_aml: { window: "1m", maxEvents: 200 },
    api_billing: { window: "1m", maxEvents: 100 },
  };

  const def = defaults[zoneName];
  if (!def) {
    throw new Error(`[Caddy] Unknown rate limit zone: ${zoneName}`);
  }

  await updateCaddyRateLimit({
    name: zoneName,
    key: "{remote_host}",
    ...def,
  });
}

// ─── Service Route Registration ───────────────────────────────────────────────

/**
 * Register a new BIS microservice route with Caddy's internal mTLS server.
 * Called by new polyglot services on startup to self-register.
 */
export async function registerCaddyServiceRoute(svc: CaddyServiceRoute): Promise<void> {
  const route = {
    "@id": `bis-internal-${svc.serviceId}`,
    match: [{ path: [`${svc.pathPrefix}/*`] }],
    handle: [
      {
        handler: "subroute",
        routes: [
          {
            handle: [
              {
                handler: "reverse_proxy",
                upstreams: [{ dial: svc.upstreamDial }],
                headers: {
                  request: {
                    set: {
                      "X-BIS-Internal": ["true"],
                      "X-BIS-Service": [svc.serviceId],
                    },
                  },
                },
                transport: {
                  protocol: "http",
                  dial_timeout: "5s",
                },
              },
            ],
          },
        ],
      },
    ],
  };

  const resp = await fetch(
    `${ENV.caddyAdminUrl}/config/apps/http/servers/internal/routes/...`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(route),
    }
  );

  if (!resp.ok && resp.status !== 409) {
    // 409 = route already registered (idempotent)
    const body = await resp.text();
    throw new Error(`[Caddy] Failed to register service route '${svc.serviceId}': ${body}`);
  }
}

// ─── TLS Certificate Monitoring ───────────────────────────────────────────────

/**
 * Get the status of all Caddy-managed TLS certificates.
 * Used by the /api/health endpoint and the ops dashboard.
 */
export async function getCaddyTLSCerts(): Promise<CaddyTLSCert[]> {
  try {
    const resp = await fetch(`${ENV.caddyAdminUrl}/pki/ca/local/certificates`, {
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      return [];
    }

    const certs = await resp.json() as Array<{
      domain: string;
      not_before: string;
      not_after: string;
      issuer: string;
      is_managed: boolean;
    }>;

    return certs.map((c) => {
      const notAfter = new Date(c.not_after);
      const daysUntilExpiry = Math.floor(
        (notAfter.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      return {
        domain: c.domain,
        notBefore: c.not_before,
        notAfter: c.not_after,
        issuer: c.issuer,
        isManaged: c.is_managed,
        daysUntilExpiry,
      };
    });
  } catch {
    return [];
  }
}

// ─── Edge Token Validation ────────────────────────────────────────────────────

/**
 * Validate that an incoming request carries the Caddy edge token.
 * This is a defence-in-depth check — Caddy and APISIX both validate this.
 * The BFF also validates it to ensure all requests passed through the full
 * security stack: Caddy → OpenAppSec → APISIX → BFF.
 */
export function validateEdgeToken(token: string | undefined): boolean {
  if (!token) return false;
  // Constant-time comparison to prevent timing attacks
  const expected = ENV.bisEdgeTokenSecret;
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// ─── tRPC Router ─────────────────────────────────────────────────────────────

import { router, adminProcedure } from "./_core/trpc";
import { z } from "zod";

export const caddyRouter = router({
  /**
   * Get Caddy edge gateway health and TLS certificate status.
   * Admin-only: used by the ops dashboard.
   */
  health: adminProcedure.query(async () => {
    const [health, certs] = await Promise.all([
      checkCaddyHealth(),
      getCaddyTLSCerts(),
    ]);

    const expiringCerts = certs.filter(
      (c) => c.daysUntilExpiry !== undefined && c.daysUntilExpiry < 30
    );

    return {
      ...health,
      tlsCertsManaged: certs.length,
      expiringCerts,
      certs,
    };
  }),

  /**
   * Update a Caddy rate limit zone.
   * Used during AML/fraud incidents to tighten rate limits at the edge.
   */
  updateRateLimit: adminProcedure
    .input(
      z.object({
        name: z.enum([
          "api_global",
          "api_auth",
          "api_kyc",
          "api_sar",
          "api_aml",
          "api_billing",
        ]),
        maxEvents: z.number().int().min(1).max(10000),
        window: z.string().regex(/^\d+[smh]$/).default("1m"),
      })
    )
    .mutation(async ({ input }) => {
      await updateCaddyRateLimit({
        name: input.name,
        key: "{remote_host}",
        window: input.window,
        maxEvents: input.maxEvents,
      });
      return { success: true, zone: input.name, maxEvents: input.maxEvents };
    }),

  /**
   * Reset a Caddy rate limit zone to its default values.
   * Called after an AML/fraud incident is resolved.
   */
  resetRateLimit: adminProcedure
    .input(
      z.object({
        name: z.enum([
          "api_global",
          "api_auth",
          "api_kyc",
          "api_sar",
          "api_aml",
          "api_billing",
        ]),
      })
    )
    .mutation(async ({ input }) => {
      await resetCaddyRateLimit(input.name);
      return { success: true, zone: input.name, reset: true };
    }),

  /**
   * Get the current Caddy configuration (admin only).
   */
  getConfig: adminProcedure.query(async () => {
    const resp = await fetch(`${ENV.caddyAdminUrl}/config/`, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      throw new Error(`[Caddy] Failed to get config: HTTP ${resp.status}`);
    }
    return resp.json();
  }),
});
