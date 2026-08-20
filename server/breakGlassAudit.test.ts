import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateBreakGlassAuditPayload, verifyBreakGlassAuditSignature } from "./breakGlassAudit";

describe("break-glass audit evidence", () => {
  const raw = Buffer.from('{"auditId":"audit-1234567890123456"}');
  const secret = "test-gateway-key";

  it("accepts only the exact HMAC signed by the gateway key", () => {
    const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyBreakGlassAuditSignature(raw, signature, secret)).toBe(true);
    expect(verifyBreakGlassAuditSignature(raw, signature.slice(0, -1) + "0", secret)).toBe(false);
    expect(verifyBreakGlassAuditSignature(raw, signature, "other-key")).toBe(false);
  });

  it("requires independent actors, a privileged path, a substantive reason, and a fresh allow decision", () => {
    const now = Date.parse("2026-08-20T17:00:00.000Z");
    const valid = { auditId: "audit-1234567890123456", actorId: "7", approverId: "9", path: "/v1/admin/caddy/rate-limit", reason: "Credential-stuffing containment during active incident", decision: "allow", eventType: "break_glass_authorized", decidedAt: "2026-08-20T16:59:30.000Z" };
    expect(validateBreakGlassAuditPayload(valid, now)).toBeNull();
    expect(validateBreakGlassAuditPayload({ ...valid, approverId: "7" }, now)).toContain("independent approver");
    expect(validateBreakGlassAuditPayload({ ...valid, path: "/v1/nin/lookup" }, now)).toContain("privileged path");
    expect(validateBreakGlassAuditPayload({ ...valid, reason: "short" }, now)).toContain("reason");
    expect(validateBreakGlassAuditPayload({ ...valid, eventType: "unexpected" }, now)).toContain("event type");
    expect(validateBreakGlassAuditPayload({ ...valid, decidedAt: "2026-08-20T16:50:00.000Z" }, now)).toContain("stale");
  });
});
