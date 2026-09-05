import { Counter, Gauge } from "prom-client";

const componentLabels = ["component"] as const;

export const piiRlsTenantContextSetupTotal = new Counter({
  name: "bis_rls_tenant_context_setup_total",
  help: "Tenant RLS context setup attempts by bounded outcome; no tenant or subject identifiers are emitted.",
  labelNames: ["outcome", ...componentLabels],
});

export const piiRlsPoolContextResidualTotal = new Counter({
  name: "bis_rls_pool_context_residual_total",
  help: "Unexpected session-scoped tenant contexts found on reused PostgreSQL pooled connections.",
  labelNames: componentLabels,
});

export const piiRlsPolicyDenialTotal = new Counter({
  name: "bis_rls_policy_denial_total",
  help: "PostgreSQL RLS or permission denials by operation and SQLSTATE class, excluding SQL values and tenant data.",
  labelNames: ["operation", "component", "sqlstate_class"],
});

export const piiRotationDispatchTotal = new Counter({
  name: "bis_pii_rotation_dispatch_total",
  help: "Non-PII rotation dispatch outcomes from the global lease queue.",
  labelNames: ["outcome", ...componentLabels],
});

export const piiRotationDispatchQueueAgeSeconds = new Gauge({
  name: "bis_pii_rotation_dispatch_queue_age_seconds",
  help: "Age in seconds of the oldest queued non-PII rotation dispatch row.",
  labelNames: componentLabels,
});

export const piiRotationWorkerFailuresTotal = new Counter({
  name: "bis_pii_rotation_worker_failures_total",
  help: "PII rotation worker failures by approved reason code; no error text or PII is emitted.",
  labelNames: ["reason_code", ...componentLabels],
});

export const piiRotationTenantScopeMismatchTotal = new Counter({
  name: "bis_pii_rotation_tenant_scope_mismatch_total",
  help: "Detected tenant-scope inconsistencies in protected PII rotation records.",
  labelNames: componentLabels,
});

export const piiForensicAppendTotal = new Counter({
  name: "bis_pii_forensic_append_total",
  help: "PII-suppressed forensic audit append outcomes by approved event type.",
  labelNames: ["event_type", "outcome"],
});

export function recordTenantRlsContextSetup(outcome: "success" | "reset_failed" | "residual_detected" | "set_failed" | "verify_failed", component: string): void {
  piiRlsTenantContextSetupTotal.inc({ outcome, component });
}

export function recordRlsPolicyDenial(operation: string, component: string, error: unknown): void {
  const sqlstate = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code.slice(0, 2) : "unknown";
  piiRlsPolicyDenialTotal.inc({ operation, component, sqlstate_class: sqlstate });
}
