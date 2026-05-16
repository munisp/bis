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
