import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { piiForensicAppendTotal } from "./piiRlsMetrics";

export type PiiForensicEventType = "incident_created" | "key_contained" | "key_compromised" | "rotation_created" | "rotation_dry_run_completed" | "rotation_started" | "rotation_progress" | "rotation_completed" | "rotation_failed" | "access_revoked" | "recovery_verified" | "incident_resolved" | "incident_closed";
export type PiiForensicIntegrityScheme = "hmac_sha256_canonical_json_v2";
type PiiForensicPrimitive = string | number | boolean | null;

const INTEGRITY_SCHEME: PiiForensicIntegrityScheme = "hmac_sha256_canonical_json_v2";
const FORENSIC_CURSOR_VERSION = 3;
const LEGACY_FORENSIC_CURSOR_VERSION = 2;
const DEFAULT_FORENSIC_CURSOR_TTL_SECONDS = 900;
const MIN_FORENSIC_CURSOR_TTL_SECONDS = 60;
const MAX_FORENSIC_CURSOR_TTL_SECONDS = 3600;
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
type ForensicCursorPayload = { version: number; keyVersion: string; tenantId: number; incidentRef: string | null; createdAt: string; id: number; expiresAt: string };
type LegacyForensicCursorPayload = Omit<ForensicCursorPayload, "keyVersion"> & { version: typeof LEGACY_FORENSIC_CURSOR_VERSION };
export class PiiForensicCursorError extends Error {
  constructor() { super("PII forensic pagination cursor is invalid or expired."); }
}
type VerifiedForensicEvent = { id: number; createdAt: Date | string; eventType: PiiForensicEventType; detail: Record<string, PiiForensicPrimitive>; integrityHash: string; integrityScheme: PiiForensicIntegrityScheme; incidentRef: string | null; incidentStatus: string | null };

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

function cursorTtlSeconds(): number {
  const configured = process.env.BIS_PII_FORENSIC_CURSOR_TTL_SECONDS;
  if (configured === undefined || configured.trim() === "") return DEFAULT_FORENSIC_CURSOR_TTL_SECONDS;
  if (!/^[0-9]+$/.test(configured)) throw new Error("BIS_PII_FORENSIC_CURSOR_TTL_SECONDS must be a whole number.");
  const seconds = Number(configured);
  if (!Number.isSafeInteger(seconds) || seconds < MIN_FORENSIC_CURSOR_TTL_SECONDS || seconds > MAX_FORENSIC_CURSOR_TTL_SECONDS) {
    throw new Error(`BIS_PII_FORENSIC_CURSOR_TTL_SECONDS must be between ${MIN_FORENSIC_CURSOR_TTL_SECONDS} and ${MAX_FORENSIC_CURSOR_TTL_SECONDS}.`);
  }
  return seconds;
}

function cursorKeyring(): Map<string, Buffer> {
  const raw = (process.env.BIS_PII_FORENSIC_CURSOR_KEYRING ?? "").trim();
  if (!raw) throw new Error("BIS_PII_FORENSIC_CURSOR_KEYRING is required for signed forensic pagination.");
  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(",")) {
    const separator = entry.indexOf(":");
    const version = entry.slice(0, separator).trim();
    const encoded = entry.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(version) || separator <= 0 || !encoded) throw new Error("BIS_PII_FORENSIC_CURSOR_KEYRING has an invalid entry.");
    const key = Buffer.from(encoded, "base64url");
    if (key.length < 32 || !/^[A-Za-z0-9_-]+={0,2}$/.test(encoded) || keys.has(version)) throw new Error("BIS_PII_FORENSIC_CURSOR_KEYRING must contain distinct base64url keys of at least 256 bits.");
    keys.set(version, key);
  }
  return keys;
}

function cursorKeyExpiry(version: string): Date | null {
  const raw = (process.env.BIS_PII_FORENSIC_CURSOR_KEY_EXPIRIES_JSON ?? "").trim();
  if (!raw) return null;
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error("BIS_PII_FORENSIC_CURSOR_KEY_EXPIRIES_JSON must be valid JSON."); }
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("BIS_PII_FORENSIC_CURSOR_KEY_EXPIRIES_JSON must be an object.");
  const value = (values as Record<string, unknown>)[version];
  if (value === undefined) return null;
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) throw new Error("BIS_PII_FORENSIC_CURSOR_KEY_EXPIRIES_JSON has an invalid timestamp.");
  return new Date(value);
}

function activeCursorKey(): { version: string; key: Buffer } {
  const version = (process.env.BIS_PII_FORENSIC_CURSOR_ACTIVE_KEY_VERSION ?? "").trim();
  const key = cursorKeyring().get(version);
  if (!key) throw new Error("BIS_PII_FORENSIC_CURSOR_ACTIVE_KEY_VERSION must select a configured cursor key.");
  const expiry = cursorKeyExpiry(version);
  if (expiry && expiry.getTime() <= Date.now()) throw new Error("The active forensic cursor signing key is expired.");
  return { version, key };
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

function cursorHmacHex(version: number, key: Buffer, encoded: string): string {
  return createHmac("sha256", key).update(`bis:forensic-cursor:v${version}:${encoded}`).digest("hex");
}

function parseCursorPayload(encoded: string): Partial<ForensicCursorPayload> {
  if (encoded.length > 2048) throw new PiiForensicCursorError();
  try {
    const payload: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new PiiForensicCursorError();
    return payload as Partial<ForensicCursorPayload>;
  } catch (error) {
    if (error instanceof PiiForensicCursorError) throw error;
    throw new PiiForensicCursorError();
  }
}

function assertCursorPayload(candidate: Partial<ForensicCursorPayload>, tenantId: number, incidentRef: string | undefined): asserts candidate is ForensicCursorPayload {
  const cursorId = candidate.id;
  if (candidate.tenantId !== tenantId || candidate.incidentRef !== (incidentRef ?? null) || typeof candidate.createdAt !== "string" || typeof candidate.expiresAt !== "string" || Number.isNaN(new Date(candidate.createdAt).getTime()) || Number.isNaN(new Date(candidate.expiresAt).getTime()) || typeof cursorId !== "number" || !Number.isSafeInteger(cursorId) || cursorId <= 0 || new Date(candidate.expiresAt).getTime() <= Date.now()) throw new PiiForensicCursorError();
}

function encodeForensicCursor(payload: Omit<ForensicCursorPayload, "version" | "keyVersion" | "expiresAt">): string {
  const active = activeCursorKey();
  const expiresAt = new Date(Date.now() + cursorTtlSeconds() * 1000).toISOString();
  const encoded = Buffer.from(JSON.stringify({ ...payload, version: FORENSIC_CURSOR_VERSION, keyVersion: active.version, expiresAt })).toString("base64url");
  return `${encoded}.${cursorHmacHex(FORENSIC_CURSOR_VERSION, active.key, encoded)}`;
}

function decodeForensicCursor(cursor: string, tenantId: number, incidentRef: string | undefined): ForensicCursorPayload {
  const parts = cursor.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new PiiForensicCursorError();
  const candidate = parseCursorPayload(parts[0]);
  if (candidate.version === LEGACY_FORENSIC_CURSOR_VERSION) {
    const legacy = candidate as Partial<LegacyForensicCursorPayload>;
    if (!fixedTimeHexEqual(parts[1], hmacHex(`bis:forensic-cursor:v${LEGACY_FORENSIC_CURSOR_VERSION}:${parts[0]}`))) throw new PiiForensicCursorError();
    assertCursorPayload(legacy, tenantId, incidentRef);
    return { version: LEGACY_FORENSIC_CURSOR_VERSION, keyVersion: "legacy_audit_hmac", tenantId, incidentRef: incidentRef ?? null, createdAt: canonicalCreatedAt(legacy.createdAt), id: legacy.id, expiresAt: canonicalCreatedAt(legacy.expiresAt) };
  }
  if (candidate.version !== FORENSIC_CURSOR_VERSION || typeof candidate.keyVersion !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(candidate.keyVersion)) throw new PiiForensicCursorError();
  const key = cursorKeyring().get(candidate.keyVersion);
  const expiry = cursorKeyExpiry(candidate.keyVersion);
  if (!key || (expiry && expiry.getTime() <= Date.now()) || !fixedTimeHexEqual(parts[1], cursorHmacHex(FORENSIC_CURSOR_VERSION, key, parts[0]))) throw new PiiForensicCursorError();
  assertCursorPayload(candidate, tenantId, incidentRef);
  return { version: FORENSIC_CURSOR_VERSION, keyVersion: candidate.keyVersion, tenantId, incidentRef: incidentRef ?? null, createdAt: canonicalCreatedAt(candidate.createdAt), id: candidate.id, expiresAt: canonicalCreatedAt(candidate.expiresAt) };
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
    events: verified.map(({ id, createdAt, eventType, detail, integrityHash, integrityScheme, incidentRef, incidentStatus }) => ({ id, createdAt, eventType, detail, integrityHash, integrityScheme: integrityScheme as PiiForensicIntegrityScheme, incidentRef, incidentStatus })),
    nextCursor: hasMore && last ? encodeForensicCursor({ tenantId: input.tenantId, incidentRef: input.incidentRef ?? null, createdAt: canonicalCreatedAt(last.createdAt), id: last.id }) : null,
  };
}
