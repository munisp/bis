/**
 * BIS — Temporal workflow tRPC router
 *
 * Exposes Temporal workflow operations as tRPC procedures.
 * Falls back gracefully when TEMPORAL_HOST is not configured.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import {
  startInvestigationWorkflow,
  getWorkflowStatus,
  type InvestigationWorkflowInput,
} from "./temporal";

const TEMPORAL_HOST = ENV.temporalHost ?? "";
const GATEWAY_URL = ENV.gatewayUrl;
const BIS_GATEWAY_KEY = ENV.bisGatewayKey;

/** Generic call to the Go gateway's workflow endpoints */
async function gatewayCall(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const resp = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-BIS-Key": BIS_GATEWAY_KEY,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Gateway error: ${text}` });
  }
  if (resp.status === 204) return null;
  return resp.json();
}

export const temporalRouter = router({
  /** Check if Temporal is configured */
  status: protectedProcedure.query(() => ({
    configured: !!TEMPORAL_HOST,
    host: TEMPORAL_HOST || null,
    namespace: ENV.temporalNamespace ?? "default",
    taskQueue: "bis-investigation",
  })),

  /** Start an investigation workflow */
  startInvestigation: protectedProcedure
    .input(
      z.object({
        ref: z.string(),
        subjectName: z.string(),
        subjectType: z.enum(["individual", "company"]),
        nin: z.string().optional(),
        bvn: z.string().optional(),
        rcNumber: z.string().optional(),
        tier: z.string().default("standard"),
      })
    )
    .mutation(async ({ input }) => {
      const workflowInput: InvestigationWorkflowInput = {
        ...input,
        gatewayUrl: GATEWAY_URL,
        riskUrl: ENV.riskEngineUrl,
      };
      const result = await startInvestigationWorkflow(workflowInput);
      return result;
    }),

  /** Get the status of a workflow */
  getStatus: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ input }) => {
      return getWorkflowStatus(input.workflowId);
    }),

  /** List running/recent workflows (via gateway) */
  listWorkflows: adminProcedure
    .input(
      z.object({
        status: z.enum(["RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TERMINATED"]).optional(),
        pageSize: z.number().int().min(1).max(100).default(20),
        nextPageToken: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      if (!TEMPORAL_HOST) {
        return {
          workflows: [],
          nextPageToken: null,
          configured: false,
          message: "Temporal not configured — running in dev mode",
        };
      }
      try {
        const params = new URLSearchParams({
          page_size: String(input.pageSize),
          ...(input.status ? { status: input.status } : {}),
          ...(input.nextPageToken ? { next_page_token: input.nextPageToken } : {}),
        });
        const data = (await gatewayCall(`/v1/workflows?${params}`)) as {
          executions: Array<{
            workflow_id: string;
            run_id: string;
            status: string;
            start_time: string;
            close_time?: string;
            workflow_type: string;
          }>;
          next_page_token?: string;
        };
        return {
          workflows: data.executions ?? [],
          nextPageToken: data.next_page_token ?? null,
          configured: true,
        };
      } catch {
        return { workflows: [], nextPageToken: null, configured: true, error: "Failed to list workflows" };
      }
    }),

  /** Terminate a workflow */
  terminateWorkflow: adminProcedure
    .input(z.object({ workflowId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      if (!TEMPORAL_HOST) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Temporal not configured" });
      await gatewayCall(`/v1/workflows/${encodeURIComponent(input.workflowId)}/terminate`, "POST", {
        reason: input.reason ?? "Terminated by admin",
      });
      return { success: true };
    }),

  /** Cancel a workflow */
  cancelWorkflow: adminProcedure
    .input(z.object({ workflowId: z.string() }))
    .mutation(async ({ input }) => {
      if (!TEMPORAL_HOST) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Temporal not configured" });
      await gatewayCall(`/v1/workflows/${encodeURIComponent(input.workflowId)}/cancel`, "POST");
      return { success: true };
    }),

  /** Signal a workflow */
  signalWorkflow: adminProcedure
    .input(
      z.object({
        workflowId: z.string(),
        signalName: z.string(),
        payload: z.unknown().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (!TEMPORAL_HOST) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Temporal not configured" });
      await gatewayCall(`/v1/workflows/${encodeURIComponent(input.workflowId)}/signal`, "POST", {
        signal_name: input.signalName,
        input: input.payload,
      });
      return { success: true };
    }),

  /** Get workflow history */
  getHistory: adminProcedure
    .input(z.object({ workflowId: z.string(), maxEvents: z.number().int().min(1).max(1000).default(100) }))
    .query(async ({ input }) => {
      if (!TEMPORAL_HOST) return { events: [], configured: false };
      try {
        const data = (await gatewayCall(
          `/v1/workflows/${encodeURIComponent(input.workflowId)}/history?max_events=${input.maxEvents}`
        )) as { events: unknown[] };
        return { events: data.events ?? [], configured: true };
      } catch {
        return { events: [], configured: true, error: "Failed to fetch history" };
      }
    }),
});
