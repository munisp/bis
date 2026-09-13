/**
 * BIS — Temporal workflow client (Node.js)
 *
 * Triggers durable workflows on the Temporal server.
 * Workflows fail closed when Temporal is unavailable rather than reporting a mock run.
 */
import { ENV } from "./_core/env";

/**
 * Typed fail-closed error (WP6 FIX B): thrown when the TS client is asked to
 * start a workflow type that has NO registered worker handler anywhere in the
 * fleet. Starting such a workflow would enqueue a phantom execution that can
 * never make progress, so the call is rejected instead.
 */
export class TemporalWorkflowUnavailableError extends Error {
  readonly code = "TEMPORAL_WORKFLOW_UNAVAILABLE" as const;
  readonly workflowType: string;
  readonly taskQueue: string;
  constructor(workflowType: string, taskQueue: string) {
    super(
      `TEMPORAL_WORKFLOW_UNAVAILABLE: workflow '${workflowType}' has no registered worker ` +
        `on task queue '${taskQueue}' (see server/temporal.manifest.json); the workflow was NOT started.`,
    );
    this.name = "TemporalWorkflowUnavailableError";
    this.workflowType = workflowType;
    this.taskQueue = taskQueue;
  }
}

export function isTemporalWorkflowUnavailable(error: unknown): error is TemporalWorkflowUnavailableError {
  return error instanceof TemporalWorkflowUnavailableError;
}

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
const TEMPORAL_NAMESPACE = ENV.temporalNamespace ?? "bis";
const TEMPORAL_TASK_QUEUE = "bis-investigation";

/**
 * Start an investigation workflow.
 * Requires Temporal to be configured before reporting a workflow start.
 */
export async function startInvestigationWorkflow(
  input: InvestigationWorkflowInput
): Promise<WorkflowStartResult> {
  if (!TEMPORAL_HOST) {
    throw new Error("Temporal is not configured; investigation workflow was not started.");
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
      workflowType: "InvestigationWorkflow",
      taskQueue: TEMPORAL_TASK_QUEUE,
      workflowId: `investigation-${input.ref}`,
      // Worker source of truth: services/gateway/temporal/workflow.go
      // InvestigationInput uses snake_case JSON tags — map at the boundary.
      input: {
        ref: input.ref,
        subject_name: input.subjectName,
        subject_type: input.subjectType,
        nin: input.nin,
        bvn: input.bvn,
        rc_number: input.rcNumber,
        tier: input.tier,
        gateway_url: input.gatewayUrl,
        risk_url: input.riskUrl,
      },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Temporal workflow start failed: ${resp.status} ${body}`);
  }

  const result = (await resp.json()) as { workflowId: string; runId?: string };
  return {
    workflowId: result.workflowId,
    runId: result.runId,
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
    throw new Error("Temporal is not configured; investigation workflow status is unavailable.");
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
  /** Provider-authorized beneficiary bank code */
  beneficiaryBankCode: string;
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
 * Requires Temporal to be configured before reporting a payment workflow start.
 */
export async function startPaymentTransferWorkflow(
  _input: PaymentTransferWorkflowInput
): Promise<PaymentTransferWorkflowResult> {
  // WP6 FIX B — fail closed. No worker in the fleet registers a handler for
  // PaymentTransferWorkflow on task queue 'bis-payment' (verified against
  // server/temporal.manifest.json; server/temporalWorker.ts only defined
  // activity functions plus a fake HTTP poll loop against gateway endpoints
  // that never existed — removed in this changeset). Starting this workflow
  // would create a phantom execution that never progresses while the payment
  // intent appears dispatched, so the start is rejected with a typed error.
  // paymentIntentOutbox treats this as a dispatch failure: the intent is
  // retried with backoff and finally dead-lettered for reconciliation — no
  // money moves on a phantom workflow. Restore this starter only together
  // with a real registered worker for 'bis-payment'.
  throw new TemporalWorkflowUnavailableError("PaymentTransferWorkflow", PAYMENT_TASK_QUEUE);
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
    throw new Error("Temporal is not configured; payment workflow status is unavailable.");
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

// ═══════════════════════════════════════════════════════════════════════════════
// ADDITIONAL WORKFLOW TYPES — Added during integration audit (2026-07)
// ═══════════════════════════════════════════════════════════════════════════════

// ── AML Workflow ──────────────────────────────────────────────────────────────
export interface AmlWorkflowInput {
  investigationRef: string;
  subjectName: string;
  subjectType: "individual" | "corporate";
  nin?: string;
  bvn?: string;
  riskScore?: number;
  triggerReason: string;
  tenantId?: number;
  alertRef?: string;
  alertId?: number;
  transactionRef?: string;
  subjectRef?: string;
}

export interface AmlWorkflowResult {
  workflowId: string;
  runId?: string;
  status: "started" | "dev_mode";
}

export async function startAmlWorkflow(_input: AmlWorkflowInput): Promise<AmlWorkflowResult> {
  // WP6 FIX B — fail closed. No worker registers 'AMLWorkflow' on task queue
  // 'bis-aml' anywhere in the fleet (see server/temporal.manifest.json).
  // Previously this enqueued a phantom workflow execution that could never
  // progress. Callers (server/aml.ts, server/temporalRouter.ts) already
  // handle a rejected start. Restore only with a real registered worker.
  throw new TemporalWorkflowUnavailableError("AMLWorkflow", "bis-aml");
}

// ── KYC Expiry Workflow ───────────────────────────────────────────────────────
export interface KycExpiryWorkflowInput {
  kycRecordId: number;
  subjectRef: string;
  expiresAt: string;  // ISO date string
  tenantId?: number;
}

export async function startKycExpiryWorkflow(input: KycExpiryWorkflowInput): Promise<{ workflowId: string; status: string }> {
  const workflowId = `kyc-expiry-${input.kycRecordId}-${Date.now()}`;
  if (!TEMPORAL_HOST) {
    console.info("[Temporal] KYC expiry workflow (dev mode):", workflowId);
    return { workflowId, status: "dev_mode" };
  }
  // WP6 FIX B — aligned to the registered worker (source of truth):
  // services/compliance-worker registers 'KycExpiryWorkflow' on task queue
  // 'bis-compliance' with input KycExpiryInput{tenantId, gatewayUrl}. The
  // previous client sent 'KYCExpiryWorkflow' on 'bis-kyc' with a per-record
  // payload that no worker accepts; the registered workflow is a tenant-wide
  // sweep that locates the expiring records itself.
  const resp = await fetch(`${ENV.gatewayUrl}/v1/workflow/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
    body: JSON.stringify({
      workflowType: "KycExpiryWorkflow",
      workflowId,
      taskQueue: "bis-compliance",
      input: {
        tenantId: input.tenantId ?? 0,
        gatewayUrl: ENV.bisGatewayUrl,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[Temporal] KYC expiry workflow start failed: ${resp.status} ${text}`);
  }
  return { workflowId, status: "started" };
}

// ── Case Escalation Workflow ──────────────────────────────────────────────────
export interface CaseEscalationWorkflowInput {
  caseRef: string;
  caseId: number;
  priority: string;
  escalationReason: string;
  escalatedBy: number;
  tenantId?: number;
}

export async function startCaseEscalationWorkflow(
  _input: CaseEscalationWorkflowInput,
): Promise<{ workflowId: string; status: string }> {
  // WP6 FIX B — fail closed. No worker registers 'CaseEscalationWorkflow' on
  // task queue 'bis-cases' (see server/temporal.manifest.json). The tRPC
  // caller receives a typed TEMPORAL_WORKFLOW_UNAVAILABLE error instead of a
  // phantom workflow ID. Restore only with a real registered worker.
  throw new TemporalWorkflowUnavailableError("CaseEscalationWorkflow", "bis-cases");
}

// ── Screening Workflow ────────────────────────────────────────────────────────
export interface ScreeningWorkflowInput {
  orderId: number;
  candidateProfileId: number;
  packageId: number;
  tenantId?: number;
  /** Worker-required subject attributes (ScreeningOrderInput.full_name). */
  fullName?: string;
  nin?: string;
  bvn?: string;
}

export async function startScreeningWorkflow(input: ScreeningWorkflowInput): Promise<{ workflowId: string; status: string }> {
  const workflowId = `screening-${input.orderId}-${Date.now()}`;
  if (!TEMPORAL_HOST) {
    console.info("[Temporal] Screening workflow (dev mode):", workflowId);
    return { workflowId, status: "dev_mode" };
  }
  // WP6 FIX B — aligned to the registered worker (source of truth):
  // services/gateway/temporal/screening/workflow.go registers
  // 'ScreeningWorkflow' on 'bis-screening' taking ScreeningOrderInput with
  // snake_case JSON fields. The worker applies its own env defaults for
  // engine_url/scorer_url/bff_url when they are empty.
  const resp = await fetch(`${ENV.gatewayUrl}/v1/workflow/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
    body: JSON.stringify({
      workflowType: "ScreeningWorkflow",
      workflowId,
      taskQueue: "bis-screening",
      input: {
        order_ref: `ORD-${input.orderId}`,
        candidate_ref: `CAND-${input.candidateProfileId}`,
        package_id: input.packageId,
        tenant_id: String(input.tenantId ?? ""),
        screening_types: ["identity", "sanctions", "pep", "adverse_media"],
        full_name: input.fullName ?? "",
        nin: input.nin,
        bvn: input.bvn,
        engine_url: process.env.SCREENING_ENGINE_URL ?? "",
        scorer_url: process.env.SCREENING_SCORER_URL ?? "",
        bff_url: process.env.BFF_URL ?? "",
        priority: "standard",
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[Temporal] Screening workflow start failed: ${resp.status} ${text}`);
  }
  return { workflowId, status: "started" };
}

// ── SAR Filing Workflow ───────────────────────────────────────────────────────
export interface SarFilingWorkflowInput {
  sarId: number;
  tenantId?: number;
  subjectRef: string;
  subjectName: string;
  sarType: string;
  filingOfficer: number;
}
export async function startSarFilingWorkflow(input: SarFilingWorkflowInput): Promise<{ workflowId: string; status: string }> {
  const workflowId = `sar-filing-${input.sarId}-${Date.now()}`;
  if (!TEMPORAL_HOST) {
    console.info("[Temporal] SAR filing workflow (dev mode):", workflowId);
    return { workflowId, status: "dev_mode" };
  }
  const resp = await fetch(`${ENV.gatewayUrl}/v1/workflow/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
    body: JSON.stringify({
      workflowType: "SarFilingWorkflow",
      workflowId,
      taskQueue: "bis-compliance",
      input: {
        ...input,
        gatewayUrl: ENV.bisGatewayUrl,
        complianceUrl: ENV.complianceReporterUrl,
        lakehouseUrl: ENV.lakehouseUrl,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[Temporal] SAR filing workflow start failed: ${resp.status} ${text}`);
  }
  return { workflowId, status: "started" };
}

// ── goAML Filing Workflow ─────────────────────────────────────────────────────
export interface GoAmlFilingWorkflowInput {
  filingId: number;
  tenantId?: number;
  filingType: string;
  subjectRef: string;
}
export async function startGoAmlFilingWorkflow(input: GoAmlFilingWorkflowInput): Promise<{ workflowId: string; status: string }> {
  const workflowId = `goaml-filing-${input.filingId}-${Date.now()}`;
  if (!TEMPORAL_HOST) {
    console.info("[Temporal] goAML filing workflow (dev mode):", workflowId);
    return { workflowId, status: "dev_mode" };
  }
  const resp = await fetch(`${ENV.gatewayUrl}/v1/workflow/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
    body: JSON.stringify({
      workflowType: "GoAmlFilingWorkflow",
      workflowId,
      taskQueue: "bis-compliance",
      input: {
        ...input,
        gatewayUrl: ENV.bisGatewayUrl,
        complianceUrl: ENV.complianceReporterUrl,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[Temporal] goAML filing workflow start failed: ${resp.status} ${text}`);
  }
  return { workflowId, status: "started" };
}

// ── Risk Profile Workflow ─────────────────────────────────────────────────────
export interface RiskProfileWorkflowInput {
  subjectRef: string;
  subjectName?: string;
  tenantId?: number;
  trigger: string;
}
export async function startRiskProfileWorkflow(input: RiskProfileWorkflowInput): Promise<{ workflowId: string; status: string }> {
  const workflowId = `risk-profile-${input.subjectRef}-${Date.now()}`;
  if (!TEMPORAL_HOST) {
    console.info("[Temporal] Risk profile workflow (dev mode):", workflowId);
    return { workflowId, status: "dev_mode" };
  }
  const resp = await fetch(`${ENV.gatewayUrl}/v1/workflow/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BIS-Key": ENV.bisGatewayKey },
    body: JSON.stringify({
      workflowType: "RiskProfileWorkflow",
      workflowId,
      taskQueue: "bis-compliance",
      input: {
        ...input,
        gatewayUrl: ENV.bisGatewayUrl,
        mlServiceUrl: ENV.riskEngineUrl,
        lakehouseUrl: ENV.lakehouseUrl,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[Temporal] Risk profile workflow start failed: ${resp.status} ${text}`);
  }
  return { workflowId, status: "started" };
}

export interface AccessReviewWorkflowInput {
  reviewId: number;
  reviewRef: string;
  userId: number;
  reviewType: string;
  tenantId?: number;
  subjectId?: string;
  subjectRef?: string;
  triggeredBy?: string;
  dueAt?: Date;
}
export async function startAccessReviewWorkflow(
  _input: AccessReviewWorkflowInput,
): Promise<{ workflowId: string; status: "started" | "dev_mode" }> {
  // WP6 FIX B — fail closed. No worker registers 'AccessReviewWorkflow'
  // anywhere; the previous implementation also sent it to a task queue
  // literally named "COMPLIANCE_TASK_QUEUE" through a fake client proxy
  // (getTemporalClientSafe — removed). Callers (server/insiderThreat.ts)
  // already handle a rejected start via .catch(...). Restore only with a
  // real registered worker and a real task queue.
  throw new TemporalWorkflowUnavailableError("AccessReviewWorkflow", "bis-compliance");
}
