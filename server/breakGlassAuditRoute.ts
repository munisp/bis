import type { Request, Response } from "express";
import { sql } from "drizzle-orm";
import { validateBreakGlassAuditPayload, verifyBreakGlassAuditSignature, type BreakGlassAuditPayload } from "./breakGlassAudit";

type Database = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;

export function createBreakGlassAuditHandler(options: {
  gatewayKey: string;
  getDb: () => Promise<Database | null>;
  logError: (message: string, meta: Record<string, unknown>) => void;
}) {
  return async (req: Request, res: Response) => {
    try {
      const raw = req.body as Buffer;
      const supplied = String(req.headers["x-bis-gateway-signature"] ?? "");
      if (!Buffer.isBuffer(raw) || !verifyBreakGlassAuditSignature(raw, supplied, options.gatewayKey)) return res.status(401).json({ error: "invalid gateway signature" });
      const payload = JSON.parse(raw.toString("utf8")) as BreakGlassAuditPayload;
      const evidenceError = validateBreakGlassAuditPayload(payload);
      if (evidenceError) return res.status(400).json({ error: evidenceError });
      const db = await options.getDb();
      if (!db) return res.status(503).json({ error: "audit database unavailable" });
      const duplicate = await db.execute(sql`SELECT "id" FROM event_log WHERE "eventType" = ${payload.eventType!} AND "aggregateId" = ${payload.auditId} LIMIT 1`);
      if (((duplicate as any).rows ?? duplicate ?? []).length > 0) return res.status(409).json({ error: "break-glass audit replay" });
      const result = await db.execute(sql`
        INSERT INTO event_log ("eventType", "aggregateId", "actorId", "payload", "source", "createdAt")
        VALUES (${payload.eventType!}, ${payload.auditId}, ${Number(payload.actorId)}, CAST(${JSON.stringify({
          approverId: payload.approverId,
          path: payload.path,
          reason: payload.reason!.trim(),
          policy: payload.policy ?? "bis/authz",
          decision: payload.decision ?? "allow",
          decidedAt: payload.decidedAt,
        })} AS json), 'gateway_break_glass', NOW())
        RETURNING "id"
      `);
      const event = ((result as any).rows ?? result ?? [])[0];
      return res.status(201).json({ id: event?.id, auditId: payload.auditId });
    } catch (error) {
      options.logError("break-glass audit ingestion failed", { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: "break-glass audit ingestion failed" });
    }
  };
}
