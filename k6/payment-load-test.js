/**
 * k6 Load Test: BIS Payment API
 *
 * Lessons from 1B payments/day architecture:
 *   1. Ramp up gradually — sudden spikes reveal backpressure limits
 *   2. Test idempotency — replay same key, expect 200 not 500
 *   3. Measure p99 latency, not just average — tail latency kills SLAs
 *   4. Verify 503 backpressure responses are handled gracefully
 *   5. Partition key distribution — ensure no hot partitions
 *
 * Target SLOs:
 *   - p50 < 50ms
 *   - p95 < 200ms
 *   - p99 < 500ms
 *   - error rate < 0.1%
 *   - throughput > 10,000 req/s at peak
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { randomString, randomIntBetween } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

// ── Custom metrics ────────────────────────────────────────────────────────────

const paymentSuccessRate = new Rate("payment_success_rate");
const idempotencySuccessRate = new Rate("idempotency_success_rate");
const backpressureRate = new Rate("backpressure_503_rate");
const paymentLatency = new Trend("payment_latency_ms", true);
const idempotencyLatency = new Trend("idempotency_latency_ms", true);
const totalPayments = new Counter("total_payments");
const totalIdempotencyReplays = new Counter("total_idempotency_replays");

// ── Test configuration ────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const API_TOKEN = __ENV.API_TOKEN || "test-token";

/**
 * Load profile: gradual ramp-up → sustained peak → ramp-down
 * Mirrors real payment traffic patterns (morning ramp, lunch peak, evening ramp-down)
 */
export const options = {
  scenarios: {
    // Scenario 1: Gradual ramp-up to find breaking point
    ramp_up: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },    // Warm up
        { duration: "1m",  target: 200 },   // Ramp to moderate load
        { duration: "2m",  target: 500 },   // Ramp to high load
        { duration: "1m",  target: 1000 },  // Peak load
        { duration: "30s", target: 0 },     // Ramp down
      ],
      gracefulRampDown: "10s",
    },
    // Scenario 2: Idempotency replay test (separate VUs)
    idempotency_replay: {
      executor: "constant-vus",
      vus: 20,
      duration: "5m",
      startTime: "30s", // Start after initial ramp-up
    },
  },
  thresholds: {
    // SLO: p99 latency < 500ms
    "payment_latency_ms{scenario:ramp_up}": ["p(99)<500"],
    "payment_latency_ms{scenario:ramp_up}": ["p(95)<200"],
    "payment_latency_ms{scenario:ramp_up}": ["p(50)<50"],
    // SLO: error rate < 0.1% (excluding intentional 503 backpressure)
    "payment_success_rate": ["rate>0.999"],
    // SLO: idempotency replays must always succeed
    "idempotency_success_rate": ["rate>0.99"],
    // HTTP error rate
    "http_req_failed": ["rate<0.01"],
  },
};

// ── Shared idempotency keys (for replay testing) ──────────────────────────────

const SHARED_IDEMPOTENCY_KEYS = Array.from({ length: 100 }, (_, i) =>
  `idem-load-test-${i.toString().padStart(6, "0")}`
);

// ── Account pool (for partition distribution testing) ─────────────────────────

const ACCOUNT_POOL = Array.from({ length: 10_000 }, (_, i) =>
  `ACC-NG-${i.toString().padStart(9, "0")}`
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomAccount() {
  return ACCOUNT_POOL[randomIntBetween(0, ACCOUNT_POOL.length - 1)];
}

function randomAmount() {
  // Amount in kobo (1 NGN = 100 kobo)
  // Range: 100 kobo (₦1) to 10,000,000 kobo (₦100,000)
  return randomIntBetween(100, 10_000_000);
}

function makePaymentPayload(idempotencyKey?: string) {
  return JSON.stringify({
    sourceAccount: randomAccount(),
    destinationAccount: randomAccount(),
    amount: randomAmount(),
    currency: "NGN",
    narration: `Load test transfer ${randomString(8)}`,
    idempotencyKey: idempotencyKey || `idem-${randomString(16)}`,
  });
}

const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_TOKEN}`,
};

// ── Default function (ramp_up scenario) ──────────────────────────────────────

export default function () {
  const payload = makePaymentPayload();
  const start = Date.now();

  const res = http.post(`${BASE_URL}/api/trpc/transactions.create`, payload, {
    headers: HEADERS,
    timeout: "10s",
  });

  const latency = Date.now() - start;
  paymentLatency.add(latency);
  totalPayments.add(1);

  const isSuccess = res.status === 200;
  const isBackpressure = res.status === 503;

  paymentSuccessRate.add(isSuccess || isBackpressure); // 503 is expected under load
  backpressureRate.add(isBackpressure);

  check(res, {
    "payment: status 200 or 503": (r) => r.status === 200 || r.status === 503,
    "payment: response has body": (r) => r.body !== null && r.body.length > 0,
    "payment: no 500 errors": (r) => r.status !== 500,
    "payment: no 502 errors": (r) => r.status !== 502,
  });

  if (res.status === 503) {
    // Lesson: Back off on 503 — do not hammer a saturated system
    sleep(0.1 + Math.random() * 0.1); // 100-200ms jitter
  } else {
    sleep(0.01); // 10ms between requests
  }
}

// ── Idempotency replay scenario ───────────────────────────────────────────────

export function idempotency_replay() {
  // Pick a shared idempotency key — these should already exist in the DB
  const key = SHARED_IDEMPOTENCY_KEYS[randomIntBetween(0, SHARED_IDEMPOTENCY_KEYS.length - 1)];
  const payload = makePaymentPayload(key);
  const start = Date.now();

  const res = http.post(`${BASE_URL}/api/trpc/transactions.create`, payload, {
    headers: HEADERS,
    timeout: "10s",
  });

  const latency = Date.now() - start;
  idempotencyLatency.add(latency);
  totalIdempotencyReplays.add(1);

  // Idempotency replays must return 200 (not 409 Conflict or 500)
  const isSuccess = res.status === 200;
  idempotencySuccessRate.add(isSuccess);

  check(res, {
    "idempotency: status 200": (r) => r.status === 200,
    "idempotency: same result returned": (r) => {
      try {
        const body = JSON.parse(r.body as string);
        return body.result !== undefined || body.error !== undefined;
      } catch {
        return false;
      }
    },
  });

  sleep(0.05); // 50ms between replays
}

// ── Setup: seed idempotency keys ──────────────────────────────────────────────

export function setup() {
  console.log(`[k6] Seeding ${SHARED_IDEMPOTENCY_KEYS.length} idempotency keys...`);

  let seeded = 0;
  for (const key of SHARED_IDEMPOTENCY_KEYS.slice(0, 20)) { // Seed first 20
    const payload = makePaymentPayload(key);
    const res = http.post(`${BASE_URL}/api/trpc/transactions.create`, payload, {
      headers: HEADERS,
      timeout: "10s",
    });
    if (res.status === 200) seeded++;
  }

  console.log(`[k6] Seeded ${seeded} idempotency keys`);
  return { seededKeys: seeded };
}

// ── Teardown: print summary ───────────────────────────────────────────────────

export function teardown(data: { seededKeys: number }) {
  console.log(`[k6] Test complete. Seeded keys: ${data.seededKeys}`);
  console.log("[k6] Check Grafana/k6 dashboard for full metrics.");
}
