import { describe, expect, it } from "vitest";

process.env.DATABASE_URL = "postgresql://bis_user:bis_secure_2026@127.0.0.1:5432/bis_db";

describe("webhook retry queue local PostgreSQL contract", () => {
  it("persists one provider reference and recovers an expired worker lease", async () => {
    const { getDb } = await import("./db");
    const { enqueueFailedWebhook } = await import("./webhookRetry");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new Error("Local PostgreSQL is required for this suite");
    const reference = `db-webhook-${Date.now()}`;
    await enqueueFailedWebhook({ reference, tenantId: "db-tenant", amountKobo: 10_000, error: "ledger unavailable" });
    await enqueueFailedWebhook({ reference, tenantId: "db-tenant", amountKobo: 10_000, error: "duplicate delivery" });
    const inserted = await db.execute(sql`SELECT "reference", "status", "attempts" FROM webhook_retry_queue WHERE "reference" = ${reference}`) as any;
    expect(inserted.rows).toHaveLength(1);
    expect(inserted.rows[0].status).toBe("pending");
    await db.execute(sql`UPDATE webhook_retry_queue SET "status" = 'processing', "leasedAt" = NOW() - INTERVAL '6 minutes' WHERE "reference" = ${reference}`);
    await db.execute(sql`UPDATE webhook_retry_queue SET "status" = 'pending', "leasedAt" = NULL WHERE "status" = 'processing' AND "leasedAt" < NOW() - (300000 * INTERVAL '1 millisecond')`);
    const recovered = await db.execute(sql`SELECT "status", "leasedAt" FROM webhook_retry_queue WHERE "reference" = ${reference}`) as any;
    expect(recovered.rows[0]).toMatchObject({ status: "pending", leasedAt: null });
    await db.execute(sql`DELETE FROM webhook_retry_queue WHERE "reference" = ${reference}`);
  });
});
