/**
 * BIS — Temporal Worker Process
 *
 * Registers and runs activities for two task queues:
 *   1. "bis-investigation" — InvestigationWorkflow activities
 *      (NIN check, BVN check, risk scoring, field task dispatch)
 *   2. "bis-payment"       — PaymentTransferWorkflow activities
 *      (rail submission, status polling, timeout escalation, compensation)
 *
 * Run with: `node -r tsx/cjs server/temporalWorker.ts`
 * Or via docker-compose service `bis-temporal-worker`.
 *
 * When TEMPORAL_HOST is not set the worker exits gracefully (dev mode).
 */
import { ENV } from "./_core/env";

const TEMPORAL_HOST = ENV.temporalHost;
const TEMPORAL_NAMESPACE = ENV.temporalNamespace ?? "default";
const TEMPORAL_TASK_QUEUE = "bis-investigation";
const PAYMENT_TASK_QUEUE = "bis-payment";

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

// ── Worker bootstrap ────────────────────────────────────────────────────────

/**
 * Start the Temporal worker.
 * Uses the Temporal HTTP API via the Go gateway when TEMPORAL_HOST is set.
 * In dev mode (no TEMPORAL_HOST) the worker exits immediately.
 */
async function startWorker(): Promise<void> {
  if (!TEMPORAL_HOST) {
    console.log("[TemporalWorker] TEMPORAL_HOST not set — worker running in dev/stub mode.");
    console.log("[TemporalWorker] Activities are available for direct import by the BFF.");
    return;
  }

  console.log(`[TemporalWorker] Starting worker on task queues '${TEMPORAL_TASK_QUEUE}', '${PAYMENT_TASK_QUEUE}' (namespace: ${TEMPORAL_NAMESPACE})`);
  console.log(`[TemporalWorker] Temporal host: ${TEMPORAL_HOST}`);

  const gatewayUrl = ENV.gatewayUrl;

  // ── Investigation task queue heartbeat + poll ──────────────────────────────────

  const heartbeat = async () => {
    try {
      await fetch(`${gatewayUrl}/v1/worker/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
        body: JSON.stringify({
          task_queue: TEMPORAL_TASK_QUEUE,
          namespace: TEMPORAL_NAMESPACE,
          activities: ["checkNin", "checkBvn", "scoreRisk", "dispatchFieldTask"],
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      console.warn("[TemporalWorker] Investigation heartbeat failed:", err);
    }
  };
  await heartbeat();
  const heartbeatInterval = setInterval(heartbeat, 30_000);

  const pollInterval = setInterval(async () => {
    try {
      const resp = await fetch(`${gatewayUrl}/v1/worker/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
        body: JSON.stringify({ task_queue: TEMPORAL_TASK_QUEUE, namespace: TEMPORAL_NAMESPACE }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) return;
      const tasks = (await resp.json()) as Array<{ task_id: string; activity: string; input: Record<string, unknown> }>;
      for (const task of tasks) {
        try {
          let result: unknown;
          switch (task.activity) {
            case "checkNin":       result = await checkNin(task.input as unknown as NinCheckInput); break;
            case "checkBvn":       result = await checkBvn(task.input as unknown as BvnCheckInput); break;
            case "scoreRisk":      result = await scoreRisk(task.input as unknown as RiskScoringInput); break;
            case "dispatchFieldTask": result = await dispatchFieldTask(task.input as unknown as FieldTaskDispatchInput); break;
            default: console.warn(`[TemporalWorker] Unknown investigation activity: ${task.activity}`); continue;
          }
          await fetch(`${gatewayUrl}/v1/worker/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
            body: JSON.stringify({ task_id: task.task_id, result }),
            signal: AbortSignal.timeout(5_000),
          });
        } catch (err) {
          console.error(`[TemporalWorker] Investigation activity ${task.activity} failed:`, err);
          await fetch(`${gatewayUrl}/v1/worker/fail`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
            body: JSON.stringify({ task_id: task.task_id, error: err instanceof Error ? err.message : String(err) }),
            signal: AbortSignal.timeout(5_000),
          }).catch(() => {});
        }
      }
    } catch { /* transient */ }
  }, 2_000);

  // ── Payment task queue heartbeat + poll ──────────────────────────────────────

  const paymentHeartbeat = async () => {
    try {
      await fetch(`${gatewayUrl}/v1/worker/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
        body: JSON.stringify({
          task_queue: PAYMENT_TASK_QUEUE,
          namespace: TEMPORAL_NAMESPACE,
          activities: ["submitToRail", "pollRailStatus", "escalateToReview", "compensateTransfer"],
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      console.warn("[TemporalWorker] Payment heartbeat failed:", err);
    }
  };
  await paymentHeartbeat();
  const paymentHeartbeatInterval = setInterval(paymentHeartbeat, 30_000);

  const paymentPollInterval = setInterval(async () => {
    try {
      const resp = await fetch(`${gatewayUrl}/v1/worker/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
        body: JSON.stringify({ task_queue: PAYMENT_TASK_QUEUE, namespace: TEMPORAL_NAMESPACE }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) return;
      const tasks = (await resp.json()) as Array<{ task_id: string; activity: string; input: Record<string, unknown> }>;
      for (const task of tasks) {
        try {
          let result: unknown;
          switch (task.activity) {
            case "submitToRail":       result = await submitToRail(task.input as unknown as SubmitToRailInput); break;
            case "pollRailStatus":     result = await pollRailStatus(task.input as unknown as PollRailStatusInput); break;
            case "escalateToReview":   await escalateToReview(task.input as unknown as EscalateToReviewInput); result = null; break;
            case "compensateTransfer": await compensateTransfer(task.input as unknown as CompensateTransferInput); result = null; break;
            default: console.warn(`[TemporalWorker] Unknown payment activity: ${task.activity}`); continue;
          }
          await fetch(`${gatewayUrl}/v1/worker/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
            body: JSON.stringify({ task_id: task.task_id, result }),
            signal: AbortSignal.timeout(5_000),
          });
        } catch (err) {
          console.error(`[TemporalWorker] Payment activity ${task.activity} failed:`, err);
          await fetch(`${gatewayUrl}/v1/worker/fail`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
            body: JSON.stringify({ task_id: task.task_id, error: err instanceof Error ? err.message : String(err) }),
            signal: AbortSignal.timeout(5_000),
          }).catch(() => {});
        }
      }
    } catch { /* transient */ }
  }, 2_000);

  // Graceful shutdown
  const shutdown = () => {
    console.log("[TemporalWorker] Shutting down...");
    clearInterval(heartbeatInterval);
    clearInterval(pollInterval);
    clearInterval(paymentHeartbeatInterval);
    clearInterval(paymentPollInterval);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log("[TemporalWorker] Worker running. Press Ctrl+C to stop.");
}

// Run if executed directly
startWorker().catch((err) => {
  console.error("[TemporalWorker] Fatal startup error:", err);
  process.exit(1);
});
