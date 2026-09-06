import { afterEach, describe, expect, it, vi } from "vitest";
import { appendPiiForensicAuditEvent, piiForensicIntegrityHash, readVerifiedPiiForensicEvents, verifyPiiForensicAuditEvent } from "./piiForensicAudit";

const originalAuditSecret = process.env.AUDIT_HMAC_SECRET;

afterEach(() => {
  if (originalAuditSecret === undefined) delete process.env.AUDIT_HMAC_SECRET;
  else process.env.AUDIT_HMAC_SECRET = originalAuditSecret;
});

function event(overrides: Partial<{ detail: Record<string, string | number | boolean | null>; integrityHash: string; integrityScheme: string }> = {}) {
  process.env.AUDIT_HMAC_SECRET = "synthetic-forensic-hmac-secret";
  const base = {
    id: 1,
    incidentId: "11111111-1111-1111-1111-111111111111",
    tenantId: 7,
    rotationJobId: "22222222-2222-2222-2222-222222222222",
    actorUserId: 99,
    eventType: "rotation_failed" as const,
    detail: { worker_version: "pii-rotation-v1", error_code: "PII_ROTATION_ATTEMPTS_EXHAUSTED" },
    integrityScheme: "hmac_sha256_canonical_json_v2",
    createdAt: "2026-09-05T12:00:00.000Z",
  };
  const detail = overrides.detail ?? base.detail;
  const integrityHash = overrides.integrityHash ?? piiForensicIntegrityHash({ ...base, detail });
  return { ...base, detail, integrityHash, integrityScheme: overrides.integrityScheme ?? base.integrityScheme };
}

describe("PII forensic audit read-back integrity", () => {
  it("accepts a canonical version-2 HMAC independently of input detail key order", () => {
    const valid = event({ detail: { error_code: "PII_ROTATION_ATTEMPTS_EXHAUSTED", worker_version: "pii-rotation-v1" } });
    expect(verifyPiiForensicAuditEvent(valid)).toBe(true);
  });

  it("rejects detail, tenant, timestamp, and hash tampering", () => {
    const valid = event();
    expect(verifyPiiForensicAuditEvent({ ...valid, detail: { ...valid.detail, error_code: "ALTERED" } })).toBe(false);
    expect(verifyPiiForensicAuditEvent({ ...valid, tenantId: 8 })).toBe(false);
    expect(verifyPiiForensicAuditEvent({ ...valid, createdAt: "2026-09-05T12:00:01.000Z" })).toBe(false);
    expect(verifyPiiForensicAuditEvent({ ...valid, integrityHash: "0".repeat(64) })).toBe(false);
  });

  it("fails closed for legacy or malformed audit-hash representations", () => {
    const valid = event();
    expect(verifyPiiForensicAuditEvent({ ...valid, integrityScheme: "legacy_json_v1" })).toBe(false);
    expect(verifyPiiForensicAuditEvent({ ...valid, integrityHash: "not-a-hash" })).toBe(false);
  });

  it("rejects unapproved detail fields and non-primitive values before insert", async () => {
    process.env.AUDIT_HMAC_SECRET = "synthetic-forensic-hmac-secret";
    const query = vi.fn();
    await expect(appendPiiForensicAuditEvent({ query } as never, {
      tenantId: 7,
      eventType: "rotation_failed",
      detail: { candidate_name: "must-not-write" } as never,
    })).rejects.toThrow("approved non-PII schema");
    await expect(appendPiiForensicAuditEvent({ query } as never, {
      tenantId: 7,
      eventType: "rotation_failed",
      detail: { error_code: { nested: "must-not-write" } } as never,
    })).rejects.toThrow("approved non-PII schema");
    expect(query).not.toHaveBeenCalled();
  });

  it("returns verified rows and rejects a tampered row before returning any events", async () => {
    const valid = event();
    const query = vi.fn().mockResolvedValueOnce({ rows: [{
      id: valid.id,
      incident_id: valid.incidentId,
      tenant_id: valid.tenantId,
      rotation_job_id: valid.rotationJobId,
      actor_user_id: valid.actorUserId,
      event_type: valid.eventType,
      detail: valid.detail,
      integrity_hash: valid.integrityHash,
      integrity_scheme: valid.integrityScheme,
      created_at: valid.createdAt,
      incident_ref: "BIS-KC-ABCDEFGHIJKLMNOPQR",
      incident_status: "contained",
    }] });
    await expect(readVerifiedPiiForensicEvents({ query } as never, 7, undefined, 10)).resolves.toHaveLength(1);
    query.mockResolvedValueOnce({ rows: [{
      id: valid.id,
      incident_id: valid.incidentId,
      tenant_id: valid.tenantId,
      rotation_job_id: valid.rotationJobId,
      actor_user_id: valid.actorUserId,
      event_type: valid.eventType,
      detail: { ...valid.detail, error_code: "TAMPERED" },
      integrity_hash: valid.integrityHash,
      integrity_scheme: valid.integrityScheme,
      created_at: valid.createdAt,
      incident_ref: "BIS-KC-ABCDEFGHIJKLMNOPQR",
      incident_status: "contained",
    }] });
    await expect(readVerifiedPiiForensicEvents({ query } as never, 7, undefined, 10)).rejects.toThrow("integrity verification failed");
  });
});
