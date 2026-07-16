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
  biometric:       "bis.biometric.events",
  aml:             "bis.aml.alerts",
  investigation:   "bis.investigation.events",
  kyc:             "bis.kyc.events",
  payment:         "bis.payment.events",
  // Extended domain topics
  case:            "bis.case.events",
  lex:             "bis.lex.events",
  fieldVisit:      "bis.field_visit.events",
  criminalRecords: "bis.criminal_records.events",
  corporateCheck:  "bis.corporate_check.events",
  mojaloop:        "bis.mojaloop.events",
  stablecoin:      "bis.stablecoin.events",
  billing:         "bis.billing.events",
  screening:       "bis.screening.events",
  insider:         "bis.insider.events",
  // Compliance & regulatory topics
  sar:             "bis.sar.events",
  goaml:           "bis.goaml.events",
  transaction:     "bis.transaction.events",
  riskProfile:     "bis.risk_profile.events",
  openappsec:      "bis.openappsec.events",
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

// ── Pub/Sub publisher ────────────────────────────────────────────────────────

export interface DaprPublishOptions {
  topic: Topic | string;
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
  eventType: "created" | "updated" | "escalated" | "closed" | "risk_scored" | "assigned";
  ref: string;
  subjectName?: string;
  riskScore?: number;
  status?: string;
  assignedTo?: string;
  tenantId?: number;
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
  eventType: "initiated" | "completed" | "failed" | "reversed" | "velocity_blocked";
  txRef: string;
  amountKobo: number;
  currency?: string;
  rail?: string;
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.payment,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishCaseEvent(data: {
  eventType: "created" | "updated" | "closed" | "escalated" | "assigned" | "comment_added" | "document_added";
  ref: string;
  caseId?: number;
  status?: string;
  priority?: string;
  assignedTo?: string;
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.case,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishLexEvent(data: {
  eventType: "submitted" | "reviewed" | "escalated" | "closed" | "agency_registered" | "agency_deactivated";
  submissionRef?: string;
  agencyCode?: string;
  status?: string;
  severity?: string;
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.lex,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishFieldVisitEvent(data: {
  eventType: "dispatched" | "checked_in" | "completed" | "escalated" | "cancelled";
  taskRef?: string;
  agentId?: number;
  subjectRef?: string;
  location?: { lat: number; lng: number };
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.fieldVisit,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishCriminalRecordEvent(data: {
  eventType: "request_submitted" | "record_ingested" | "warrant_detected" | "record_verified" | "request_rejected";
  requestRef?: string;
  recordId?: number;
  subjectRef?: string;
  agency?: string;
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.criminalRecords,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishCorporateCheckEvent(data: {
  eventType: "completed" | "sanctions_hit" | "firs_clearance_failed" | "started";
  rcNumber?: string;
  companyName?: string;
  sanctionsHit?: boolean;
  riskScore?: number;
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.corporateCheck,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishMojaloopEvent(data: {
  eventType: "compliance_blocked" | "compliance_cleared" | "transfer_initiated" | "transfer_completed";
  transferRef?: string;
  amount?: number;
  currency?: string;
  blockedReason?: string;
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.mojaloop,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishStablecoinEvent(data: {
  eventType: "transfer_initiated" | "transfer_completed" | "transfer_failed" | "rate_limited";
  txRef?: string;
  amount?: number;
  currency?: string;
  fromAddress?: string;
  toAddress?: string;
  network?: string;
  amountUnits?: string;
  status?: string;
  actorId?: number;
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.stablecoin,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishBillingEvent(data: {
  eventType: "topup_initiated" | "topup_completed" | "topup_failed" | "debit_recorded" | "balance_low";
  tenantId: number;
  amountKobo?: number;
  reference?: string;
  balanceKobo?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.billing,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishDaprScreeningEvent(data: {
  eventType: "order_created" | "result_updated" | "adverse_action_initiated" | "adverse_action_resolved" | "candidate_invited";
  orderRef?: string;
  candidateRef?: string;
  packageId?: number;
  status?: string;
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.screening,
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

/**
 * Get/set state via Dapr state store (Redis-backed).
 */
export async function daprStateGet<T = unknown>(key: string): Promise<T | null> {
  if (!DAPR_ENABLED) return null;
  try {
    const resp = await fetch(
      `${DAPR_BASE}/v1.0/state/bis-statestore/${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(3_000) }
    );
    if (resp.status === 204 || resp.status === 404) return null;
    if (!resp.ok) return null;
    return resp.json() as Promise<T>;
  } catch {
    return null;
  }
}

export async function daprStateSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  if (!DAPR_ENABLED) return;
  try {
    const entry: Record<string, unknown> = { key, value };
    if (ttlSeconds) entry.metadata = { ttlInSeconds: String(ttlSeconds) };
    await fetch(`${DAPR_BASE}/v1.0/state/bis-statestore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([entry]),
      signal: AbortSignal.timeout(3_000),
    });
  } catch (err) {
    console.error("[Dapr] stateSet error:", err);
  }
}

export async function daprStateDel(key: string): Promise<void> {
  if (!DAPR_ENABLED) return;
  try {
    await fetch(`${DAPR_BASE}/v1.0/state/bis-statestore/${encodeURIComponent(key)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(3_000),
    });
  } catch (err) {
    console.error("[Dapr] stateDel error:", err);
  }
}

/**
 * Health check: returns true if Dapr sidecar is reachable.
 */
export async function daprHealthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  if (!DAPR_ENABLED) return { ok: false, latencyMs: 0 };
  try {
    const resp = await fetch(`${DAPR_BASE}/v1.0/healthz`, { signal: AbortSignal.timeout(3_000) });
    return { ok: resp.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

export async function publishInsiderThreatEvent(data: {
  eventType: "anomaly_detected" | "alert_raised" | "ueba_score_updated" | "access_review_triggered" | "session_flagged";
  userId?: number;
  subjectId?: string;
  userEmail?: string;
  category?: string;
  severity?: string;
  anomalyScore?: number;
  driftScore?: number;
  sourceIp?: string;
  resourcePath?: string;
  deviationScore?: number;
  riskTier?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  triggeredBy?: string;
  eventId?: number;
  ruleId?: string;
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.insider,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export function isDaprEnabled(): boolean {
  return DAPR_ENABLED;
}

// ─── Extended compliance & regulatory publishers ──────────────────────────────

export async function publishSarEvent(data: {
  eventType: "created" | "submitted" | "reviewed" | "approved" | "filed" | "rejected" | "withdrawn";
  sarRef: string;
  sarId: number;
  status: string;
  category?: string;
  subjectName?: string;
  suspiciousAmount?: number;
  filedWith?: string;
  tenantId?: number;
  createdBy?: number;
  actorId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.sar,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishGoamlEvent(data: {
  eventType: "created" | "submitted" | "acknowledged" | "rejected" | "cancelled";
  filingRef: string;
  filingId: number;
  status: string;
  reportType?: string;
  subjectName?: string;
  tenantId?: number;
  createdBy?: number;
  actorId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.goaml,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishTransactionEvent(data: {
  eventType: "created" | "flagged" | "cleared" | "blocked" | "reversed" | "completed";
  txRef: string;
  transactionId?: number;
  amount?: number;
  currency?: string;
  riskScore?: number;
  amlFlagged?: boolean;
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.transaction,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishRiskProfileEvent(data: {
  eventType: "created" | "updated" | "escalated" | "cleared" | "expired";
  subjectRef: string;
  subjectType: "individual" | "corporate" | "account";
  riskScore?: number;
  riskTier?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  tenantId?: number;
  triggeredBy?: string;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.riskProfile,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

export async function publishOpenAppsecEvent(data: {
  eventType: "blocked" | "detected" | "bypassed";
  attackType?: string;
  severity?: "low" | "medium" | "high" | "critical";
  sourceIp?: string;
  requestUri?: string;
  method?: string;
  userAgent?: string;
  tenantId?: number;
  timestamp?: string;
}): Promise<void> {
  return daprPublish({
    topic: TOPICS.openappsec,
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  });
}

// Alias exports for backward compatibility with insiderThreat.ts imports
export const publishUebaAlert = publishInsiderThreatEvent;
export const publishAccessReviewEvent = publishInsiderThreatEvent;

