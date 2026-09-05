import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import { piiForensicAppendTotal } from "./piiRlsMetrics";

export type PiiForensicEventType = "incident_created" | "key_contained" | "key_compromised" | "rotation_created" | "rotation_dry_run_completed" | "rotation_started" | "rotation_progress" | "rotation_completed" | "rotation_failed" | "access_revoked" | "recovery_verified" | "incident_resolved" | "incident_closed";

const allowedDetailKeys = new Set(["record_count", "registry_id", "source_registry_id", "target_registry_id", "rotation_job_id", "reason_code", "error_code", "actor_role", "source_key_version", "target_key_version", "provider_key_version", "evidence_ref", "channel", "dry_run", "checkpoint", "state", "worker_version", "incident_ref"]);

function auditSecret(): string {
  const value = (process.env.AUDIT_HMAC_SECRET ?? "").trim();
  if (!value) throw new Error("AUDIT_HMAC_SECRET is required for PII forensic audit events.");
  return value;
}

export async function appendPiiForensicAuditEvent(client: PoolClient, input: { incidentId?: string | null; tenantId: number; rotationJobId?: string | null; actorUserId?: number | null; eventType: PiiForensicEventType; detail: Record<string, string | number | boolean | null> }): Promise<void> {
  for (const [key, value] of Object.entries(input.detail)) {
    if (!allowedDetailKeys.has(key) || (value !== null && !["string", "number", "boolean"].includes(typeof value))) {
      throw new Error("PII forensic audit event detail violates the approved non-PII schema.");
    }
  }
  const createdAt = new Date().toISOString();
  const canonical = JSON.stringify({ incidentId: input.incidentId ?? null, tenantId: input.tenantId, rotationJobId: input.rotationJobId ?? null, actorUserId: input.actorUserId ?? null, eventType: input.eventType, detail: input.detail, createdAt });
  const integrityHash = createHmac("sha256", auditSecret()).update(canonical).digest("hex");
  try {
    await client.query(
      `INSERT INTO pii_forensic_audit_events (incident_id,tenant_id,rotation_job_id,actor_user_id,event_type,detail,integrity_hash,created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::timestamptz)`,
      [input.incidentId ?? null, input.tenantId, input.rotationJobId ?? null, input.actorUserId ?? null, input.eventType, JSON.stringify(input.detail), integrityHash, createdAt],
    );
    piiForensicAppendTotal.inc({ event_type: input.eventType, outcome: "success" });
  } catch (error) {
    piiForensicAppendTotal.inc({ event_type: input.eventType, outcome: "failure" });
    throw error;
  }
}
