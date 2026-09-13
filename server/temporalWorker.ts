/**
 * BIS — Temporal activity helpers (Node.js)
 *
 * Plain HTTP activity helpers for the investigation and payment domains.
 * These are imported directly by the BFF and exercised by unit tests. They are
 * NOT a Temporal worker: real workflow execution is owned by the Go workers
 * (services/gateway, services/compliance-worker). See the note at the bottom
 * of this file and server/temporal.manifest.json (WP6 FIX B).
 */
import { ENV } from "./_core/env";

// ── Activity definitions ────────────────────────────────────────────────────

export interface NinCheckInput {
  ref: string;
  nin: string;
  gatewayUrl: string;
  gatewayKey: string;
}

export interface BvnCheckInput {
  ref: string;
  bvn: string;
  gatewayUrl: string;
  gatewayKey: string;
}

export interface RiskScoringInput {
  ref: string;
  subjectName: string;
  subjectType: string;
  ninResult?: Record<string, unknown>;
  bvnResult?: Record<string, unknown>;
  riskUrl: string;
}

export interface FieldTaskDispatchInput {
  ref: string;
  subjectName: string;
  tier: string;
  gatewayUrl: string;
  gatewayKey: string;
}

/** Activity: verify NIN via the BIS gateway */
export async function checkNin(input: NinCheckInput): Promise<Record<string, unknown>> {
  const resp = await fetch(`${input.gatewayUrl}/v1/nin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BIS-Key": input.gatewayKey,
    },
    body: JSON.stringify({ nin: input.nin, ref: input.ref }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`NIN check failed for ${input.ref}: ${resp.status} ${body}`);
  }
  return resp.json() as Promise<Record<string, unknown>>;
}

/** Activity: verify BVN via the BIS gateway */
export async function checkBvn(input: BvnCheckInput): Promise<Record<string, unknown>> {
  const resp = await fetch(`${input.gatewayUrl}/v1/bvn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BIS-Key": input.gatewayKey,
    },
    body: JSON.stringify({ bvn: input.bvn, ref: input.ref }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`BVN check failed for ${input.ref}: ${resp.status} ${body}`);
  }
  return resp.json() as Promise<Record<string, unknown>>;
}

/** Activity: run risk scoring via the risk engine */
export async function scoreRisk(input: RiskScoringInput): Promise<{ score: number; flags: string[] }> {
  const resp = await fetch(`${input.riskUrl}/v1/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: input.ref,
      subject_name: input.subjectName,
      subject_type: input.subjectType,
      nin_result: input.ninResult ?? {},
      bvn_result: input.bvnResult ?? {},
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Risk scoring failed for ${input.ref}: ${resp.status} ${body}`);
  }
  return resp.json() as Promise<{ score: number; flags: string[] }>;
}

/** Activity: dispatch a field task for comprehensive-tier investigations */
export async function dispatchFieldTask(input: FieldTaskDispatchInput): Promise<{ taskId: string }> {
  const resp = await fetch(`${input.gatewayUrl}/v1/field-task/dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BIS-Key": input.gatewayKey,
    },
    body: JSON.stringify({
      ref: input.ref,
      subject_name: input.subjectName,
      tier: input.tier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    // Field task dispatch is best-effort — log but don't fail the workflow
    console.warn(`[TemporalWorker] Field task dispatch failed for ${input.ref}: ${resp.status}`);
    return { taskId: `fallback-${Date.now()}` };
  }
  return resp.json() as Promise<{ taskId: string }>;
}

// ── Payment activity definitions ──────────────────────────────────────────

export interface SubmitToRailInput {
  txRef: string;
  transactionId: number;
  originatorAccountId: string;
  beneficiaryAccountId: string;
  beneficiaryName: string;
  amountKobo: number;
  currency: string;
  rail: string;
  narration?: string;
  gatewayUrl: string;
  gatewayKey: string;
}

export interface PollRailStatusInput {
  txRef: string;
  externalRef: string;
  rail: string;
  gatewayUrl: string;
  gatewayKey: string;
}

export interface EscalateToReviewInput {
  txRef: string;
  transactionId: number;
  reason: string;
  gatewayUrl: string;
  gatewayKey: string;
}

export interface CompensateTransferInput {
  txRef: string;
  transactionId: number;
  reason: string;
  gatewayUrl: string;
  gatewayKey: string;
}

/** Activity: submit a transfer to the payment rail (Mojaloop / NIP) */
export async function submitToRail(input: SubmitToRailInput): Promise<{ externalRef: string; status: string }> {
  const endpoint = input.rail === "mojaloop"
    ? `${input.gatewayUrl}/v1/mojaloop/transfer`
    : `${input.gatewayUrl}/v1/nip/transfer`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BIS-Key": input.gatewayKey,
      "X-Idempotency-Key": input.txRef,
    },
    body: JSON.stringify({
      tx_ref: input.txRef,
      originator_account: input.originatorAccountId,
      beneficiary_account: input.beneficiaryAccountId,
      beneficiary_name: input.beneficiaryName,
      amount_kobo: input.amountKobo,
      currency: input.currency,
      narration: input.narration ?? "",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Rail submission failed for ${input.txRef}: ${resp.status} ${body}`);
  }
  const result = await resp.json() as { external_ref: string; status: string };
  return { externalRef: result.external_ref, status: result.status };
}

/** Activity: poll the payment rail for the current transfer status */
export async function pollRailStatus(input: PollRailStatusInput): Promise<{ status: string; finalised: boolean }> {
  const endpoint = input.rail === "mojaloop"
    ? `${input.gatewayUrl}/v1/mojaloop/status/${input.externalRef}`
    : `${input.gatewayUrl}/v1/nip/status/${input.externalRef}`;
  const resp = await fetch(endpoint, {
    headers: { "X-BIS-Key": input.gatewayKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    return { status: "unknown", finalised: false };
  }
  const result = await resp.json() as { status: string };
  const finalised = ["completed", "failed", "reversed"].includes(result.status);
  return { status: result.status, finalised };
}

/** Activity: escalate a stalled transfer to under_review status */
export async function escalateToReview(input: EscalateToReviewInput): Promise<void> {
  const resp = await fetch(`${input.gatewayUrl}/v1/payment/escalate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BIS-Key": input.gatewayKey,
    },
    body: JSON.stringify({
      tx_ref: input.txRef,
      transaction_id: input.transactionId,
      reason: input.reason,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    // Escalation failure is non-fatal — log and continue
    const body = await resp.text();
    console.warn(`[TemporalWorker] Escalation failed for ${input.txRef}: ${resp.status} ${body}`);
  }
}

/** Activity: compensate a failed transfer (issue reversal, mark as reversed) */
export async function compensateTransfer(input: CompensateTransferInput): Promise<void> {
  const resp = await fetch(`${input.gatewayUrl}/v1/payment/compensate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BIS-Key": input.gatewayKey,
    },
    body: JSON.stringify({
      tx_ref: input.txRef,
      transaction_id: input.transactionId,
      reason: input.reason,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Compensation failed for ${input.txRef}: ${resp.status} ${body}`);
  }
}

// ── Worker execution model (WP6 FIX B) ─────────────────────────────────────
//
// The fake HTTP poll-loop worker that used to live here was REMOVED. It polled
// gateway endpoints (/v1/worker/poll, /v1/worker/heartbeat, /v1/worker/complete,
// /v1/worker/fail) that never existed in services/gateway, so it could never
// execute a single task — phantom code, not a worker.
//
// Real Temporal workflow execution is owned by the Go workers:
//   - services/gateway (temporal.StartWorker / StartScreeningWorker) serves
//     task queues 'bis-investigation' and 'bis-screening'
//   - services/compliance-worker serves task queue 'bis-compliance'
// See server/temporal.manifest.json for the full both-sides contract.
//
// The exported functions above are plain activity helpers used directly by the
// BFF and by unit tests. They are intentionally NOT registered with any
// Temporal worker from Node. If a Node-side worker is ever needed, build it on
// @temporalio/worker with real workflow bundles — never on an HTTP poll loop.
