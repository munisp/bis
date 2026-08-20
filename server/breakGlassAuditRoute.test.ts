import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createBreakGlassAuditHandler } from "./breakGlassAuditRoute";

const key = "gateway-audit-test-key";
const payload = {
  auditId: "audit-1234567890123456",
  actorId: "7",
  approverId: "9",
  path: "/v1/admin/caddy/rate-limit",
  reason: "Contain active credential-stuffing incident immediately",
  policy: "bis/authz",
  decision: "allow",
  eventType: "break_glass_authorized",
  decidedAt: new Date().toISOString(),
};

function responseRecorder() {
  const result = { statusCode: 200, body: undefined as unknown };
  const res = {
    status: vi.fn((code: number) => { result.statusCode = code; return res; }),
    json: vi.fn((body: unknown) => { result.body = body; return res; }),
  };
  return { res, result };
}

function signedRequest(body = payload, signatureOverride?: string) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = signatureOverride ?? crypto.createHmac("sha256", key).update(raw).digest("hex");
  return { body: raw, headers: { "x-bis-gateway-signature": signature } } as any;
}

describe("break-glass audit endpoint", () => {
  it("persists a valid signed authorization event", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 12 }] });
    const handler = createBreakGlassAuditHandler({ gatewayKey: key, getDb: async () => ({ execute } as any), logError: vi.fn() });
    const { res, result } = responseRecorder();
    await handler(signedRequest(), res as any);
    expect(result.statusCode).toBe(201);
    expect(result.body).toMatchObject({ id: 12, auditId: payload.auditId });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("rejects a signed replay before another immutable event can be inserted", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ id: 12 }] });
    const handler = createBreakGlassAuditHandler({ gatewayKey: key, getDb: async () => ({ execute } as any), logError: vi.fn() });
    const { res, result } = responseRecorder();
    await handler(signedRequest(), res as any);
    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({ error: "break-glass audit replay" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid gateway signature before inspecting or persisting the payload", async () => {
    const execute = vi.fn();
    const handler = createBreakGlassAuditHandler({ gatewayKey: key, getDb: async () => ({ execute } as any), logError: vi.fn() });
    const { res, result } = responseRecorder();
    await handler(signedRequest(payload, "invalid"), res as any);
    expect(result.statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
});
