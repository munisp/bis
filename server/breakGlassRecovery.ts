import { sql } from "drizzle-orm";

type Database = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;

export async function reconcileQueuedBreakGlassExecutions(db: Database): Promise<{ scanned: number; recoveryRequired: number }> {
  const queued = await db.execute(sql`
    SELECT q."aggregateId", q."actorId", q."payload", q."createdAt"
    FROM event_log q
    WHERE q."eventType" = 'break_glass_execution_queued'
      AND q."createdAt" < NOW() - INTERVAL '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM event_log done
        WHERE done."aggregateId" = q."aggregateId"
          AND done."eventType" = 'break_glass_executed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM event_log recovery
        WHERE recovery."aggregateId" = q."aggregateId"
          AND recovery."eventType" = 'break_glass_execution_recovery_required'
      )
    ORDER BY q."createdAt" ASC
    LIMIT 50
  `);
  const rows = ((queued as any).rows ?? queued ?? []) as Array<{ aggregateId: string; actorId: number; payload: unknown; createdAt: unknown }>;
  let recoveryRequired = 0;
  for (const row of rows) {
    const result = await db.execute(sql`
      INSERT INTO event_log ("eventType", "aggregateId", "actorId", "payload", "source", "createdAt")
      SELECT 'break_glass_execution_recovery_required', ${row.aggregateId}, ${row.actorId},
        CAST(${JSON.stringify({ queuedEvidence: row.payload, queuedAt: row.createdAt, recoveryReason: "Gateway completion evidence was not received within five minutes" })} AS json),
        'break_glass_recovery', NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM event_log recovery
        WHERE recovery."aggregateId" = ${row.aggregateId}
          AND recovery."eventType" = 'break_glass_execution_recovery_required'
      )
      RETURNING "id"
    `);
    if (((result as any).rows ?? result ?? []).length > 0) recoveryRequired++;
  }
  return { scanned: rows.length, recoveryRequired };
}
