# Grafana Alerting and k6 Load Testing for Refresh-Race Detection

**Author:** Manus AI  
**Status:** Staging-only implementation reference. The numeric thresholds below are initial guardrails, not universal production SLOs. Calibrate them against an approved baseline and error budget before paging an operator.

## 1. Signal Model: Metrics, Traces, and Race Semantics

Grafana Tempo’s span-metrics processor can produce request, error, and duration RED metrics from ingested traces. [1] Those metrics are useful for alerting, but they cannot by themselves prove a race condition: a correctly operating refresh lease may deliberately return a controlled `lease_held` result to a losing tab. Therefore, expose a small set of **BFF semantic counters** and correlate them with trace-derived latency and error metrics.

| Signal | Source | Good behavior | Alert only when |
|---|---|---|---|
| `bis_auth_refresh_requests_total` | BFF counter | Counts all refresh attempts by stable outcome. | Volume is unusual with a rising error ratio. |
| `bis_auth_refresh_lease_total` | BFF counter | `acquired` and `held` coexist during real tab contention. | `held` ratio is high *and* duration/error signals deteriorate. |
| `bis_auth_refresh_provider_calls_total` | BFF counter | At most one provider call per acquired lease. | Calls exceed acquired leases or error ratio rises. |
| `bis_auth_refresh_duration_seconds` | BFF histogram | Measures BFF refresh response duration. | P99 exceeds baseline while traffic is meaningful. |
| `traces_spanmetrics_latency_bucket` | Tempo span metrics | Measures `auth.refresh` and Keycloak child span duration. | P99 trend confirms BFF internal bottleneck/provider slowness. |
| `traces_spanmetrics_calls_total` | Tempo span metrics | Counts status class/error spans. | Error rate grows or an auth dependency is unavailable. |
| `bis_auth_refresh_race_violation_total` | BFF counter | Must remain zero. | Any positive increase: duplicate provider rotation or impossible lease state. |

Use only low-cardinality labels: `outcome`, `lease_result`, `provider_result`, `environment`, and `service`. Do **not** label metrics with user IDs, tenant IDs, session family IDs, operation IDs, trace IDs, email addresses, routes with dynamic IDs, or Keycloak realm/session identifiers.

```ts
// server/_core/refreshMetrics.ts — target instrumentation boundary
import { Counter, Histogram, Registry } from "prom-client";

export const refreshRegistry = new Registry();
export const refreshRequests = new Counter({
  name: "bis_auth_refresh_requests_total",
  help: "BFF-owned refresh outcomes; never include identity-bearing labels.",
  labelNames: ["outcome", "lease_result", "provider_result"],
  registers: [refreshRegistry],
});
export const refreshLease = new Counter({
  name: "bis_auth_refresh_lease_total",
  help: "Refresh lease decisions across BFF replicas.",
  labelNames: ["result"],
  registers: [refreshRegistry],
});
export const refreshDuration = new Histogram({
  name: "bis_auth_refresh_duration_seconds",
  help: "End-to-end BFF refresh duration.",
  labelNames: ["outcome"],
  buckets: [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2.5, 5],
  registers: [refreshRegistry],
});
export const refreshRaceViolation = new Counter({
  name: "bis_auth_refresh_race_violation_total",
  help: "Invariant failures: more than one provider rotation for a single acquired lease.",
  labelNames: ["violation"],
  registers: [refreshRegistry],
});
```

## 2. Tempo Metrics Generator and Grafana Data Source

In Tempo, enable span metrics with carefully selected intrinsic dimensions. Metric names can vary by Tempo version and configuration; query the actual Prometheus/Mimir series after deployment rather than copying names blindly.

```yaml
# tempo.yaml — target fragment; pin and validate against deployed Tempo version
metrics_generator:
  registry:
    external_labels:
      source: tempo
      environment: ${ENVIRONMENT}
  processor:
    span_metrics:
      dimensions:
        - auth.outcome
        - auth.lease_result
        - http.route
        - service.name
      intrinsic_dimensions:
        status_code: true
        status_message: false
      filter_policies:
        - include:
            match_type: strict
            attributes:
              - key: service.name
                value: bis-bff
```

Do not create dimensions from `auth.operation_id`, trace IDs, request IDs, pseudonymous session hashes, or HTTP query strings. A trace backend can preserve those opaque joins at restricted access; a metrics backend must remain aggregatable and low cardinality.

## 3. Grafana-Managed Alert Provisioning

Grafana organizes rules into evaluation groups; the group interval determines evaluation frequency. [2] The following file uses the Prometheus data source UID `prometheus` and should be mounted under Grafana alerting provisioning. Configure contact points and notification policies separately; never send trace payloads, session identifiers, or raw error bodies to chat/email.

```yaml
# observability/grafana/provisioning/alerting/refresh-race.yaml
apiVersion: 1
groups:
  - orgId: 1
    name: bis-refresh-race
    folder: BIS Authentication
    interval: 1m
    rules:
      - uid: bis-refresh-race-violation
        title: BFF refresh lease invariant violated
        condition: C
        for: 0m
        data:
          - refId: A
            datasourceUid: prometheus
            relativeTimeRange: { from: 300, to: 0 }
            model:
              expr: sum(increase(bis_auth_refresh_race_violation_total[5m]))
              instant: true
              refId: A
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: A
              conditions:
                - type: query
                  reducer: { type: last, params: [] }
                  evaluator: { type: gt, params: [0] }
                  operator: { type: and }
        annotations:
          summary: "Refresh lease invariant violated"
          runbook_url: "https://runbooks.example.com/auth/refresh-race"
        labels: { severity: critical, service: bis-bff, signal: refresh_race }

      - uid: bis-refresh-held-contention
        title: Abnormal BFF refresh lease contention
        condition: C
        for: 10m
        data:
          - refId: A
            datasourceUid: prometheus
            relativeTimeRange: { from: 900, to: 0 }
            model:
              expr: |
                sum(rate(bis_auth_refresh_lease_total{result="held"}[5m]))
                /
                clamp_min(sum(rate(bis_auth_refresh_lease_total[5m])), 0.01)
              instant: true
              refId: A
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: A
              conditions:
                - type: query
                  reducer: { type: last, params: [] }
                  evaluator: { type: gt, params: [0.35] }
                  operator: { type: and }
        annotations:
          summary: "More than 35% of BFF refresh attempts are lease-held"
          description: "Investigate only with latency/error context; ordinary multi-tab coordination can create held outcomes."
          runbook_url: "https://runbooks.example.com/auth/refresh-contention"
        labels: { severity: warning, service: bis-bff, signal: refresh_contention }

      - uid: bis-refresh-p99
        title: BFF refresh P99 latency above initial guardrail
        condition: C
        for: 10m
        data:
          - refId: A
            datasourceUid: prometheus
            relativeTimeRange: { from: 900, to: 0 }
            model:
              expr: |
                histogram_quantile(0.99,
                  sum by (le) (rate(bis_auth_refresh_duration_seconds_bucket[5m]))
                )
              instant: true
              refId: A
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: A
              conditions:
                - type: query
                  reducer: { type: last, params: [] }
                  evaluator: { type: gt, params: [1.5] }
                  operator: { type: and }
        annotations:
          summary: "BFF refresh P99 exceeds 1.5 seconds"
          runbook_url: "https://runbooks.example.com/auth/refresh-latency"
        labels: { severity: warning, service: bis-bff, signal: refresh_latency }

      - uid: bis-refresh-error-rate
        title: BFF refresh provider or database failure rate elevated
        condition: C
        for: 5m
        data:
          - refId: A
            datasourceUid: prometheus
            relativeTimeRange: { from: 600, to: 0 }
            model:
              expr: |
                sum(rate(bis_auth_refresh_requests_total{outcome=~"provider_timeout|provider_rejected|database_unavailable"}[5m]))
                /
                clamp_min(sum(rate(bis_auth_refresh_requests_total[5m])), 0.01)
              instant: true
              refId: A
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: A
              conditions:
                - type: query
                  reducer: { type: last, params: [] }
                  evaluator: { type: gt, params: [0.02] }
                  operator: { type: and }
        annotations:
          summary: "Refresh error ratio exceeds 2%"
          runbook_url: "https://runbooks.example.com/auth/refresh-errors"
        labels: { severity: critical, service: bis-bff, signal: refresh_error }
```

### 3.1 Trace-derived confirmation queries

Use Grafana Explore and Tempo TraceQL to diagnose an alert after it fires. Avoid including raw identifiers in alert labels.

```traceql
{ resource.service.name = "bis-bff" && name = "auth.refresh" && .auth.lease_result = "acquired" }
  >> { name = "http.client.keycloak.token" && status = error }
```

```promql
# Verify that provider calls do not outrun acquired leases over the same interval.
sum(rate(bis_auth_refresh_provider_calls_total[5m]))
  > sum(rate(bis_auth_refresh_lease_total{result="acquired"}[5m]))
```

## 4. Synthetic High-Concurrency k6 Test

This test intentionally runs only against an approved staging URL, marked with `ENVIRONMENT=staging`, and with **pre-provisioned synthetic session cookies** injected by the CI secret store. It does not run credential grant flows, does not load real user accounts, does not print cookies, and does not hit production. The test simulates thousands of **tab-equivalent virtual users** by mapping each VU to a fixed synthetic session family and triggering controlled contention within a family.

k6 thresholds are pass/fail criteria for metric expectations and can use percentile expressions such as `p(99)`. [3]

```javascript
// tests/load/refresh-race.k6.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import exec from "k6/execution";

const refreshLatency = new Trend("refresh_latency", true);
const refreshUnexpectedError = new Rate("refresh_unexpected_error");
const refreshLeaseHeld = new Counter("refresh_lease_held");
const refreshOperationHeaderMissing = new Counter("refresh_operation_header_missing");

const baseUrl = __ENV.BASE_URL;
const environment = __ENV.ENVIRONMENT;
const syntheticCookieJson = __ENV.SYNTHETIC_SESSION_COOKIES_JSON;

if (environment !== "staging") throw new Error("Refusing to run outside ENVIRONMENT=staging");
if (!baseUrl || !baseUrl.startsWith("https://staging.")) throw new Error("BASE_URL must be an approved staging HTTPS origin");
if (!syntheticCookieJson) throw new Error("SYNTHETIC_SESSION_COOKIES_JSON is required");

const syntheticCookies = JSON.parse(syntheticCookieJson);
if (!Array.isArray(syntheticCookies) || syntheticCookies.length < 1) throw new Error("No synthetic cookies provided");

export const options = {
  scenarios: {
    auth_peak: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 500 },
        { duration: "3m", target: 2000 },
        { duration: "5m", target: 2000 },
        { duration: "2m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    // Initial staging guardrails; set production SLOs only from approved baseline evidence.
    "refresh_latency{kind:refresh}": ["p(99)<1500"],
    refresh_unexpected_error: ["rate<0.01"],
    refresh_operation_header_missing: ["count==0"],
    http_req_failed: ["rate<0.02"],
  },
  discardResponseBodies: true,
};

function sessionCookieForVu() {
  // A finite synthetic pool deliberately creates some family contention without sharing real accounts.
  const familyIndex = exec.vu.idInTest % syntheticCookies.length;
  return syntheticCookies[familyIndex];
}

export default function () {
  const cookie = sessionCookieForVu();
  const start = Date.now();
  const response = http.post(`${baseUrl}/api/auth/refresh`, null, {
    headers: {
      Cookie: cookie,
      "x-load-test": "synthetic-refresh-race-v1",
      // The BFF should overwrite/validate client correlation context; no token is included here.
      "x-request-id": `load-${exec.vu.idInTest}-${exec.vu.iterationInScenario}`,
    },
    tags: { name: "auth_refresh", kind: "refresh" },
    redirects: 0,
  });

  refreshLatency.add(Date.now() - start, { kind: "refresh" });
  const operationId = response.headers["X-Operation-Id"] || response.headers["x-operation-id"];
  if (!operationId) refreshOperationHeaderMissing.add(1);

  const isExpected = response.status === 204 || response.status === 202 || response.status === 401;
  const passed = check(response, {
    "returns documented refresh contract": () => isExpected,
    "sets no response body with token material": () => !response.body,
    "has opaque operation ID": () => Boolean(operationId),
  });
  if (response.status === 202) refreshLeaseHeld.add(1);
  refreshUnexpectedError.add(!passed || (!isExpected && response.status !== 429));
  sleep(0.1 + Math.random() * 0.4);
}
```

Run through a protected staging job. The cookie input is a short-lived secret from an integration-test harness and must never be committed, echoed, saved in k6 output, or forwarded to Grafana as a label.

```bash
ENVIRONMENT=staging \
BASE_URL=https://staging.bis.example.com \
SYNTHETIC_SESSION_COOKIES_JSON="$(vault-read synthetic-refresh-cookies)" \
k6 run --summary-export=artifacts/k6-refresh-summary.json tests/load/refresh-race.k6.js
```

## 5. P99 Interpretation and Acceptance Workflow

| Outcome | P99 pattern | What to inspect | Decision |
|---|---|---|---|
| Healthy contention | k6 P99 below guardrail; lease-held exists; provider calls approximate acquired leases. | BFF refresh span and lease ratio. | Expected coordination. |
| Database contention | k6 P99 high; `db.refresh_lease.cas` span dominates; provider calls remain controlled. | DB lock/index/query plan, connection pool. | Tune/query remediation; do not relax CAS. |
| Keycloak degradation | Keycloak child span dominates; provider error/timeout rate rises. | Keycloak health, network, circuit breaker, chaos state. | Provider incident path; no retry storm. |
| Race invariant | `race_violation_total > 0` or provider calls exceed acquired lease count. | Audit event, operation ID, release revision, trace graph. | Critical containment and release investigation. |
| Test artifact | Missing operation header or synthetic cookie failure. | Test harness, proxy header config, secret injection. | Fix test/environment before interpreting capacity. |

The final analysis must combine the k6 P99 distribution with the BFF histogram P99 and span-derived duration. The former is user-visible synthetic latency; the latter two identify whether the time occurred at the BFF, the database lease, or Keycloak. A higher k6 P99 alone is not sufficient proof of a refresh race.

## 6. Staging Safety and Abort Conditions

Immediately stop the test if the target environment is not staging, test cookies cannot be proven synthetic, provider/cluster shared limits are approached, unexpected sessions appear in telemetry, an alert is delivered to production channels, or logs/traces contain a test secret. The test must not run concurrently with a Keycloak chaos experiment until the baseline scenario and cleanup checks are both verified.

## References

[1] [Grafana Tempo: Span Metrics](https://grafana.com/docs/tempo/latest/metrics-from-traces/span-metrics/)  
[2] [Grafana: Provision Alerting Resources](https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/)  
[3] [Grafana k6: Thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
