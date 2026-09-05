import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const alertsPath = path.join(root, "infra", "monitoring", "migration-0017-rls-alerts.yml");
const dashboardPath = path.join(root, "infra", "monitoring", "migration-0017-rls-dashboard.json");

const requiredAlerts = new Set([
  "BisRlsTenantContextResidual",
  "BisRlsContextSetupFailure",
  "BisRlsPolicyDenialSpike",
  "BisRlsTenantScopeMismatch",
  "BisPiiRotationDispatchBacklog",
  "BisPiiRotationLeaseRecoverySpike",
  "BisPiiRotationWorkerFailure",
  "BisPiiForensicAuditAppendFailure",
]);

const requiredMetrics = [
  "bis_rls_tenant_context_setup_total",
  "bis_rls_pool_context_residual_total",
  "bis_rls_policy_denial_total",
  "bis_pii_rotation_dispatch_total",
  "bis_pii_rotation_dispatch_queue_age_seconds",
  "bis_pii_rotation_worker_failures_total",
  "bis_pii_rotation_tenant_scope_mismatch_total",
  "bis_pii_forensic_append_total",
];

const alertDoc = yaml.load(await readFile(alertsPath, "utf8"));
assert.equal(typeof alertDoc, "object");
assert.ok(Array.isArray(alertDoc.groups));
const rules = alertDoc.groups.flatMap((group) => group.rules ?? []);
const alertNames = new Set(rules.map((rule) => rule.alert));
for (const name of requiredAlerts) assert.ok(alertNames.has(name), `missing required alert ${name}`);
for (const rule of rules) {
  assert.equal(typeof rule.expr, "string", `${rule.alert} must define an expression`);
  assert.ok(rule.expr.includes("bis_"), `${rule.alert} must query a BIS metric`);
  assert.equal(typeof rule.annotations?.runbook, "string", `${rule.alert} must include a runbook`);
}

const dashboard = JSON.parse(await readFile(dashboardPath, "utf8"));
assert.equal(dashboard.uid, "bis-migration-0017-rls");
assert.ok(Array.isArray(dashboard.panels));
const expressions = dashboard.panels.flatMap((panel) => (panel.targets ?? []).map((target) => target.expr)).filter((expr) => typeof expr === "string");
for (const metric of requiredMetrics) {
  assert.ok(expressions.some((expression) => expression.includes(metric)) || rules.some((rule) => rule.expr.includes(metric)), `metric ${metric} is not represented in rules or dashboard`);
}
assert.ok(dashboard.panels.some((panel) => panel.title === "RLS Context Setup Failures (5m)"));
assert.ok(dashboard.panels.some((panel) => panel.title === "Oldest Queued Dispatch Age"));

process.stdout.write(JSON.stringify({ status: "pass", alertRules: rules.length, dashboardPanels: dashboard.panels.length, monitoredMetrics: requiredMetrics.length }) + "\n");
