# Helm Rolling Deployment and Trace Observability

## Release boundary

This runbook deploys only digest-pinned BFF and gateway images. It assumes the administrator has already applied the cluster-owned RBAC/network policy in `infra/kubernetes/bis-production-rbac-and-networkpolicy.yaml`, created the BFF and gateway runtime secrets outside Git, and validated the required PostgreSQL, Permify, KMS, Keycloak, Redis, Kafka, and metrics dependencies.

> Do not use image tags such as `latest` or source builds on cluster nodes. The Helm templates reject empty/non-digest image inputs.

## Required pre-deployment state

| Item | Owner | Required condition |
|---|---|---|
| Namespace | Platform administrator | `bis-production` exists and is subject to approved policy enforcement. |
| Service accounts | Platform administrator | `bis-bff` and `bis-gateway` exist with token automount disabled; no broad cluster role binding exists. |
| Runtime secrets | Secret-management operator | `bis-bff-runtime` and `bis-gateway-runtime` exist; values are never copied into values files. |
| Images | Release manager | Immutable BFF/gateway digests have provenance/SCA/CI approval. |
| Observability | SRE | Prometheus protected scrape, Alertmanager route, and Grafana datasource are ready. |

Create secret objects using the approved external-secret controller or a controlled `kubectl create secret` session; do not place real values in shell history. The BFF secret requires its database, evidence/KMS, Permify, Keycloak, observability, and permitted provider configuration. The gateway secret requires `BIS_GATEWAY_KEY`, required fail-closed dependency configuration, and metrics credential.

## Rendering and rolling deployment

```bash
export BFF_DIGEST='sha256:<64 lowercase hex characters>'
export GATEWAY_DIGEST='sha256:<64 lowercase hex characters>'
helm lint charts/bis
helm template bis charts/bis --namespace bis-production \
  --set images.bff.digest="$BFF_DIGEST" \
  --set images.gateway.digest="$GATEWAY_DIGEST" \
  > /tmp/bis-rendered.yaml
kubectl apply --server-side --dry-run=server -f /tmp/bis-rendered.yaml
helm upgrade --install bis charts/bis --namespace bis-production --create-namespace \
  --set images.bff.digest="$BFF_DIGEST" \
  --set images.gateway.digest="$GATEWAY_DIGEST" \
  --atomic --timeout 10m
```

The `RollingUpdate` strategy uses `maxUnavailable: 0`, `maxSurge: 1`, readiness/startup/liveness probes, a 600-second progress deadline, three replicas, and a `minAvailable: 2` disruption budget. `--atomic` automatically rolls the Helm release back when rollout/probe readiness fails. It does not replace the separate PostgreSQL migration backup/restore gate.

## Required post-deployment verification

```bash
kubectl rollout status deployment/bis-bff -n bis-production --timeout=10m
kubectl rollout status deployment/bis-gateway -n bis-production --timeout=10m
kubectl get pods -n bis-production -l app.kubernetes.io/instance=bis
kubectl auth can-i --as=system:serviceaccount:bis-production:bis-bff get secrets -n bis-production
kubectl auth can-i --as=system:serviceaccount:bis-production:bis-gateway create deployments.apps -n bis-production
```

The final two checks must answer **no**. Inspect the deployed container image digests and confirm `automountServiceAccountToken: false`, `runAsNonRoot`, dropped capabilities, read-only root filesystem, and `RuntimeDefault` seccomp profile.

## Trace metrics and alert queries

The gateway exports only bounded metrics and never labels them with trace IDs, request IDs, account IDs, or tenant IDs.

| Signal | PromQL | Alert gate |
|---|---|---|
| p95 request latency | `histogram_quantile(0.95, sum(rate(bis_gateway_trace_request_duration_seconds_bucket[10m])) by (le))` | Warning above 2 seconds for 10 minutes. |
| p99 request latency | `histogram_quantile(0.99, sum(rate(bis_gateway_trace_request_duration_seconds_bucket[5m])) by (le))` | Critical above 10 seconds for 5 minutes. |
| Invalid trace context | `sum(rate(bis_gateway_trace_correlation_total{outcome="invalid_replaced"}[10m])) / clamp_min(sum(rate(bis_gateway_trace_correlation_total[10m])), 1)` | Warning above 1% for 10 minutes. |
| Correlation continuity loss indicator | `sum(rate(bis_gateway_trace_correlation_total{outcome="new_root"}[10m])) / clamp_min(sum(rate(bis_gateway_trace_correlation_total[10m])), 1)` | Warning above 50% for 15 minutes; distinguish direct callers from BFF/worker loss. |

After rollout, issue an authenticated synthetic request with a valid W3C `traceparent`, verify the response has the same trace ID but a different span ID plus an `X-Request-ID`, and verify the gateway log contains only the sanitized IDs. Then verify `bis_gateway_trace_correlation_total{outcome="continued"}` increments. Repeat with malformed trace context and verify `invalid_replaced` increments; it must never echo the malformed value.

## Rollback and containment

For failed readiness, latency, invalid-context, or correlation-drop gates, stop rollout and run `helm rollback bis <previous_revision> --namespace bis-production --wait --timeout 10m`. Preserve pod logs, sanitized trace/request IDs, image digests, alert state, and deployment revision. Do not disable trace validation, network policy, RBAC, KMS, or authorization checks to force a deployment through.
