import { sql } from "drizzle-orm";
import { getDb } from "./db";

/**
 * Reject pending approvals whose immutable expiry deadline has elapsed. The SQL
 * transition is idempotent: a request can only move from pending to expired once.
 */
export async function expirePendingForceCreditApprovals(now = new Date()): Promise<{ expired: number; references: string[] }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.execute(sql`
    UPDATE force_credit_approvals
    SET "status" = 'expired',
        "approvalNote" = COALESCE("approvalNote", '') || ${`\n[SYSTEM_EXPIRED ${now.toISOString()}] Unapproved after 24 hours.`},
        "updatedAt" = ${now}
    WHERE "status" = 'pending' AND "expiresAt" <= ${now}
    RETURNING "id", "reference", "tenantId", "amountKobo", "requestedAt", "expiresAt"
  `);
  const expired = (result as any).rows ?? result ?? [];
  for (const approval of expired) {
    await db.execute(sql`
      INSERT INTO event_log ("eventType", "aggregateId", "payload", "source", "createdAt")
      VALUES ('force_credit_expired', ${approval.reference}, CAST(${JSON.stringify({
        approvalId: Number(approval.id),
        tenantId: approval.tenantId,
        amountKobo: Number(approval.amountKobo),
        requestedAt: approval.requestedAt,
        expiresAt: approval.expiresAt,
      })} AS json), 'force_credit_expiry', ${now})
    `);
  }
  return { expired: expired.length, references: expired.map((approval: any) => String(approval.reference)) };
}
