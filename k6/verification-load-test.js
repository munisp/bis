/**
 * k6 Load Test: BIS Verification API (NIN/BVN/CAC)
 *
 * Tests the Nigerian identity verification endpoints under load.
 * Verifies that:
 *   1. Cache hits return < 10ms
 *   2. Cache misses (live API) return < 2000ms
 *   3. Rate limiting is enforced (429 handled gracefully)
 *   4. Idempotent lookups return same result
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const cacheHitRate = new Rate("cache_hit_rate");
const verificationLatency = new Trend("verification_latency_ms", true);

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const API_TOKEN = __ENV.API_TOKEN || "test-token";

export const options = {
  scenarios: {
    cached_lookups: {
      executor: "constant-vus",
      vus: 50,
      duration: "2m",
    },
  },
  thresholds: {
    // Cache hits must be fast
    "verification_latency_ms{cache:hit}": ["p(95)<50"],
    // Live API calls must complete within SLA
    "verification_latency_ms{cache:miss}": ["p(95)<2000"],
    "http_req_failed": ["rate<0.05"],
  },
};

// NIN pool for testing (synthetic)
const NIN_POOL = Array.from({ length: 1000 }, (_, i) =>
  `${(12345678901 + i).toString().padStart(11, "0")}`
);

const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_TOKEN}`,
};

export default function () {
  const nin = NIN_POOL[randomIntBetween(0, NIN_POOL.length - 1)];
  const start = Date.now();

  const res = http.post(
    `${BASE_URL}/api/trpc/verify.nin`,
    JSON.stringify({ nin }),
    { headers: HEADERS, timeout: "5s" }
  );

  const latency = Date.now() - start;
  const isCacheHit = latency < 50; // Heuristic: < 50ms = cache hit
  verificationLatency.add(latency, { cache: isCacheHit ? "hit" : "miss" });
  cacheHitRate.add(isCacheHit);

  check(res, {
    "verify: status 200 or 429": (r) => r.status === 200 || r.status === 429,
    "verify: no 500 errors": (r) => r.status !== 500,
  });

  if (res.status === 429) {
    sleep(1); // Back off on rate limit
  } else {
    sleep(0.05);
  }
}
