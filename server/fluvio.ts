/**
 * server/fluvio.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fluvio event streaming integration for the BIS BFF.
 *
 * Architecture:
 *   BIS BFF (Node.js)
 *       │
 *       │  HTTP POST /v1/events  (PaymentEvent JSON)
 *       ▼
 *   fluvio-velocity (Rust sidecar, port 9090)
 *       │
 *       │  Sliding-window velocity checks
 *       ▼
 *   POST /v1/velocity/alert  →  BIS Gateway
 *
 * The Rust fluvio-velocity service (services/fluvio-velocity/) consumes events
 * from this endpoint, applies sliding-window velocity rules, and dispatches
 * breach alerts back to the BIS Gateway.
 *
 * In production the fluvio-velocity service also connects directly to a Fluvio
 * cluster (topic: bis.payment.events) for high-throughput streaming. The HTTP
 * endpoint is the BFF's integration point — it does not require a live Fluvio
 * cluster to function.
 *
 * Environment variables:
 *   FLUVIO_VELOCITY_URL  — base URL of the fluvio-velocity sidecar
 *                          (default: http://localhost:9090)
 */

import { ENV } from "./_core/env";

const FLUVIO_VELOCITY_URL =
  process.env.FLUVIO_VELOCITY_URL ?? "http://localhost:9090";

const TIMEOUT_MS = 5_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FluvioPaymentEvent {
  /** "initiated" | "completed" | "failed" | "reversed" */
  event_type: string;
  /** Unique transaction reference */
  tx_ref: string;
  /** Account or wallet ID being debited/credited */
  account_id: string;
  /** Amount in kobo (1 NGN = 100 kobo) */
  amount_kobo: number;
  /** ISO 4217 currency code (default: "NGN") */
  currency: string;
  /** Payment rail: "mojaloop" | "nip" | "rtgs" | "internal" */
  rail: string;
  /** Whether this is a cross-border transaction */
  is_cross_border?: boolean;
  /** Tenant identifier for multi-tenant isolation */
  tenant_id: string;
  /** ISO 8601 timestamp (default: now) */
  timestamp?: string;
}

export interface FluvioPublishResult {
  /** Whether the event was accepted by the velocity processor */
  accepted: boolean;
  /** Whether the velocity processor is reachable */
  service_available: boolean;
  /** Error message if not accepted */
  reason?: string;
}

// ─── Publisher ────────────────────────────────────────────────────────────────

/**
 * Publish a payment event to the Fluvio velocity processor.
 *
 * This is a non-blocking, best-effort call. Failures are logged but do not
 * propagate — payment processing must not be blocked by the velocity sidecar.
 *
 * @param event  Payment event payload
 * @returns      Publish result (accepted, service_available, reason)
 */
export async function fluvioPublishPaymentEvent(
  event: FluvioPaymentEvent
): Promise<FluvioPublishResult> {
  const payload: FluvioPaymentEvent = {
    ...event,
    currency: event.currency ?? "NGN",
    timestamp: event.timestamp ?? new Date().toISOString(),
  };

  try {
    const res = await fetch(`${FLUVIO_VELOCITY_URL}/v1/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BIS-Key": ENV.bisGatewayKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.ok) {
      return { accepted: true, service_available: true };
    }

    const body = await res.text().catch(() => "");
    console.warn(
      `[Fluvio] velocity processor rejected event (${res.status}): ${body}`
    );
    return {
      accepted: false,
      service_available: true,
      reason: `HTTP ${res.status}: ${body.slice(0, 200)}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // ECONNREFUSED / timeout = velocity sidecar not running (expected in dev/test)
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("AbortError") ||
      (err as Error)?.name === "AbortError"
    ) {
      console.debug("[Fluvio] velocity processor unavailable (non-fatal):", msg);
    } else {
      console.warn("[Fluvio] unexpected error publishing payment event:", msg);
    }
    return { accepted: false, service_available: false, reason: msg };
  }
}

/**
 * Publish a biometric event to the Fluvio velocity processor.
 * Used for biometric fraud velocity checks (e.g., rapid spoof attempts).
 */
export async function fluvioPublishBiometricEvent(opts: {
  event_type: "enrolled" | "verified" | "spoof_detected" | "enrollment_failed";
  subject_ref: string;
  kyc_record_id?: number;
  score?: number;
  spoof_type?: string;
  tenant_id: string;
}): Promise<FluvioPublishResult> {
  try {
    const res = await fetch(`${FLUVIO_VELOCITY_URL}/v1/biometric-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BIS-Key": ENV.bisGatewayKey,
      },
      body: JSON.stringify({
        ...opts,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.ok) {
      return { accepted: true, service_available: true };
    }

    const body = await res.text().catch(() => "");
    return {
      accepted: false,
      service_available: true,
      reason: `HTTP ${res.status}: ${body.slice(0, 200)}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.debug("[Fluvio] biometric event publish failed (non-fatal):", msg);
    return { accepted: false, service_available: false, reason: msg };
  }
}

/**
 * Publish an AML alert event to the Fluvio velocity processor.
 * Used for AML alert velocity checks (e.g., rapid alert generation).
 */
export async function fluvioPublishAmlEvent(opts: {
  alert_id: number;
  alert_type: string;
  risk_score: number;
  subject_ref?: string;
  transaction_ref?: string;
  tenant_id: string;
  auto_escalated?: boolean;
}): Promise<FluvioPublishResult> {
  try {
    const res = await fetch(`${FLUVIO_VELOCITY_URL}/v1/aml-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BIS-Key": ENV.bisGatewayKey,
      },
      body: JSON.stringify({
        ...opts,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.ok) {
      return { accepted: true, service_available: true };
    }

    const body = await res.text().catch(() => "");
    return {
      accepted: false,
      service_available: true,
      reason: `HTTP ${res.status}: ${body.slice(0, 200)}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.debug("[Fluvio] AML event publish failed (non-fatal):", msg);
    return { accepted: false, service_available: false, reason: msg };
  }
}

/**
 * Health check for the Fluvio velocity processor.
 * Returns { ok: true } if the sidecar is reachable.
 */
export async function fluvioHealthCheck(): Promise<{
  ok: boolean;
  latencyMs?: number;
}> {
  const start = Date.now();
  try {
    const res = await fetch(`${FLUVIO_VELOCITY_URL}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}
