#!/usr/bin/env node
/** Apply the reviewed BIS Permify schema through a protected CI environment. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const CONFIRMATION = "I_APPROVE_PERMIFY_SCHEMA_APPLY";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function endpoint(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PERMIFY_URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:") throw new Error("PERMIFY_URL must use HTTPS");
  return url;
}

async function main() {
  const environment = required("BIS_ENV");
  if (environment !== "staging" && environment !== "production") throw new Error("BIS_ENV must be staging or production");
  if (required("PERMIFY_SCHEMA_APPLY_CONFIRMATION") !== CONFIRMATION) throw new Error("explicit Permify schema apply confirmation is required");
  const baseUrl = endpoint(required("PERMIFY_URL"));
  const tenantId = required("PERMIFY_TENANT_ID");
  const apiKey = required("PERMIFY_API_KEY");
  const schemaPath = resolve(process.env.PERMIFY_SCHEMA_FILE ?? "infra/permify/bis.perm");
  const schema = await readFile(schemaPath, "utf8");
  if (!schema.includes("permission supervise_consumer_disputes = admin or consumer_dispute_supervisor")) {
    throw new Error("schema file does not contain the reviewed supervisor-only consumer-dispute permission");
  }
  if (!schema.includes("permission manage_adverse_actions = admin or adverse_action_supervisor or adverse_action_adjudicator")
    || !schema.includes("permission supervise_adverse_actions = admin or adverse_action_supervisor")) {
    throw new Error("schema file does not contain the reviewed tenant-scoped adverse-action permissions");
  }
  if (!schema.includes("permission manage_pii_key_custody = pii_key_custodian or pii_incident_commander")
    || !schema.includes("permission supervise_pii_key_custody = pii_incident_commander")
    || !schema.includes("permission view_pii_forensics = pii_key_custodian or pii_incident_commander or pii_forensic_auditor")
    || schema.includes("permission manage_pii_key_custody = admin")
    || schema.includes("permission supervise_pii_key_custody = admin")
    || schema.includes("permission view_pii_forensics = admin")) {
    throw new Error("schema file does not contain the reviewed dedicated PII key-custody and forensic permissions");
  }

  const response = await fetch(new URL(`/v1/tenants/${encodeURIComponent(tenantId)}/schemas/write`, baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ schema }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Permify schema write failed with HTTP ${response.status}`);
  const body = await response.json().catch(() => ({}));
  const schemaVersion = typeof body?.schema?.id === "string" ? body.schema.id : typeof body?.schema?.version === "string" ? body.schema.version : null;
  process.stdout.write(`PASS Permify schema applied for ${environment}; schemaVersion=${schemaVersion ?? "provider-not-returned"}\n`);
}

main().catch((error) => {
  process.stderr.write(`FAIL Permify schema apply: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
