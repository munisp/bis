import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";

export type PrivilegedPolicyInput = {
  actorId: number;
  role: string;
  action: "force_credit_request" | "force_credit_approve" | "force_credit_reject" | "caddy_rate_limit_override";
  reference?: string;
  amountKobo?: number;
  mfaPassed?: boolean;
  approverId?: number;
  reason?: string;
};

export type PrivilegedPolicyDecision = {
  provider: "opa" | "development-bypass";
  policy: "bis/authz";
  decidedAt: string;
  mfaPassed: boolean;
};

export async function assertPrivilegedPolicy(input: PrivilegedPolicyInput): Promise<PrivilegedPolicyDecision> {
  if (!ENV.opaUrl) {
    if (ENV.isProduction) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Privileged action denied: policy decision point is unavailable" });
    return { provider: "development-bypass", policy: "bis/authz", decidedAt: new Date().toISOString(), mfaPassed: input.mfaPassed === true };
  }
  try {
    const response = await fetch(`${ENV.opaUrl.replace(/\/$/, "")}/v1/data/bis/authz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          type: "bff",
          action: input.action,
          mfaPassed: input.mfaPassed === true,
          actorId: input.actorId,
          approverId: input.approverId,
          reason: input.reason,
          resource: { reference: input.reference, amountKobo: input.amountKobo },
          request: {
            method: "POST",
            path: input.action === "caddy_rate_limit_override" ? "/v1/admin/caddy/rate-limit" : `/v1/force-credit/${input.action.replace("force_credit_", "")}`,
            headers: {
              "x-bis-security-stack": "caddy,open-appsec,apisix",
              "x-bis-user-roles": input.role,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(1_000),
    });
    const verdict = await response.json() as { result?: { allow?: boolean; reason?: string } };
    if (!response.ok || verdict.result?.allow !== true) {
      throw new Error(verdict.result?.reason ?? `OPA returned HTTP ${response.status}`);
    }
    return { provider: "opa", policy: "bis/authz", decidedAt: new Date().toISOString(), mfaPassed: input.mfaPassed === true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "FORBIDDEN", message: "Privileged action denied by policy", cause: error });
  }
}
