import http from "k6/http";
import { check, sleep } from "k6";

// Run only against an explicitly authorised staging environment. This scenario
// is bounded to 50 virtual users and is intentionally unsuitable for public or
// third-party targets without written authorization.
const baseUrl = __ENV.BIS_BASE_URL;
const authorizationToken = __ENV.BIS_AUTHORIZED_TEST_TOKEN;
if (!baseUrl || !authorizationToken) {
  throw new Error("BIS_BASE_URL and BIS_AUTHORIZED_TEST_TOKEN are required for an authorised edge-resilience exercise");
}

export const options = {
  scenarios: {
    edge_resilience: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 10,
      maxVUs: 50,
      stages: [
        { target: 15, duration: "1m" },
        { target: 30, duration: "2m" },
        { target: 5, duration: "1m" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<750", "p(99)<1500"],
    checks: ["rate>0.98"],
  },
};

export default function edgeResilienceScenario() {
  const response = http.get(`${baseUrl.replace(/\/$/, "")}/api/health`, {
    headers: {
      Authorization: `Bearer ${authorizationToken}`,
      "X-BIS-Authorised-Resilience-Test": "true",
    },
    tags: { scenario: "edge_resilience" },
  });
  check(response, {
    "health contract remains available": (r) => r.status === 200,
    "response carries a request correlation id": (r) => Boolean(r.headers["X-Request-Id"]),
  });
  sleep(0.2);
}
