import { Gauge } from "prom-client";
import { getPgPool } from "./db";

const staleLeases = new Gauge({
  name: "bis_payment_intent_outbox_stale_leases",
  help: "Payment intent outbox leases older than the configured five-minute recovery interval",
});
const openReconciliations = new Gauge({
  name: "bis_payment_reconciliation_open_cases",
  help: "Payment reconciliation cases requiring four-eyes human action by durable state",
  labelNames: ["state"],
});
const oldestOpenReconciliationAge = new Gauge({
  name: "bis_payment_reconciliation_oldest_open_age_seconds",
  help: "Age in seconds of the oldest open or under-review payment reconciliation case",
});
const collectionHealthy = new Gauge({
  name: "bis_payment_reconciliation_metrics_collection_healthy",
  help: "One when PostgreSQL payment reconciliation metrics were collected successfully; zero otherwise",
});

const outboxEvents = new Gauge({
  name: "bis_payment_intent_outbox_events",
  help: "Durable payment intent outbox records by state",
  labelNames: ["state"],
  async collect() {
    try {
      const pool = await getPgPool();
      if (!pool) throw new Error("PostgreSQL unavailable");
      const [states, stale, reconciliations] = await Promise.all([
        pool.query<{ status: string; count: string }>(
          "SELECT status, count(*)::text AS count FROM payment_intent_outbox GROUP BY status"
        ),
        pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM payment_intent_outbox WHERE status = 'leased' AND leased_at < now() - interval '300 seconds'"
        ),
        pool.query<{
          status: string;
          count: string;
          oldest_age: string | null;
        }>(
          `SELECT status, count(*)::text AS count,
                  extract(epoch FROM now() - min(opened_at))::text AS oldest_age
           FROM payment_reconciliation_cases
           WHERE status IN ('open', 'under_review')
           GROUP BY status`
        ),
      ]);

      outboxEvents.reset();
      openReconciliations.reset();
      for (const row of states.rows)
        outboxEvents.set({ state: row.status }, Number(row.count));
      for (const row of reconciliations.rows)
        openReconciliations.set({ state: row.status }, Number(row.count));
      staleLeases.set(Number(stale.rows[0]?.count ?? 0));
      oldestOpenReconciliationAge.set(
        Math.max(
          0,
          ...reconciliations.rows.map(row => Number(row.oldest_age ?? 0))
        )
      );
      collectionHealthy.set(1);
    } catch {
      collectionHealthy.set(0);
    }
  },
});

let registered = false;

/**
 * Ensures the module is initialized once during server startup. Gauges derive
 * from tenant-agnostic aggregate counts only and never expose transaction,
 * account, provider, tenant, or evidence identifiers as labels.
 */
export function registerPaymentReconciliationMetrics(): void {
  if (registered) return;
  registered = true;
}
