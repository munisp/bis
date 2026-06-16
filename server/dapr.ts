/**
 * BIS — Dapr Integration Client
 *
 * Provides:
 *   1. Pub/Sub publisher — publishes biometric, AML, and investigation events
 *      to the Dapr sidecar (default: http://localhost:3500)
 *   2. Service invocation — calls biometric engine, risk engine, and AML engine
 *      via Dapr service-to-service invocation (bypasses direct HTTP)
 *
 * When DAPR_HTTP_PORT is not set the client falls back to direct HTTP calls.
 */
import { ENV } from "./_core/env";

// ── Config ───────────────────────────────────────────────────────────────────

const DAPR_PORT = process.env.DAPR_HTTP_PORT ?? "3500";
const DAPR_BASE = `http://localhost:${DAPR_PORT}`;
const PUBSUB_NAME = process.env.DAPR_PUBSUB_NAME ?? "bis-pubsub";
const DAPR_ENABLED = Boolean(process.env.DAPR_HTTP_PORT);

// ── Topic names ──────────────────────────────────────────────────────────────

export const TOPICS = {
  biometric: "bis.biometric.events",
  aml: "bis.aml.alerts",
  investigation: "bis.investigation.events",
  kyc: "bis.kyc.events",
  payment: "bis.payment.events",
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

// ── Pub/Sub publisher ────────────────────────────────────────────────────────

export interface DaprPublishOptions {
  topic: Topic;
  data: Record<string, unknown>;
  /** Optional metadata to attach to the CloudEvent */
  metadata?: Record<string, string>;
}

/**
 * Publish an event to the Dapr pub/sub broker.
 * Falls back silently when Dapr is not configured.
 */
export async function daprPublish(opts: DaprPublishOptions): Promise<void> {
  if (!DAPR_ENABLED) {
    // Dev mode: log the event instead of publishing
    console.debug(`[Dapr] (dev) publish → ${opts.topic}:`, JSON.stringify(opts.data).slice(0, 120));
    return;
  }

  try {
    const resp = await fetch(
      `${DAPR_BASE}/v1.0/publish/${encodeURIComponent(PUBSUB_NAME)}/${encodeURIComponent(opts.topic)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(opts.metadata
            ? Object.fromEntries(
                Object.entries(opts.metadata).map(([k, v]) => [`metadata.${k}`, v])
              )
            : {}),
        },
        body: JSON.stringify(opts.data),
        signal: AbortSignal.timeout(5_000),
      }
    );

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[Dapr] publish to ${opts.topic} failed: ${resp.status} ${body}`);
    }
  } catch (err) {
    console.error(`[Dapr] publish error (topic: ${opts.topic}):`, err);
  }
}

// ── Convenience publishers ───────────────────────────────────────────────────

export async function publishBiometricEvent(data: {
  eventType: "enrolled" | "verified" | "spoof_detected" | "enrollment_failed";
  subjectRef: string;
  kycRecordId?: number;
  score?: number;
  spoofType?: string;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.biometric,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishAmlAlert(data: {
  alertId: number;
  alertType: string;
  riskScore: number;
  subjectRef?: string;
  transactionRef?: string;
  autoEscalated?: boolean;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.aml,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishInvestigationEvent(data: {
  eventType: "created" | "updated" | "escalated" | "closed" | "risk_scored";
  ref: string;
  subjectName?: string;
  riskScore?: number;
  status?: string;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.investigation,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishKycEvent(data: {
  eventType: "started" | "completed" | "failed" | "expired";
  kycRecordId?: number;
  subjectRef: string;
  status?: string;
  riskScore?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.kyc,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishPaymentEvent(data: {
  eventType: "initiated" | "completed" | "failed" | "reversed";
  txRef: string;
  amountKobo: number;
  currency?: string;
  rail?: string;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.payment,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

// ── Service invocation ───────────────────────────────────────────────────────

export interface DaprInvokeOptions {
  /** Dapr app-id of the target service */
  appId: string;
  /** HTTP method path on the target service */
  method: string;
  /** HTTP verb (default: POST) */
  verb?: "GET" | "POST" | "PUT" | "DELETE";
  /** Request body (for POST/PUT) */
  data?: Record<string, unknown>;
}

/**
 * Invoke a method on another service via Dapr service-to-service invocation.
 * Falls back to direct HTTP when Dapr is not configured.
 */
export async function daprInvoke<T = unknown>(opts: DaprInvokeOptions): Promise<T> {
  if (!DAPR_ENABLED) {
    throw new Error(
      `[Dapr] Service invocation unavailable in dev mode (DAPR_HTTP_PORT not set). ` +
        `Direct HTTP should be used instead for ${opts.appId}/${opts.method}.`
    );
  }

  const verb = opts.verb ?? "POST";
  const url = `${DAPR_BASE}/v1.0/invoke/${encodeURIComponent(opts.appId)}/method/${opts.method}`;

  const resp = await fetch(url, {
    method: verb,
    headers: { "Content-Type": "application/json" },
    body: opts.data ? JSON.stringify(opts.data) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`[Dapr] invoke ${opts.appId}/${opts.method} failed: ${resp.status} ${body}`);
  }

  return resp.json() as Promise<T>;
}

// ── Dapr component manifests (for reference) ─────────────────────────────────
// These are written to infra/dapr/ by the infrastructure provisioning scripts.
// The actual YAML files are at:
//   infra/dapr/components/pubsub.yaml      — Redis Streams or Kafka pub/sub
//   infra/dapr/components/statestore.yaml  — Redis state store
//   infra/dapr/components/bindings.yaml    — Kafka output binding
//
// Dapr sidecar is injected via docker-compose.yml:
//   bis-bff service: DAPR_HTTP_PORT=3500, dapr sidecar container

export function isDaprEnabled(): boolean {
  return DAPR_ENABLED;
}
