import { processDuePaystackWebhooks } from "./billingSettlement";
import { runWorkerTrace, traceLogFields } from "./traceContext";

const rawLimit = Number(process.env.BIS_PAYSTACK_WEBHOOK_WORKER_BATCH_SIZE ?? "50");
const batchSize = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 100 ? rawLimit : 50;

async function main(): Promise<void> {
  const processed = await processDuePaystackWebhooks(batchSize);
  process.stdout.write(`${JSON.stringify({ event: "paystack_webhook_events_claimed", processed, ...traceLogFields() })}\n`);
}

runWorkerTrace("billing-worker", "paystack-webhook-reconciliation", main).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown webhook-worker error";
  process.stderr.write(`${JSON.stringify({ event: "paystack_webhook_worker_failed", error: message, ...traceLogFields() })}\n`);
  process.exitCode = 1;
});
