import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { piiForensicAppendTotal } from "./piiRlsMetrics";

export type PiiForensicEventType = "incident_created" | "key_contained" | "key_compromised" | "rotation_created" | "rotation_dry_run_completed" | "rotation_started" | "rotation_progress" | "rotation_completed" | "rotation_failed" | "access_revoked" | "recovery_verified" | "incident_resolved" | "incident_closed";
export type PiiForensicIntegrityScheme = "hmac_sha256_canonical_json_v2";
type PiiForensicPrimitive = string | number | boolean | null;

const INTEGRITY_SCHEME: PiiForensicIntegrityScheme = "hmac_sha256_canonical_json_v2";
const FORENSIC_CURSOR_VERSION = 1;
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
type ForensicCursorPayload = { version: number; tenantId: number; incidentRef: string | null; createdAt: string; id: number };
type VerifiedForensicEvent = { createdAt: Date | string; eventType: PiiForensicEventType; detail: Record<string, PiiForensicPrimitive>; integrityHash: string; integrityScheme: PiiForensicIntegrityScheme; incidentRef: string | null; incidentStatus: string | null };

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

function hmacHex(value: string): string {
  return createHmac("sha256", auditSecret()).update(value).digest("hex");
}

function fixedTimeHexEqual(actual: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(actual) || !/^[0-9a-f]{64}$/.test(expected)) return false;
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
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
  return hmacHex(canonicalPiiForensicAuditEvent(input));
}

export function verifyPiiForensicAuditEvent(event: PiiForensicStoredEvent): boolean {
  if (event.integrityScheme !== INTEGRITY_SCHEME) return false;
  return fixedTimeHexEqual(event.integrityHash, piiForensicIntegrityHash({
    incidentId: event.incidentId,
    tenantId: event.tenantId,
    rotationJobId: event.rotationJobId,
    actorUserId: event.actorUserId,
    eventType: event.eventType,
    detail: event.detail,
    createdAt: event.createdAt,
  }));
}

function encodeForensicCursor(payload: ForensicCursorPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${hmacHex(encoded)}`;
}

function decodeForensicCursor(cursor: string, tenantId: number, incidentRef: string | undefined): ForensicCursorPayload {
  const parts = cursor.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !fixedTimeHexEqual(parts[1], hmacHex(parts[0]))) throw new Error("PII forensic pagination cursor is invalid.");
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { throw new Error("PII forensic pagination cursor is invalid."); }
  if (!payload || typeof payload !== "object") throw new Error("PII forensic pagination cursor is invalid.");
  const candidate = payload as Partial<ForensicCursorPayload>;
  const cursorId = candidate.id;
  if (candidate.version !== FORENSIC_CURSOR_VERSION || candidate.tenantId !== tenantId || candidate.incidentRef !== (incidentRef ?? null) || typeof candidate.createdAt !== "string" || Number.isNaN(new Date(candidate.createdAt).getTime()) || typeof cursorId !== "number" || !Number.isSafeInteger(cursorId) || cursorId <= 0) {
    throw new Error("PII forensic pagination cursor is invalid.");
  }
  return { version: FORENSIC_CURSOR_VERSION, tenantId, incidentRef: incidentRef ?? null, createdAt: canonicalCreatedAt(candidate.createdAt), id: cursorId };
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

export async function readVerifiedPiiForensicEvents(client: PoolClient, input: { tenantId: number; incidentRef?: string; limit: number; cursor?: string }): Promise<{ events: VerifiedForensicEvent[]; nextCursor: string | null }> {
  const cursor = input.cursor ? decodeForensicCursor(input.cursor, input.tenantId, input.incidentRef) : null;
  const result = await client.query<{
    id: number; incident_id: string | null; tenant_id: number; rotation_job_id: string | null; actor_user_id: number | null; event_type: PiiForensicEventType; detail: Record<string, PiiForensicPrimitive>; integrity_hash: string; integrity_scheme: string; created_at: Date | string; incident_ref: string | null; incident_status: string | null;
  }>(
    `SELECT e.id,e.incident_id,e.tenant_id,e.rotation_job_id,e.actor_user_id,e.event_type,e.detail,e.integrity_hash,e.integrity_scheme,e.created_at,i.incident_ref,i.status AS incident_status
       FROM pii_forensic_audit_events e
       LEFT JOIN pii_key_compromise_incidents i ON i.id=e.incident_id
      WHERE e.tenant_id=$1
        AND ($2::text IS NULL OR i.incident_ref=$2)
        AND ($3::timestamptz IS NULL OR (e.created_at,e.id) < ($3::timestamptz,$4::bigint))
      ORDER BY e.created_at DESC,e.id DESC LIMIT $5`,
    [input.tenantId, input.incidentRef ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1],
  );
  const hasMore = result.rows.length > input.limit;
  const pageRows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
  const verified = pageRows.map((row) => ({
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
  if (verified.some((event) => !verifyPiiForensicAuditEvent(event))) throw new Error("PII forensic audit integrity verification failed.");
  const last = verified.at(-1);
  return {
    events: verified.map(({ createdAt, eventType, detail, integrityHash, integrityScheme, incidentRef, incidentStatus }) => ({ createdAt, eventType, detail, integrityHash, integrityScheme: integrityScheme as PiiForensicIntegrityScheme, incidentRef, incidentStatus })),
    nextCursor: hasMore && last ? encodeForensicCursor({ version: FORENSIC_CURSOR_VERSION, tenantId: input.tenantId, incidentRef: input.incidentRef ?? null, createdAt: canonicalCreatedAt(last.createdAt), id: last.id }) : null,
  };
}
