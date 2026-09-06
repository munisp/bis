import { afterEach, describe, expect, it, vi } from "vitest";
import { appendPiiForensicAuditEvent, piiForensicIntegrityHash, readVerifiedPiiForensicEvents, verifyPiiForensicAuditEvent } from "./piiForensicAudit";

const originalAuditSecret = process.env.AUDIT_HMAC_SECRET;

afterEach(() => {
  vi.useRealTimers();
  if (originalAuditSecret === undefined) delete process.env.AUDIT_HMAC_SECRET;
  else process.env.AUDIT_HMAC_SECRET = originalAuditSecret;
  delete process.env.BIS_PII_FORENSIC_CURSOR_TTL_SECONDS;
});

function event(overrides: Partial<{ id: number; tenantId: number; createdAt: string; detail: Record<string, string | number | boolean | null>; integrityHash: string; integrityScheme: string; incidentRef: string | null }> = {}) {
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
    incidentRef: "BIS-KC-ABCDEFGHIJKLMNOPQR",
  };
  const merged = { ...base, ...overrides, detail: overrides.detail ?? base.detail };
  const integrityHash = overrides.integrityHash ?? piiForensicIntegrityHash(merged);
  return { ...merged, integrityHash };
}

function row(value: ReturnType<typeof event>) {
  return {
    id: value.id,
    incident_id: value.incidentId,
    tenant_id: value.tenantId,
    rotation_job_id: value.rotationJobId,
    actor_user_id: value.actorUserId,
    event_type: value.eventType,
    detail: value.detail,
    integrity_hash: value.integrityHash,
    integrity_scheme: value.integrityScheme,
    created_at: value.createdAt,
    incident_ref: value.incidentRef,
    incident_status: "contained",
  };
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
    await expect(appendPiiForensicAuditEvent({ query } as never, { tenantId: 7, eventType: "rotation_failed", detail: { candidate_name: "must-not-write" } as never })).rejects.toThrow("approved non-PII schema");
    await expect(appendPiiForensicAuditEvent({ query } as never, { tenantId: 7, eventType: "rotation_failed", detail: { error_code: { nested: "must-not-write" } } as never })).rejects.toThrow("approved non-PII schema");
    expect(query).not.toHaveBeenCalled();
  });

  it("returns a bounded verified page and continues with a signed keyset cursor", async () => {
    const first = event({ id: 3, createdAt: "2026-09-05T12:00:03.000Z" });
    const second = event({ id: 2, createdAt: "2026-09-05T12:00:02.000Z" });
    const third = event({ id: 1, createdAt: "2026-09-05T12:00:01.000Z" });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [row(first), row(second)] })
      .mockResolvedValueOnce({ rows: [row(third)] });
    const firstPage = await readVerifiedPiiForensicEvents({ query } as never, { tenantId: 7, limit: 1 });
    expect(firstPage.events).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(query.mock.calls[0]![1][4]).toBe(2);
    const secondPage = await readVerifiedPiiForensicEvents({ query } as never, { tenantId: 7, limit: 1, cursor: firstPage.nextCursor! });
    expect(secondPage.events).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(query.mock.calls[1]![1][2]).toBe("2026-09-05T12:00:03.000Z");
    expect(query.mock.calls[1]![1][3]).toBe(3);
  });

  it("rejects cursor tampering and cross-tenant cursor reuse before any SQL query", async () => {
    const first = event({ id: 3, createdAt: "2026-09-05T12:00:03.000Z" });
    const second = event({ id: 2, createdAt: "2026-09-05T12:00:02.000Z" });
    const query = vi.fn().mockResolvedValueOnce({ rows: [row(first), row(second)] });
    const page = await readVerifiedPiiForensicEvents({ query } as never, { tenantId: 7, limit: 1 });
    await expect(readVerifiedPiiForensicEvents({ query } as never, { tenantId: 7, limit: 1, cursor: `${page.nextCursor}x` })).rejects.toThrow("cursor is invalid");
    await expect(readVerifiedPiiForensicEvents({ query } as never, { tenantId: 8, limit: 1, cursor: page.nextCursor! })).rejects.toThrow("cursor is invalid");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("verifies a 1,000-event synthetic history in bounded 100-row cursor pages", async () => {
    const history = Array.from({ length: 1000 }, (_, index) => event({
      id: 1000 - index,
      createdAt: new Date(Date.UTC(2026, 8, 5, 12, 0, 0, 1000 - index)).toISOString(),
    }));
    const query = vi.fn().mockImplementation(async (_sql: string, values: unknown[]) => {
      const cursorId = values[3] as number | null;
      const start = cursorId === null ? 0 : history.findIndex((candidate) => candidate.id === cursorId) + 1;
      return { rows: history.slice(start, start + (values[4] as number)).map(row) };
    });
    let cursor: string | null = null;
    let verified = 0;
    let pages = 0;
    do {
      const page = await readVerifiedPiiForensicEvents({ query } as never, { tenantId: 7, limit: 100, cursor: cursor ?? undefined });
      verified += page.events.length;
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(verified).toBe(1000);
    expect(pages).toBe(10);
    expect(Math.max(...query.mock.calls.map((call) => call[1][4] as number))).toBe(101);
  });

  it("continues without duplicates across equal timestamps and out-of-order timestamp groups", async () => {
    const sameTimestamp = "2026-09-05T12:00:00.000Z";
    const history = [
      event({ id: 9, createdAt: sameTimestamp, detail: { worker_version: "event-9" } }),
      event({ id: 8, createdAt: sameTimestamp, detail: { worker_version: "event-8" } }),
      event({ id: 7, createdAt: sameTimestamp, detail: { worker_version: "event-7" } }),
      event({ id: 6, createdAt: "2026-09-05T11:59:59.000Z", detail: { worker_version: "late-older-event-6" } }),
    ];
    const query = vi.fn().mockImplementation(async (_sql: string, values: unknown[]) => {
      const cursorId = values[3] as number | null;
      const start = cursorId === null ? 0 : history.findIndex((candidate) => candidate.id === cursorId) + 1;
      return { rows: history.slice(start, start + (values[4] as number)).map(row) };
    });
    let cursor: string | null = null;
    const received: string[] = [];
    do {
      const page = await readVerifiedPiiForensicEvents({ query } as never, { tenantId: 7, limit: 1, cursor: cursor ?? undefined });
      received.push(...page.events.map((entry) => String(entry.detail.worker_version)));
      cursor = page.nextCursor;
    } while (cursor);
    expect(received).toEqual(["event-9", "event-8", "event-7", "late-older-event-6"]);
    expect(new Set(received).size).toBe(4);
  });

  it("rejects expired signed cursors before issuing a continuation query", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    process.env.BIS_PII_FORENSIC_CURSOR_TTL_SECONDS = "60";
    const first = event({ id: 2, createdAt: "2026-09-05T11:59:59.000Z" });
    const second = event({ id: 1, createdAt: "2026-09-05T11:59:58.000Z" });
    const query = vi.fn().mockResolvedValueOnce({ rows: [row(first), row(second)] });
    const page = await readVerifiedPiiForensicEvents({ query } as never, { tenantId: 7, limit: 1 });
    vi.setSystemTime(new Date("2026-09-05T12:01:00.001Z"));
    await expect(readVerifiedPiiForensicEvents({ query } as never, { tenantId: 7, limit: 1, cursor: page.nextCursor! })).rejects.toThrow("invalid or expired");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rejects a mixed legacy/v2 page before returning any events", async () => {
    const valid = event({ id: 2 });
    const legacy = event({ id: 1, integrityScheme: "legacy_json_v1" });
    const query = vi.fn().mockResolvedValue({ rows: [row(valid), row(legacy)] });
    await expect(readVerifiedPiiForensicEvents({ query } as never, { tenantId: 7, limit: 10 })).rejects.toThrow("integrity verification failed");
  });

  it("rejects a tampered row before returning any events", async () => {
    const valid = event();
    const query = vi.fn().mockResolvedValue({ rows: [row({ ...valid, detail: { ...valid.detail, error_code: "TAMPERED" } })] });
    await expect(readVerifiedPiiForensicEvents({ query } as never, { tenantId: 7, limit: 10 })).rejects.toThrow("integrity verification failed");
  });
});
