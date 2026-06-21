/**
 * BIS — Temporal workflow client (Node.js)
 *
 * Triggers investigation workflows on the Temporal server.
 * Falls back to direct service calls when TEMPORAL_HOST is not set.
 */
import { ENV } from "./_core/env";

export interface InvestigationWorkflowInput {
  ref: string;
  subjectName: string;
  subjectType: string;
  nin?: string;
  bvn?: string;
  rcNumber?: string;
  tier: string;
  gatewayUrl: string;
  riskUrl: string;
}

export interface WorkflowStartResult {
  workflowId: string;
  runId?: string;
  mode: "temporal" | "direct";
}

const TEMPORAL_HOST = ENV.temporalHost;
const TEMPORAL_NAMESPACE = ENV.temporalNamespace ?? "default";
const TEMPORAL_TASK_QUEUE = "bis-investigation";

/**
 * Start an investigation workflow.
 * Uses Temporal when TEMPORAL_HOST is configured, otherwise returns a mock run ID.
 */
export async function startInvestigationWorkflow(
  input: InvestigationWorkflowInput
): Promise<WorkflowStartResult> {
  if (!TEMPORAL_HOST) {
    // Dev mode: return a deterministic mock workflow ID
    console.log(`[Temporal] Dev mode — workflow ${input.ref} would run on Temporal`);
    return {
      workflowId: `investigation-${input.ref}`,
      runId: `dev-run-${Date.now()}`,
      mode: "direct",
    };
  }

  // Production: call the Temporal HTTP API (Temporal Cloud / self-hosted)
  // The @temporalio/client package requires a gRPC connection; for HTTP we use
  // the Temporal HTTP API or the Go gateway's /v1/workflow/start endpoint.
  const gatewayUrl = ENV.gatewayUrl;
  const resp = await fetch(`${gatewayUrl}/v1/workflow/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BIS-Key": ENV.bisGatewayKey,
    },
    body: JSON.stringify({
      workflow_type: "InvestigationWorkflow",
      task_queue: TEMPORAL_TASK_QUEUE,
      workflow_id: `investigation-${input.ref}`,
      input,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Temporal workflow start failed: ${resp.status} ${body}`);
  }

  const result = (await resp.json()) as { workflow_id: string; run_id: string };
  return {
    workflowId: result.workflow_id,
    runId: result.run_id,
    mode: "temporal",
  };
}

/**
 * Query the status of a running investigation workflow.
 */
export async function getWorkflowStatus(workflowId: string): Promise<{
  status: string;
  result?: unknown;
}> {
  if (!TEMPORAL_HOST) {
    return { status: "completed", result: null };
  }

  const gatewayUrl = ENV.gatewayUrl;
  const resp = await fetch(`${gatewayUrl}/v1/workflow/status/${workflowId}`, {
    headers: { "X-BIS-Key": ENV.bisGatewayKey },
  });

  if (!resp.ok) {
    return { status: "unknown" };
  }

  return resp.json() as Promise<{ status: string; result?: unknown }>;
}

// ─── Payment Transfer Workflow ─────────────────────────────────────────────

const PAYMENT_TASK_QUEUE = "bis-payment";

export interface PaymentTransferWorkflowInput {
  /** The internal transaction reference (txRef) */
  txRef: string;
  /** The internal DB transaction ID */
  transactionId: number;
  /** Originator account ID */
  originatorAccountId: string;
  /** Beneficiary account ID */
  beneficiaryAccountId: string;
  /** Beneficiary name */
  beneficiaryName: string;
  /** Amount in kobo */
  amountKobo: number;
  /** ISO-4217 currency code */
  currency: string;
  /** Payment rail: mojaloop | nip */
  rail: string;
  /** Narration / payment description */
  narration?: string;
}

export interface PaymentTransferWorkflowResult {
  workflowId: string;
  runId?: string;
  mode: "temporal" | "direct";
}

/**
 * Start a PaymentTransferWorkflow saga on Temporal.
 *
 * The workflow handles:
 *   1. Rail submission (Mojaloop / NIP) with exponential-backoff retry
 *   2. Status polling every 30 s for up to 5 minutes
 *   3. Timeout escalation: if still pending after 5 min, sets status → under_review
 *   4. Compensation: if the rail returns a hard failure after the DB row is written,
 *      the workflow issues a reversal and marks the transaction as reversed
 *
 * Falls back to a deterministic dev-mode ID when TEMPORAL_HOST is not set.
 */
export async function startPaymentTransferWorkflow(
  input: PaymentTransferWorkflowInput
): Promise<PaymentTransferWorkflowResult> {
  if (!TEMPORAL_HOST) {
    // Dev mode: log and return a deterministic ID — no actual workflow runs
    console.log(
      `[Temporal] Dev mode — PaymentTransferWorkflow ${input.txRef} would run on Temporal`
    );
    return {
      workflowId: `payment-${input.txRef}`,
      runId: `dev-run-${Date.now()}`,
      mode: "direct",
    };
  }

  const gatewayUrl = ENV.gatewayUrl;

  const resp = await fetch(`${gatewayUrl}/v1/workflow/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BIS-Key": ENV.bisGatewayKey,
    },
    body: JSON.stringify({
      workflow_type: "PaymentTransferWorkflow",
      task_queue: PAYMENT_TASK_QUEUE,
      // Use txRef as the workflow ID so duplicate submissions are idempotent
      workflow_id: `payment-${input.txRef}`,
      // Temporal workflow execution timeout: 10 minutes
      // After this, Temporal cancels the workflow and the worker issues a reversal
      execution_timeout_seconds: 600,
      input,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `[Temporal] PaymentTransferWorkflow start failed: ${resp.status} ${body}`
    );
  }

  const result = (await resp.json()) as { workflow_id: string; run_id: string };
  return {
    workflowId: result.workflow_id,
    runId: result.run_id,
    mode: "temporal",
  };
}

/**
 * Signal a running PaymentTransferWorkflow to cancel and compensate.
 * Called when the operator manually reverses a pending transfer.
 */
export async function cancelPaymentTransferWorkflow(txRef: string): Promise<void> {
  if (!TEMPORAL_HOST) {
    console.log(`[Temporal] Dev mode — cancel signal for payment-${txRef} skipped`);
    return;
  }

  const gatewayUrl = ENV.gatewayUrl;
  const workflowId = `payment-${txRef}`;

  const resp = await fetch(`${gatewayUrl}/v1/workflow/cancel/${workflowId}`, {
    method: "POST",
    headers: { "X-BIS-Key": ENV.bisGatewayKey },
    signal: AbortSignal.timeout(5_000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    // Non-fatal: workflow may have already completed
    console.warn(
      `[Temporal] cancel signal for ${workflowId} failed (non-fatal): ${resp.status} ${body}`
    );
  }
}

/**
 * Query the status of a running PaymentTransferWorkflow.
 */
export async function getPaymentWorkflowStatus(txRef: string): Promise<{
  status: string;
  result?: unknown;
}> {
  if (!TEMPORAL_HOST) {
    return { status: "completed", result: null };
  }

  const gatewayUrl = ENV.gatewayUrl;
  const workflowId = `payment-${txRef}`;

  const resp = await fetch(`${gatewayUrl}/v1/workflow/status/${workflowId}`, {
    headers: { "X-BIS-Key": ENV.bisGatewayKey },
    signal: AbortSignal.timeout(5_000),
  });

  if (!resp.ok) {
    return { status: "unknown" };
  }

  return resp.json() as Promise<{ status: string; result?: unknown }>;
}
