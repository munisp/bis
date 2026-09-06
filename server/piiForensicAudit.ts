import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { piiForensicAppendTotal } from "./piiRlsMetrics";

export type PiiForensicEventType = "incident_created" | "key_contained" | "key_compromised" | "rotation_created" | "rotation_dry_run_completed" | "rotation_started" | "rotation_progress" | "rotation_completed" | "rotation_failed" | "access_revoked" | "recovery_verified" | "incident_resolved" | "incident_closed";
export type PiiForensicIntegrityScheme = "hmac_sha256_canonical_json_v2";
type PiiForensicPrimitive = string | number | boolean | null;

const INTEGRITY_SCHEME: PiiForensicIntegrityScheme = "hmac_sha256_canonical_json_v2";
const allowedDetailKeys = new Set(["record_count", "registry_id", "source_registry_id", "target_registry_id", "rotation_job_id", "reason_code", "error_code", "actor_role", "source_key_version", "target_key_version", "provider_key_version", "evidence_ref", "channel", "dry_run", "checkpoint", "state", "worker_version", "incident_ref"]);

type PiiForensicWriteInput = {
  incidentId?: string | null;
  tenantId: number;
  rotationJobId?: string | null;
  actorUserId?: number | null;
  eventType: PiiForensicEventType;
  detail: Record<string, PiiForensicPrimitive>;
};
type PiiForensicStoredEvent = PiiForensicWriteInput & { id: number; integrityHash: string; integrityScheme: string; createdAt: Date | string };

function auditSecret(): string {
  const value = (process.env.AUDIT_HMAC_SECRET ?? "").trim();
  if (!value) throw new Error("AUDIT_HMAC_SECRET is required for PII forensic audit events.");
  return value;
}

function assertApprovedDetail(detail: Record<string, PiiForensicPrimitive>): void {
  for (const [key, value] of Object.entries(detail)) {
    if (!allowedDetailKeys.has(key) || (value !== null && !["string", "number", "boolean"].includes(typeof value))) {
      throw new Error("PII forensic audit event detail violates the approved non-PII schema.");
    }
  }
}

function canonicalCreatedAt(createdAt: Date | string): string {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) throw new Error("PII forensic audit event timestamp is invalid.");
  return date.toISOString();
}

function canonicalDetail(detail: Record<string, PiiForensicPrimitive>): Record<string, PiiForensicPrimitive> {
  return Object.fromEntries(Object.keys(detail).sort().map((key) => [key, detail[key]!])) as Record<string, PiiForensicPrimitive>;
}

export function canonicalPiiForensicAuditEvent(input: PiiForensicWriteInput & { createdAt: Date | string }): string {
  assertApprovedDetail(input.detail);
  return JSON.stringify({
    integrityScheme: INTEGRITY_SCHEME,
    incidentId: input.incidentId ?? null,
    tenantId: input.tenantId,
    rotationJobId: input.rotationJobId ?? null,
    actorUserId: input.actorUserId ?? null,
    eventType: input.eventType,
    detail: canonicalDetail(input.detail),
    createdAt: canonicalCreatedAt(input.createdAt),
  });
}

export function piiForensicIntegrityHash(input: PiiForensicWriteInput & { createdAt: Date | string }): string {
  return createHmac("sha256", auditSecret()).update(canonicalPiiForensicAuditEvent(input)).digest("hex");
}

export function verifyPiiForensicAuditEvent(event: PiiForensicStoredEvent): boolean {
  if (event.integrityScheme !== INTEGRITY_SCHEME || !/^[0-9a-f]{64}$/.test(event.integrityHash)) return false;
  const expected = Buffer.from(piiForensicIntegrityHash({
    incidentId: event.incidentId,
    tenantId: event.tenantId,
    rotationJobId: event.rotationJobId,
    actorUserId: event.actorUserId,
    eventType: event.eventType,
    detail: event.detail,
    createdAt: event.createdAt,
  }), "hex");
  const actual = Buffer.from(event.integrityHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function appendPiiForensicAuditEvent(client: PoolClient, input: PiiForensicWriteInput): Promise<void> {
  assertApprovedDetail(input.detail);
  const createdAt = new Date().toISOString();
  const integrityHash = piiForensicIntegrityHash({ ...input, createdAt });
  try {
    await client.query(
      `INSERT INTO pii_forensic_audit_events (incident_id,tenant_id,rotation_job_id,actor_user_id,event_type,detail,integrity_hash,integrity_scheme,created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::timestamptz)`,
      [input.incidentId ?? null, input.tenantId, input.rotationJobId ?? null, input.actorUserId ?? null, input.eventType, JSON.stringify(canonicalDetail(input.detail)), integrityHash, INTEGRITY_SCHEME, createdAt],
    );
    piiForensicAppendTotal.inc({ event_type: input.eventType, outcome: "success" });
  } catch (error) {
    piiForensicAppendTotal.inc({ event_type: input.eventType, outcome: "failure" });
    throw error;
  }
}

export async function readVerifiedPiiForensicEvents(client: PoolClient, tenantId: number, incidentRef: string | undefined, limit: number): Promise<Array<{ createdAt: Date | string; eventType: PiiForensicEventType; detail: Record<string, PiiForensicPrimitive>; integrityHash: string; integrityScheme: PiiForensicIntegrityScheme; incidentRef: string | null; incidentStatus: string | null }>> {
  const result = await client.query<{
    id: number; incident_id: string | null; tenant_id: number; rotation_job_id: string | null; actor_user_id: number | null; event_type: PiiForensicEventType; detail: Record<string, PiiForensicPrimitive>; integrity_hash: string; integrity_scheme: string; created_at: Date | string; incident_ref: string | null; incident_status: string | null;
  }>(
    `SELECT e.id,e.incident_id,e.tenant_id,e.rotation_job_id,e.actor_user_id,e.event_type,e.detail,e.integrity_hash,e.integrity_scheme,e.created_at,i.incident_ref,i.status AS incident_status
       FROM pii_forensic_audit_events e
       LEFT JOIN pii_key_compromise_incidents i ON i.id=e.incident_id
      WHERE e.tenant_id=$1 AND ($2::text IS NULL OR i.incident_ref=$2)
      ORDER BY e.created_at DESC,e.id DESC LIMIT $3`,
    [tenantId, incidentRef ?? null, limit],
  );
  const verified = result.rows.map((row) => ({
    id: row.id,
    incidentId: row.incident_id,
    tenantId: row.tenant_id,
    rotationJobId: row.rotation_job_id,
    actorUserId: row.actor_user_id,
    eventType: row.event_type,
    detail: row.detail,
    integrityHash: row.integrity_hash.trim(),
    integrityScheme: row.integrity_scheme,
    createdAt: row.created_at,
    incidentRef: row.incident_ref,
    incidentStatus: row.incident_status,
  }));
  if (verified.some((event) => !verifyPiiForensicAuditEvent(event))) {
    throw new Error("PII forensic audit integrity verification failed.");
  }
  return verified.map(({ createdAt, eventType, detail, integrityHash, integrityScheme, incidentRef: rowIncidentRef, incidentStatus }) => ({ createdAt, eventType, detail, integrityHash, integrityScheme: integrityScheme as PiiForensicIntegrityScheme, incidentRef: rowIncidentRef, incidentStatus }));
}
