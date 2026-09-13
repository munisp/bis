import { Gauge } from "prom-client";
import { getPgPool } from "./db";

const staleLeases = new Gauge({ name: "bis_intelligence_billing_stale_leases", help: "Assessment billing leases older than the configured five-minute recovery interval" });
const openReconciliations = new Gauge({ name: "bis_intelligence_billing_open_reconciliations", help: "Open or under-review human reconciliation cases" });
const oldestOpenReconciliationAge = new Gauge({ name: "bis_intelligence_billing_oldest_open_reconciliation_age_seconds", help: "Age in seconds of the oldest open human billing reconciliation" });
const collectionHealthy = new Gauge({ name: "bis_intelligence_billing_metrics_collection_healthy", help: "One when PostgreSQL billing metrics were collected successfully; zero otherwise" });

const events = new Gauge({
  name: "bis_intelligence_billing_events",
  help: "Durable intelligence assessment billing events by state",
  labelNames: ["state"],
  async collect() {
    try {
      const pool = await getPgPool();
      if (!pool) throw new Error("PostgreSQL unavailable");
      const [states, stale, reconciliations] = await Promise.all([
        pool.query<{ status: string; count: string }>("SELECT status, count(*)::text AS count FROM intelligence_assessment_billing_events GROUP BY status"),
        pool.query<{ count: string }>("SELECT count(*)::text AS count FROM intelligence_assessment_billing_events WHERE status = 'leased' AND leased_at < now() - interval '300 seconds'"),
        pool.query<{ count: string; oldest_age: string | null }>("SELECT count(*)::text AS count, extract(epoch FROM now() - min(requested_at))::text AS oldest_age FROM intelligence_assessment_billing_reconciliations WHERE status IN ('open','under_review')"),
      ]);
      events.reset();
      for (const row of states.rows) events.set({ state: row.status }, Number(row.count));
      staleLeases.set(Number(stale.rows[0]?.count ?? 0));
      openReconciliations.set(Number(reconciliations.rows[0]?.count ?? 0));
      oldestOpenReconciliationAge.set(Number(reconciliations.rows[0]?.oldest_age ?? 0));
      collectionHealthy.set(1);
    } catch {
      collectionHealthy.set(0);
    }
  },
});

let registered = false;
export function registerIntelligenceBillingMetrics(): void {
  if (registered) return;
  registered = true;
}
