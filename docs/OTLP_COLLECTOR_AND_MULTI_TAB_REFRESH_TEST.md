# OTLP Trace Aggregation and Concurrent Multi-Tab Refresh Testing

**Author:** Manus AI  
**Status:** Implementation reference. The files below are target configuration and test examples. Pin the OpenTelemetry Collector distribution and component versions, validate component availability in CI, and deploy only to a private observability network.

## 1. Secure Trace Aggregation Topology

The BFF sends OTLP traces over mTLS to a private OpenTelemetry Collector service. The Collector applies memory protection, redaction, sampling, batching, and authenticated export to **either** Grafana Tempo **or** Jaeger. It is not internet-facing. OpenTelemetry Collectors model telemetry as receivers, processors, exporters, extensions, and pipelines; the standard OTLP receiver supports gRPC on 4317 and HTTP on 4318. [1]

```text
BFF pods -- mTLS / OTLP --> Collector gateway -- mTLS / OTLP --> Tempo distributor
                                            \-- mTLS / OTLP --> Jaeger collector

Browser → Nginx/Ingress → BFF → PostgreSQL / Keycloak
                                  │
                                  └── only safe spans, trace IDs, operation IDs, and pseudonyms
```

| Boundary | Required protection | Explicitly prohibited |
|---|---|---|
| BFF → Collector | Namespace-only egress, mTLS client authentication, bounded exporter queue and timeout. | Public collector endpoint, plaintext OTLP across untrusted networks. |
| Collector processing | Memory limiter first, sensitive-attribute deletion, approved resource attributes, bounded batch/sampling. | Exporting cookies, Authorization, token/code/verifier/state attributes, raw query strings, raw database parameters. |
| Collector → backend | mTLS and backend authentication stored in Kubernetes Secret; private DNS; retry queue bounded. | Legacy unreviewed Jaeger protocol exporter, public backend credentials in ConfigMap. |
| Human access | SSO/RBAC to Grafana/Jaeger, restricted incident evidence retention. | Sharing trace URLs that expose sensitive fields or joining raw session identifiers. |

## 2. OpenTelemetry Collector Configuration

Use the **contrib** distribution when you need `transform` and tail-sampling processors. Confirm each component against the exact image version in CI with `otelcol-contrib components`. The transform statements below delete known sensitive keys defensively; instrumentation must still avoid creating sensitive attributes in the first place.

```yaml
# observability/otel-collector/collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
        tls:
          cert_file: /etc/otel/tls/tls.crt
          key_file: /etc/otel/tls/tls.key
          client_ca_file: /etc/otel/clients/ca.crt
          client_auth_type: require_and_verify_client_cert
      http:
        endpoint: 0.0.0.0:4318
        tls:
          cert_file: /etc/otel/tls/tls.crt
          key_file: /etc/otel/tls/tls.key
          client_ca_file: /etc/otel/clients/ca.crt
          client_auth_type: require_and_verify_client_cert

processors:
  # Keep this first. Size must be derived from the container memory limit.
  memory_limiter:
    check_interval: 1s
    limit_mib: 384
    spike_limit_mib: 96

  # Defense in depth; use the real, reviewed attribute names from instrumentation tests.
  transform/redact_auth:
    error_mode: ignore
    trace_statements:
      - context: span
        statements:
          - delete_key(attributes, "http.request.header.cookie")
          - delete_key(attributes, "http.request.header.authorization")
          - delete_key(attributes, "http.url")
          - delete_key(attributes, "url.query")
          - delete_key(attributes, "auth.refresh_token")
          - delete_key(attributes, "auth.access_token")
          - delete_key(attributes, "auth.authorization_code")
          - delete_key(attributes, "auth.pkce_verifier")
          - delete_key(attributes, "auth.oidc_state")
          - delete_key(attributes, "db.query.parameter")
          - delete_key(attributes, "exception.stacktrace")

  resource/bis:
    attributes:
      - key: deployment.environment.name
        action: upsert
        value: ${env:DEPLOYMENT_ENVIRONMENT}
      - key: service.namespace
        action: upsert
        value: bis

  # Start with this conservative production policy; adjust only with an approved cost/security review.
  tail_sampling:
    decision_wait: 5s
    num_traces: 20000
    expected_new_traces_per_sec: 250
    policies:
      - name: retain-refresh-errors
        type: status_code
        status_code:
          status_codes: [ERROR]
      - name: retain-refresh-slow
        type: latency
        latency:
          threshold_ms: 750
      - name: retain-auth-routes-probabilistically
        type: probabilistic
        probabilistic:
          sampling_percentage: 10

  batch:
    timeout: 3s
    send_batch_size: 512
    send_batch_max_size: 1024

exporters:
  # Use exactly one backend exporter in each deployed release, selected by Helm values.
  otlp/tempo:
    endpoint: tempo-distributor.observability.svc.cluster.local:4317
    tls:
      ca_file: /etc/otel/backend-ca/ca.crt
      cert_file: /etc/otel/backend-client/tls.crt
      key_file: /etc/otel/backend-client/tls.key
      server_name_override: tempo-distributor.observability.svc.cluster.local
    sending_queue:
      enabled: true
      num_consumers: 4
      queue_size: 2000
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 15s
      max_elapsed_time: 45s

  otlp/jaeger:
    endpoint: jaeger-collector.observability.svc.cluster.local:4317
    tls:
      ca_file: /etc/otel/backend-ca/ca.crt
      cert_file: /etc/otel/backend-client/tls.crt
      key_file: /etc/otel/backend-client/tls.key
      server_name_override: jaeger-collector.observability.svc.cluster.local
    sending_queue:
      enabled: true
      num_consumers: 4
      queue_size: 2000
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 15s
      max_elapsed_time: 45s

extensions:
  health_check:
    endpoint: 0.0.0.0:13133

service:
  extensions: [health_check]
  pipelines:
    traces/tempo:
      receivers: [otlp]
      processors: [memory_limiter, transform/redact_auth, resource/bis, tail_sampling, batch]
      exporters: [otlp/tempo]
    # Alternative deployment profile: remove traces/tempo and enable this pipeline.
    # traces/jaeger:
    #   receivers: [otlp]
    #   processors: [memory_limiter, transform/redact_auth, resource/bis, tail_sampling, batch]
    #   exporters: [otlp/jaeger]
```

Grafana Tempo supports OTLP gRPC or HTTP ingestion from the Collector. [2] For Jaeger, prefer the OTLP exporter rather than the retired Collector Jaeger exporter. [3]

### 2.1 Collector Kubernetes deployment fragment

```yaml
# Key fragments only; inject all certificates from Secrets and enforce NetworkPolicy separately.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bis-otel-gateway
  namespace: observability
spec:
  replicas: 2
  selector:
    matchLabels: { app.kubernetes.io/name: bis-otel-gateway }
  template:
    metadata:
      labels: { app.kubernetes.io/name: bis-otel-gateway }
    spec:
      serviceAccountName: bis-otel-gateway
      containers:
        - name: collector
          image: otel/opentelemetry-collector-contrib:<PINNED_VERSION>
          args: ["--config=/etc/otel/collector-config.yaml"]
          ports:
            - { name: otlp-grpc, containerPort: 4317 }
            - { name: health, containerPort: 13133 }
          resources:
            requests: { cpu: "250m", memory: "512Mi" }
            limits: { cpu: "1", memory: "512Mi" }
          readinessProbe:
            httpGet: { path: /, port: health }
          livenessProbe:
            httpGet: { path: /, port: health }
          securityContext:
            runAsNonRoot: true
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
```

## 3. BFF OTLP Exporter Setup

The BFF is the only component that exports refresh spans. Browser JavaScript does not receive an OTLP endpoint, exporter credential, token, or trace backend URL.

```ts
// server/_core/telemetry.ts — target BFF configuration
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import fs from "node:fs";

const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
if (!endpoint && process.env.NODE_ENV === "production") {
  throw new Error("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is required when production tracing is enabled");
}

const exporter = endpoint
  ? new OTLPTraceExporter({
      url: endpoint,
      // Do not use a bearer token in browser-visible env. Prefer mTLS at the transport boundary.
      credentials: {
        rootCertificates: fs.readFileSync("/var/run/otel/ca.crt"),
        privateKey: fs.readFileSync("/var/run/otel/tls.key"),
        certificateChain: fs.readFileSync("/var/run/otel/tls.crt"),
      },
      timeoutMillis: 5_000,
    })
  : undefined;

export const telemetry = exporter
  ? new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: "bis-bff",
        "deployment.environment.name": process.env.DEPLOYMENT_ENVIRONMENT ?? "unknown",
        "service.version": process.env.GIT_SHA ?? "unknown",
      }),
      spanProcessor: new BatchSpanProcessor(exporter, {
        maxQueueSize: 2048,
        scheduledDelayMillis: 1000,
        exportTimeoutMillis: 5000,
      }),
    })
  : undefined;
```

**Version note:** OpenTelemetry JavaScript exporter option shapes can vary by pinned package version. Keep the code above in a compile-checked telemetry module and use a locally validated mTLS transport configuration. If the chosen exporter does not support the `credentials` object shown above, terminate mTLS at a private sidecar/proxy or use the official transport-specific credential mechanism; do not fall back to unauthenticated public OTLP.

| BFF environment variable | Source | Rule |
|---|---|---|
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | ConfigMap / environment | Internal collector DNS only; no browser exposure. |
| `DEPLOYMENT_ENVIRONMENT` | Deployment metadata | Low-cardinality allowlist: staging, production. |
| `GIT_SHA` | CI release metadata | Immutable revision, not branch name supplied by a client. |
| `TELEMETRY_PSEUDONYMIZATION_KEY` | Secret | Separate from session/TOTP/encryption roots; rotation plan required. |
| mTLS certificate/key/CA | Mounted Secret or workload identity | Not in env, logs, CI output, or client bundle. |

## 4. Automated Multi-Tab Refresh-Race Integration Test

Use **two Playwright browser contexts** with the same authenticated cookie state. They simulate two tabs sharing a session but can hit different BFF pods behind the same ingress. Run the BFF against an ephemeral PostgreSQL database and a fake Keycloak token endpoint that creates a synchronization barrier. Export spans to an in-memory test exporter; this asserts trace structure without needing Tempo or Jaeger in the test.

### 4.1 Test-only seams

```ts
// server/_core/testContracts.ts — imported only by an integration-test bootstrap
export type RefreshTestHarness = {
  onKeycloakRefresh(): Promise<{ accessToken: string; refreshToken: string }>;
  onAudit(event: Record<string, unknown>): Promise<void>;
};

// The production factory receives the actual HTTP Keycloak client and audited event writer.
// The test factory receives a barrier-backed fake. Never create a test bypass in the route itself.
export function createBffApp(deps: { refreshHarness?: RefreshTestHarness }) {
  // Existing application initialization, with interfaces injected at the boundary.
}
```

```ts
// tests/helpers/refreshBarrier.ts
export class RefreshBarrier {
  calls = 0;
  readonly inboundTraceparents: string[] = [];
  private release!: () => void;
  private readonly gate = new Promise<void>(resolve => { this.release = resolve; });

  async tokenExchange(headers: Headers) {
    this.calls += 1;
    const parent = headers.get("traceparent");
    if (parent) this.inboundTraceparents.push(parent);
    // Leave the winning request in-flight long enough for the second context to contend.
    await this.gate;
    return { accessToken: "test-access-token", refreshToken: "test-refresh-token" };
  }

  allowWinnerToComplete() { this.release(); }
}
```

### 4.2 Playwright test

The example uses `204` for the winning refresh and `202` with `Retry-After` for the lease-held path. Align assertions with the finalized BFF contract if it instead uses a short wait or another documented status.

```ts
// tests/e2e/concurrent-refresh-tracing.spec.ts
import { test, expect, chromium } from "@playwright/test";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { RefreshBarrier } from "../helpers/refreshBarrier";
import { startBffForTest, createAuthenticatedStorageState } from "../helpers/bffTestServer";

test("two browser contexts produce one rotation and intact trace/correlation evidence", async () => {
  const spanExporter = new InMemorySpanExporter();
  const barrier = new RefreshBarrier();
  const bff = await startBffForTest({
    postgres: "ephemeral",
    keycloakTokenExchange: headers => barrier.tokenExchange(headers),
    spanProcessor: new SimpleSpanProcessor(spanExporter),
    // Test-only known opaque values; they must be rejected if they appear in a span/log payload.
    seededSession: { refreshToken: "test-refresh-token", sessionFamilyId: "family-test-001" },
  });

  const browser = await chromium.launch();
  const storageState = await createAuthenticatedStorageState(bff.url);
  const tabA = await browser.newContext({ storageState });
  const tabB = await browser.newContext({ storageState });
  const pageA = await tabA.newPage();
  const pageB = await tabB.newPage();

  const refresh = (page: typeof pageA) => page.evaluate(async () => {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "x-test-force-refresh": "1" },
    });
    return {
      status: response.status,
      operationId: response.headers.get("x-operation-id"),
      retryAfter: response.headers.get("retry-after"),
    };
  });

  const pendingA = refresh(pageA);
  await expect.poll(() => barrier.calls).toBe(1);
  const pendingB = refresh(pageB);
  await barrier.allowWinnerToComplete();
  const [a, b] = await Promise.all([pendingA, pendingB]);

  expect([a.status, b.status].sort()).toEqual([202, 204]);
  const winner = a.status === 204 ? a : b;
  const loser = a.status === 202 ? a : b;
  expect(winner.operationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(loser.operationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(loser.retryAfter).toBe("1");
  expect(barrier.calls).toBe(1);

  const spans = spanExporter.getFinishedSpans();
  const refreshSpans = spans.filter(span => span.name === "auth.refresh");
  const keycloakSpans = spans.filter(span => span.name === "http.client.keycloak.token");
  expect(refreshSpans).toHaveLength(2);
  expect(keycloakSpans).toHaveLength(1);

  const attr = (span: (typeof spans)[number], key: string) => span.attributes[key];
  const acquired = refreshSpans.find(span => attr(span, "auth.lease_result") === "acquired");
  const held = refreshSpans.find(span => attr(span, "auth.lease_result") === "held");
  expect(acquired).toBeDefined();
  expect(held).toBeDefined();
  expect(attr(acquired!, "auth.operation_id")).toBe(winner.operationId);
  expect(attr(held!, "auth.operation_id")).toBe(loser.operationId);
  expect(attr(acquired!, "auth.session_family_hash")).toBe(attr(held!, "auth.session_family_hash"));

  // The Keycloak child span must remain in the winner's trace, not the loser's trace.
  expect(keycloakSpans[0].spanContext().traceId).toBe(acquired!.spanContext().traceId);
  expect(barrier.inboundTraceparents).toHaveLength(1);
  expect(barrier.inboundTraceparents[0]).toContain(keycloakSpans[0].spanContext().traceId);

  // Credential-redaction regression: test sentinel values cannot appear in exported attributes.
  const exported = JSON.stringify(spans.map(span => span.attributes));
  expect(exported).not.toContain("test-refresh-token");
  expect(exported).not.toContain("sessionFamilyId");

  await Promise.all([tabA.close(), tabB.close(), browser.close(), bff.stop()]);
});
```

### 4.3 Required companion cases

| Test case | Assertions |
|---|---|
| Winner succeeds, loser waits | One Keycloak call; same pseudonymous family hash; distinct operation IDs; one child Keycloak span. |
| Provider times out | Winner has `provider_timeout`; loser never calls Keycloak; lease clears/expires per policy; no raw error body in spans. |
| `invalid_grant` / expired refresh | Session family is revoked, BFF clears cookie, audit outcome is normalized, high-risk route remains denied, no retry storm. |
| Database failure before lease acquisition | No Keycloak call, BFF returns bounded error, traces preserve causal root, no partial session mutation. |
| Database failure after provider success | Transaction/reconciliation policy is exercised explicitly; no ambiguous second rotation, alert fires, audit state identifies recovery action. |
| Malicious trace headers | Client-supplied malformed/oversized `traceparent` cannot poison span attributes or request attribution. |
| Redaction | Sentinel cookies, tokens, state, code, verifier, email, and SQL parameters do not appear in spans, collector payload fixture, logs, or snapshots. |
| Two BFF replicas | The same test runs through a load-balanced ingress/Service; CAS remains the authority even when requests land on distinct pods. |

## 5. CI Execution Order

Run fast interface/trace tests on every pull request. Run the ephemeral PostgreSQL + two-context test in the protected integration job. Run the actual Collector/Tempo or Collector/Jaeger smoke test in a private staging namespace. Keep test collector traces for a short approved retention window and destroy the test namespace afterward.

```yaml
# GitHub Actions conceptual job sequence
jobs:
  unit-tracing-contracts: { needs: [typecheck] }
  refresh-race-integration: { needs: [unit-tracing-contracts], services: { postgres: {} } }
  collector-sanitization-smoke: { needs: [refresh-race-integration], environment: staging }
  private-trace-backend-smoke: { needs: [collector-sanitization-smoke], environment: staging }
```

## References

[1] [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)  
[2] [Grafana Tempo: Set up the OpenTelemetry Collector](https://grafana.com/docs/tempo/latest/set-up-for-tracing/instrument-send/set-up-collector/otel-collector/)  
[3] [OpenTelemetry: Migrating Away from the Jaeger Exporter in the Collector](https://opentelemetry.io/blog/2023/jaeger-exporter-collector-migration/)
