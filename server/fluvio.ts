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
import { getDb } from "./db";
import { velocityBlocks } from "../drizzle/schema";
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

// ─── Velocity Pre-flight Check ────────────────────────────────────────────────

export interface FluvioVelocityCheckInput {
  /** The account ID to check velocity for */
  account_id: string;
  /** Amount of the proposed transfer in kobo */
  amount_kobo: number;
  /** ISO-4217 currency code */
  currency: string;
  /** Tenant ID for multi-tenant velocity isolation */
  tenant_id: string;
}

export interface FluvioVelocityDecision {
  /** "allow" — transfer may proceed; "block" — transfer must be rejected */
  decision: "allow" | "block";
  /** Human-readable reason when decision is "block" */
  reason?: string;
  /** Whether the velocity processor was reachable */
  service_available: boolean;
}

/**
 * Query the Fluvio velocity processor for a pre-flight velocity decision.
 *
 * This is a **blocking** call — the result gates whether the transfer proceeds.
 * If the velocity processor is unavailable (ECONNREFUSED / timeout), the call
 * returns `{ decision: "allow", service_available: false }` so that a sidecar
 * outage does not block all payments (fail-open for availability).
 *
 * In production, configure the velocity processor to return "block" when:
 *   - The account has submitted >10 transfers in the last 60 seconds
 *   - The account has transferred >₦5,000,000 in the last 5 minutes
 *   - The account is on a real-time watchlist (EFCC / OFAC)
 */
export async function fluvioCheckVelocity(
  input: FluvioVelocityCheckInput
): Promise<FluvioVelocityDecision> {
  try {
    const res = await fetch(`${FLUVIO_VELOCITY_URL}/v1/velocity/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BIS-Key": ENV.bisGatewayKey,
      },
      body: JSON.stringify(input),
      // Hard timeout: 500 ms — must not slow down the payment path
      signal: AbortSignal.timeout(500),
    });

    if (res.ok) {
      const body = (await res.json()) as {
        decision: "allow" | "block";
        reason?: string;
        window_count?: number;
        window_seconds?: number;
        threshold?: number;
      };
      const decision = body.decision ?? "allow";
      // Record blocks to the velocity_blocks audit table for compliance review
      if (decision === "block") {
        try {
          const db = await getDb();
          if (!db) throw new Error("DB unavailable");
          await db.insert(velocityBlocks).values({
            accountId: input.account_id,
            tenantId: input.tenant_id,
            txRef: (input as any).tx_ref ?? null,
            amountKobo: input.amount_kobo,
            windowCount: body.window_count ?? 0,
            windowSeconds: body.window_seconds ?? 60,
            threshold: body.threshold ?? 10,
            decision: "block",
            reason: body.reason ?? "velocity threshold exceeded",
          });
        } catch (dbErr) {
          // Non-fatal: audit write failure must not block the payment rejection
          console.warn("[Fluvio] failed to record velocity block to DB:", dbErr);
        }
      }
      return {
        decision,
        reason: body.reason,
        service_available: true,
      };
    }

    // Non-2xx from velocity processor: log and fail-open
    const text = await res.text().catch(() => "");
    console.warn(
      `[Fluvio] velocity check returned HTTP ${res.status}: ${text.slice(0, 200)} — failing open`
    );
    return { decision: "allow", service_available: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // ECONNREFUSED / timeout = velocity sidecar not running (expected in dev/test)
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("AbortError") ||
      (err as Error)?.name === "AbortError"
    ) {
      console.debug("[Fluvio] velocity processor unavailable — failing open:", msg);
    } else {
      console.warn("[Fluvio] unexpected error in velocity check — failing open:", msg);
    }
    // Fail-open: do not block payments when the sidecar is down
    return { decision: "allow", service_available: false };
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

// ─── Insider Alert Stream ─────────────────────────────────────────────────────

export interface FluvioInsiderAlertEvent {
  /** Unique alert identifier (UUID or DB row id) */
  alertId: string;
  /** Subject user ID */
  subjectId: string;
  /** Tenant identifier */
  tenantId?: string;
  /** Alert category: peer_comparison, exfiltration, off_hours, privilege_escalation, etc. */
  category: string;
  /** Severity: info | low | medium | high | critical */
  severity: string;
  /** Anomaly score 0.0–1.0 */
  anomalyScore?: number;
  /** Risk tier: LOW | MEDIUM | HIGH | CRITICAL */
  riskTier?: string;
  /** Human-readable detail */
  detail: string;
  /** ISO-8601 UTC timestamp */
  triggeredAt: string;
}

/**
 * Publish an insider-threat alert event to the Fluvio bis.alerts stream.
 * Consumed by:
 *   - PWA dashboard (real-time alert feed via SSE)
 *   - Go gateway (push notification to mobile via FCM)
 *   - Temporal workflow engine (escalation trigger)
 */
export async function fluvioPublishInsiderAlert(
  opts: FluvioInsiderAlertEvent,
): Promise<FluvioPublishResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${FLUVIO_VELOCITY_URL}/publish/bis.alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "bis.alerts",
        partition: 0,
        payload: opts,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { accepted: false, service_available: true, reason: `HTTP ${res.status}` };
    }
    return { accepted: true, service_available: true };
  } catch (err) {
    return {
      accepted: false,
      service_available: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Fluvio UEBA score stream ──────────────────────────────────────────────────
// Publishes UEBA anomaly score updates to the bis.ueba topic so the PWA
// dashboard can show real-time risk-tier changes without polling.

export interface FluvioUebaScoreEvent {
  userId: string;
  tenantId?: string;
  deviationScore: number;       // 0–100
  riskTier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  baselineVersion: string;      // ISO timestamp of last retrain
  triggeredBy?: string;         // action that caused the score update
  publishedAt: string;          // ISO timestamp
}

export async function fluvioPublishUebaScore(
  opts: FluvioUebaScoreEvent,
): Promise<FluvioPublishResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${FLUVIO_VELOCITY_URL}/publish/bis.ueba`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "bis.ueba",
        partition: 0,
        payload: opts,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { accepted: false, service_available: true, reason: `HTTP ${res.status}` };
    }
    return { accepted: true, service_available: true };
  } catch (err) {
    return {
      accepted: false,
      service_available: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
