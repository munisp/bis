import crypto from "node:crypto";

export type BreakGlassAuditPayload = {
  auditId?: string;
  actorId?: string;
  approverId?: string;
  path?: string;
  reason?: string;
  policy?: string;
  decision?: string;
  decidedAt?: string;
  eventType?: string;
};

export function verifyBreakGlassAuditSignature(raw: Buffer, supplied: string, secret: string): boolean {
  if (!secret || !supplied) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export function validateBreakGlassAuditPayload(payload: BreakGlassAuditPayload, now = Date.now()): string | null {
  const decidedAt = payload.decidedAt ? Date.parse(payload.decidedAt) : NaN;
  if (!payload.auditId || payload.auditId.length < 16) return "missing or invalid audit identifier";
  if (!payload.actorId || !Number.isSafeInteger(Number(payload.actorId)) || Number(payload.actorId) <= 0) return "invalid actor";
  if (!payload.approverId || !Number.isSafeInteger(Number(payload.approverId)) || Number(payload.approverId) <= 0 || payload.approverId === payload.actorId) return "invalid independent approver";
  if (!payload.path?.startsWith("/v1/admin/")) return "invalid privileged path";
  if (!payload.reason || payload.reason.trim().length < 10) return "insufficient break-glass reason";
  if (payload.decision && payload.decision !== "allow") return "break-glass decision must be allow";
  if (payload.eventType !== "break_glass_authorized" && payload.eventType !== "break_glass_execution_queued" && payload.eventType !== "break_glass_executed") return "invalid break-glass event type";
  if (!Number.isFinite(decidedAt) || Math.abs(now - decidedAt) > 5 * 60_000) return "stale or invalid policy decision time";
  return null;
}
