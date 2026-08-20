# Refresh Token Observability, Disaster Recovery, and Zero-Downtime Lease Migrations

**Author:** Manus AI  
**Status:** Implementation reference. The patterns below assume the server-owned Keycloak refresh-token and PostgreSQL lease design described in the preceding authentication references. They are not yet applied to the BIS repository.

## Executive Design

The operational design has three independent safeguards. First, the BFF emits only bounded-cardinality, non-secret authentication telemetry. Second, an incident can invalidate one session family, all sessions for a Keycloak user, or every BIS session without exposing a token in logs or dashboards. Third, database changes use an **expand–backfill–dual-read/dual-write–contract** sequence so old and new BFF pods remain compatible throughout a rolling deployment.

| Concern | Authoritative state | Failure-safe behavior |
|---|---|---|
| Refresh coordination | PostgreSQL refresh-session row, version, and lease | Do not retry an ambiguous Keycloak refresh; revoke the affected session family. |
| Browser session | Short-lived signed `HttpOnly` cookie | Cookie stores no Keycloak token and is invalidated when session version/epoch changes. |
| Metrics | Prometheus counter/histogram/gauge series with bounded labels | Never emit a user ID, session ID, email, Keycloak subject, refresh token, authorization code, verifier, IP, or raw error message as a label. |
| Alerting | Grafana-managed alert rules routed through Alertmanager/on-call | Page on user-visible refresh failure, not every transient provider error. |
| Compromise response | Audited session-family revocation plus Keycloak logout/revocation | Contain first; force reauthentication rather than attempting token reuse. |
| Schema release | PostgreSQL expand–contract migration with feature gate | Additive fields and concurrent indexes precede any required runtime behavior. |

Prometheus naming guidance recommends a single application prefix, base units, `_total` for counters, and labels only for bounded dimensions. It cautions against high-cardinality labels such as user IDs and email addresses. [1]

## 1. BFF Prometheus Metrics

### 1.1 Instrumentation package and endpoint

Install a maintained Node Prometheus client in the BFF runtime:

```bash
pnpm add prom-client
```

Expose `/internal/metrics` only through a Kubernetes `ClusterIP` Service protected by NetworkPolicy and a `ServiceMonitor`/`PodMonitor`. Do **not** route it through the public Nginx Ingress, and do not add a `VITE_*` endpoint.

```ts
// server/observability/metrics.ts
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "bis_process_" });

const refreshOutcomes = [
  "success",
  "lease_busy",
  "stale_cookie",
  "session_revoked",
  "provider_invalid_grant",
  "provider_timeout",
  "provider_unavailable",
  "database_unavailable",
  "subject_mismatch",
  "csrf_rejected",
] as const;

type RefreshOutcome = (typeof refreshOutcomes)[number];

export const refreshAttempts = new Counter<"outcome">({
  name: "bis_auth_refresh_attempts_total",
  help: "Completed BFF refresh attempts by bounded outcome.",
  labelNames: ["outcome"],
  registers: [registry],
});

export const refreshDuration = new Histogram<"outcome">({
  name: "bis_auth_refresh_duration_seconds",
  help: "End-to-end BFF refresh duration by bounded outcome.",
  labelNames: ["outcome"],
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 8, 12],
  registers: [registry],
});

export const refreshLeaseClaims = new Counter<"result">({
  name: "bis_auth_refresh_lease_claims_total",
  help: "PostgreSQL compare-and-swap refresh lease claim outcomes.",
  labelNames: ["result"], // claimed | busy | stale_version | expired_reclaimed
  registers: [registry],
});

export const refreshSessionRevocations = new Counter<"reason">({
  name: "bis_auth_refresh_session_revocations_total",
  help: "Refresh session-family revocations by bounded security reason.",
  labelNames: ["reason"], // invalid_grant | ambiguous_provider_timeout | subject_mismatch | manual | global_epoch
  registers: [registry],
});

export const refreshLeasesActive = new Gauge({
  name: "bis_auth_refresh_leases_active",
  help: "Number of nonexpired refresh leases observed by the periodic BFF database query.",
  registers: [registry],
});

export const refreshLastSuccess = new Gauge({
  name: "bis_auth_refresh_last_success_timestamp_seconds",
  help: "Unix timestamp of the most recent successful refresh observed by this BFF pod.",
  registers: [registry],
});

export function observeRefresh(outcome: RefreshOutcome, startedAtMs: number) {
  refreshAttempts.inc({ outcome });
  refreshDuration.observe({ outcome }, (Date.now() - startedAtMs) / 1000);
  if (outcome === "success") refreshLastSuccess.set(Date.now() / 1000);
}
```

```ts
// server/observability/metricsRoute.ts
import type { Express, Request, Response } from "express";
import { registry } from "./metrics";

export function registerMetricsRoute(app: Express) {
  app.get("/internal/metrics", async (_req: Request, res: Response) => {
    res.set("Content-Type", registry.contentType);
    res.set("Cache-Control", "no-store");
    res.end(await registry.metrics());
  });
}
```

Instrument every terminal branch in `/api/auth/refresh` exactly once. In particular, emit `lease_busy` when a sibling pod owns the lease, `provider_invalid_grant` when Keycloak rejects rotation, and `subject_mismatch` when the refreshed access token’s `sub` no longer matches the stored Keycloak subject. Log stable correlation IDs separately in the protected log system; do not promote them to Prometheus labels.

### 1.2 Additional health signals

| Metric or source | Interpretation | Label rule |
|---|---|---|
| `bis_auth_refresh_attempts_total` | Refresh outcome volume and error ratio. | `outcome` only from the fixed list. |
| `bis_auth_refresh_duration_seconds` | Provider/database/lease path latency. | `outcome` only. |
| `bis_auth_refresh_lease_claims_total` | Cross-tab and cross-replica contention. | Fixed `result` list. |
| `bis_auth_refresh_session_revocations_total` | Security event volume. | Fixed `reason` list. |
| `bis_process_*` | Node runtime process health. | No tenant or user dimension. |
| `up{job="bis-bff"}` | Prometheus can scrape the BFF. | Standard scrape labels only. |
| `kube_deployment_status_replicas_available` | Available BFF/Nginx replicas. | Deployment and namespace are bounded. |
| `kube_pod_container_status_restarts_total` | Crash/restart signal. | Pod labels should be aggregated away in alerts. |
| PostgreSQL exporter replication/connection metrics | Database and failover health. | Never use session/user identifiers. |

## 2. Prometheus Scrape and Grafana Alert Configuration

### 2.1 ServiceMonitor

This example assumes Prometheus Operator. If the cluster uses static scrape configuration, use the same internal `ClusterIP` Service and port instead.

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: bis-bff
  labels:
    release: kube-prometheus-stack
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: bis-auth
      app.kubernetes.io/component: bff
  endpoints:
    - port: metrics
      path: /internal/metrics
      interval: 30s
      scrapeTimeout: 10s
      scheme: http
```

Do not rely on `up` alone. Prometheus recommends alerting primarily on symptoms associated with user pain and keeping alerts actionable; provider or database cause alerts should support investigation rather than create duplicate pages. [2]

### 2.2 Grafana alert groups

Provision Grafana alert rules as code, or translate the expressions below into a `PrometheusRule` if Alertmanager is the cluster standard. Grafana Alerting can manage and route metric-based alerts from a centralized interface. [3]

```yaml
# monitoring/grafana/bis-auth-alerts.yaml
apiVersion: 1
groups:
  - orgId: 1
    name: bis-auth-refresh
    folder: BIS Authentication
    interval: 1m
    rules:
      - uid: bis-auth-refresh-user-impact
        title: BffRefreshUserImpactHigh
        condition: C
        data:
          - refId: A
            datasourceUid: prometheus
            relativeTimeRange: { from: 600, to: 0 }
            model:
              expr: |
                sum(rate(bis_auth_refresh_attempts_total{outcome=~"provider_invalid_grant|provider_timeout|provider_unavailable|database_unavailable|subject_mismatch"}[5m]))
                /
                clamp_min(sum(rate(bis_auth_refresh_attempts_total[5m])), 0.1)
              instant: true
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: gt, params: [0.05] }
                  operator: { type: and }
                  reducer: { type: last, params: [] }
        for: 10m
        labels: { severity: page, service: bis-bff }
        annotations:
          summary: "More than 5% of BFF refresh requests are failing"
          runbook_url: "https://runbooks.example.com/bis/auth-refresh-failure"

      - uid: bis-auth-refresh-revocations
        title: BffRefreshSessionRevocationSpike
        condition: C
        data:
          - refId: A
            datasourceUid: prometheus
            relativeTimeRange: { from: 300, to: 0 }
            model:
              expr: sum(increase(bis_auth_refresh_session_revocations_total[5m]))
              instant: true
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: gt, params: [3] }
                  operator: { type: and }
                  reducer: { type: last, params: [] }
        for: 2m
        labels: { severity: page, service: bis-bff, security: "true" }
        annotations:
          summary: "Refresh token session revocations exceed normal baseline"
          runbook_url: "https://runbooks.example.com/bis/refresh-token-compromise"

      - uid: bis-auth-refresh-lease-contention
        title: BffRefreshLeaseContentionHigh
        condition: C
        data:
          - refId: A
            datasourceUid: prometheus
            relativeTimeRange: { from: 600, to: 0 }
            model:
              expr: |
                sum(rate(bis_auth_refresh_lease_claims_total{result="busy"}[5m]))
                /
                clamp_min(sum(rate(bis_auth_refresh_lease_claims_total[5m])), 0.1)
              instant: true
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: gt, params: [0.20] }
                  operator: { type: and }
                  reducer: { type: last, params: [] }
        for: 15m
        labels: { severity: warning, service: bis-bff }
        annotations:
          summary: "More than 20% of refresh lease claims are contended"

      - uid: bis-bff-not-ready
        title: BffReplicaAvailabilityLow
        condition: C
        data:
          - refId: A
            datasourceUid: prometheus
            relativeTimeRange: { from: 300, to: 0 }
            model:
              expr: |
                kube_deployment_status_replicas_available{deployment=~".*bis-auth.*bff"}
                < 2
              instant: true
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: gt, params: [0] }
                  operator: { type: and }
                  reducer: { type: last, params: [] }
        for: 5m
        labels: { severity: page, service: bis-bff }
        annotations:
          summary: "Fewer than two BFF replicas are available"

      - uid: bis-bff-scrape-failed
        title: BffMetricsUnavailable
        condition: C
        data:
          - refId: A
            datasourceUid: prometheus
            relativeTimeRange: { from: 300, to: 0 }
            model: { expr: 'min(up{job="bis-bff"})', instant: true }
          - refId: C
            datasourceUid: __expr__
            model:
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: lt, params: [1] }
                  operator: { type: and }
                  reducer: { type: last, params: [] }
        for: 5m
        labels: { severity: warning, service: bis-bff }
        annotations:
          summary: "Prometheus cannot scrape at least one BFF target"
```

### 2.3 Dashboard panels

| Panel | PromQL | Operational question |
|---|---|---|
| Refresh success ratio | `sum(rate(...{outcome="success"}[5m])) / sum(rate(...[5m]))` | Are users being silently logged out? |
| Failure outcome breakdown | `sum by (outcome) (rate(bis_auth_refresh_attempts_total[5m]))` | Is the failure provider, database, lease, CSRF, or security related? |
| p95 refresh duration | `histogram_quantile(0.95, sum by (le) (rate(bis_auth_refresh_duration_seconds_bucket[5m])))` | Is Keycloak or the database delaying session recovery? |
| Lease contention ratio | `sum(rate(...{result="busy"}[5m])) / sum(rate(...[5m]))` | Are refreshes storming across tabs or replicas? |
| Revocations by reason | `sum by (reason) (increase(bis_auth_refresh_session_revocations_total[1h]))` | Is there a compromise/reuse anomaly? |
| Availability | `kube_deployment_status_replicas_available` and `up` | Are enough BFF/Nginx instances ready and scrapeable? |

## 3. Disaster-Recovery and Token-Invalidation Runbooks

### 3.1 Severity and evidence handling

Treat a refresh-token compromise or a suspected refresh-token reuse event as a security incident. Preserve UTC timestamps, request correlation IDs, BFF pod identity, Keycloak event IDs, and bounded metrics. **Do not** collect or paste access tokens, refresh tokens, authorization codes, decrypted ciphertext, or PKCE verifiers into tickets, dashboards, shell history, or chat.

| Scenario | Initial severity | First safe action |
|---|---|---|
| Single user reports an unexpected logout or alert shows one `invalid_grant` | Investigate | Revoke only the affected session family and require reauthentication. |
| Multiple revocations, subject mismatches, or suspected token reuse | Page security/on-call | Freeze refresh issuance for affected session family or tenant, revoke sessions, inspect Keycloak audit events. |
| Token-encryption key exposure | Critical security incident | Disable refresh path, revoke all affected BFF sessions, rotate encryption and signing roots, force interactive login. |
| PostgreSQL primary failover with no data loss | Major availability incident | Readiness fails closed; wait for a confirmed writable primary, then resume. |
| PostgreSQL restore/PITR where session rows may be stale | Critical integrity incident | Increment global session epoch and revoke all BFF refresh sessions before reopening refresh. |

### 3.2 Local session-family invalidation

Expose this only as an audited, dual-authorized administrative operation—not an unauthenticated SQL console endpoint. The operator records an incident ID and a mandatory note. The BFF must clear the user’s BIS cookie on the next request and record `manual` as the bounded revocation reason.

```sql
BEGIN;
UPDATE keycloak_refresh_sessions
SET revoked_at = now(),
    revoke_reason = 'incident_INC_12345',
    refresh_lease_id = NULL,
    refresh_lease_expires_at = NULL,
    updated_at = now()
WHERE id = :refresh_session_id
  AND revoked_at IS NULL;

INSERT INTO event_log (event_type, actor_id, subject_id, payload, created_at)
VALUES (
  'auth.refresh_session_revoked',
  :incident_commander_id,
  :affected_user_id,
  jsonb_build_object('incidentId', 'INC-12345', 'reason', 'suspected_compromise'),
  now()
);
COMMIT;
```

After local invalidation, use the Keycloak Admin API or a predefined realm action to terminate the affected user’s server-side sessions. Keycloak is the provider authority; local invalidation alone prevents BIS refresh but does not necessarily invalidate an extant Keycloak SSO session.

### 3.3 Global BFF session invalidation

Maintain a singleton `auth_security_state` row with `global_session_epoch`. Include this epoch in every issued BIS session cookie and compare it during cookie validation.

```sql
CREATE TABLE IF NOT EXISTS auth_security_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  global_session_epoch bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint
);

INSERT INTO auth_security_state (id) VALUES (true) ON CONFLICT DO NOTHING;
```

During a global compromise, increment the epoch in one transaction, revoke active refresh rows, rotate the token-encryption key and session-signing root through the secret manager, and request Keycloak realm/session logout. This forces all BIS sessions to reauthenticate without maintaining an unbounded cookie denylist.

```sql
BEGIN;
UPDATE auth_security_state
SET global_session_epoch = global_session_epoch + 1,
    updated_at = now(),
    updated_by = :security_operator_id
WHERE id = true;

UPDATE keycloak_refresh_sessions
SET revoked_at = now(),
    revoke_reason = 'global_compromise_epoch',
    refresh_lease_id = NULL,
    refresh_lease_expires_at = NULL,
    updated_at = now()
WHERE revoked_at IS NULL;
COMMIT;
```

### 3.4 Database failover runbook

1. **Detect and declare.** Alert on BFF readiness failures, PostgreSQL exporter replica/primary health, and a rise in `database_unavailable` refresh outcomes. Assign incident commander and database owner.
2. **Contain.** Leave BFF liveness green if the process is healthy but make `/readyz` fail when the database is unavailable. Kubernetes removes unready pods from Service endpoints; it should not repeatedly kill otherwise healthy pods. Readiness probes are intended to stop traffic to temporarily unavailable containers, while liveness probes handle processes requiring restart. [4]
3. **Freeze ambiguous rotation.** A pod that timed out after sending Keycloak a refresh request must not retry the old token after reconnection. Revoke that session family and require login.
4. **Fail over.** Promote only the database platform’s verified primary. Confirm the BFF connection string now resolves to the writable endpoint; do not edit BFF pods manually.
5. **Validate.** Run bounded checks: `SELECT 1`, active lease count, oldest lease timestamp, session-table write, Keycloak discovery reachability, and one synthetic login/refresh in a non-production test account.
6. **Recover.** Restart only BFF pods with stale connection pools after the database endpoint is healthy. Watch refresh error ratio, lease contention, and revocations for at least the established incident observation window.
7. **If PITR/replication loss occurred.** Do not trust potentially resurrected refresh rows. Increment `global_session_epoch`, revoke all rows, rotate encryption/signing credentials if their integrity is uncertain, and require all users to login again.
8. **Close.** Preserve sanitized metrics, database event timeline, and audit events. Open follow-up issues for RPO/RTO gaps and failed automation.

## 4. Zero-Downtime Refresh-Lease Schema Migration

### 4.1 Preconditions

The database must be PostgreSQL 16 or later, PITR/backups must be verified, and BFF deployment must support a feature flag such as `REFRESH_LEASES_ENABLED=false`. Perform the migration on a staging clone under refresh concurrency before production. This strategy intentionally avoids a table rewrite, long write lock, dropping an active column, or mixing `CREATE INDEX CONCURRENTLY` inside a transaction.

PostgreSQL documents that `CREATE INDEX CONCURRENTLY` allows inserts, updates, and deletes while an index is built, but it cannot run inside a transaction block and may leave an invalid index after failure that must be dropped or rebuilt. [5]

### 4.2 Phase A — Expand (release A compatible with old schema)

Release A can read old rows and treats missing/`NULL` lease data as no lease and missing version as version 1. Keep the feature flag disabled.

```sql
-- 0061_refresh_lease_expand.sql
ALTER TABLE keycloak_refresh_sessions
  ADD COLUMN IF NOT EXISTS refresh_version integer,
  ADD COLUMN IF NOT EXISTS refresh_lease_id uuid,
  ADD COLUMN IF NOT EXISTS refresh_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS session_epoch bigint;

-- Short lock, metadata-only addition of nullable columns. Set bounded lock timeout.
SET lock_timeout = '3s';
SET statement_timeout = '30s';
```

Do not add a non-null default to a large live table in the first expansion step. Do not rename or remove legacy refresh/session fields.

Create indexes in a separate non-transactional migration/job:

```sql
-- 0062_refresh_lease_indexes_concurrently.sql
SET lock_timeout = '3s';
SET statement_timeout = '15m';

CREATE INDEX CONCURRENTLY IF NOT EXISTS keycloak_refresh_sessions_active_user_idx
  ON keycloak_refresh_sessions (user_id, updated_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS keycloak_refresh_sessions_live_lease_idx
  ON keycloak_refresh_sessions (refresh_lease_expires_at)
  WHERE revoked_at IS NULL AND refresh_lease_expires_at IS NOT NULL;
```

If a concurrent build fails, inspect `pg_index.indisvalid`, drop the invalid index with `DROP INDEX CONCURRENTLY`, address the cause, and rerun. Never hide a failed index build behind `IF NOT EXISTS` alone.

### 4.3 Phase B — Backfill incrementally

Use an idempotent worker with small commits. It must not execute one table-wide update in a long transaction.

```sql
-- Repeated by an authenticated migration worker until zero rows remain.
WITH batch AS (
  SELECT id
  FROM keycloak_refresh_sessions
  WHERE refresh_version IS NULL OR session_epoch IS NULL
  ORDER BY id
  LIMIT 500
  FOR UPDATE SKIP LOCKED
)
UPDATE keycloak_refresh_sessions s
SET refresh_version = COALESCE(s.refresh_version, 1),
    session_epoch = COALESCE(s.session_epoch, (SELECT global_session_epoch FROM auth_security_state WHERE id = true)),
    updated_at = now()
FROM batch
WHERE s.id = batch.id;
```

Track batches with `bis_auth_refresh_migration_rows_total{phase="backfill"}` and a database count query. Do not use a user/session ID label.

### 4.4 Phase C — Dual behavior and feature activation

Deploy release B everywhere before enabling the lease flag. It must:

1. Read both legacy rows and expanded rows.
2. Issue a cookie with `refreshVersion` and `sessionEpoch` when data exist.
3. Continue legacy refresh behavior only while `REFRESH_LEASES_ENABLED=false`.
4. On enabled pods, require a non-null version/epoch and execute the PostgreSQL compare-and-swap claim.
5. Emit separate metrics for legacy fallback; that value must reach zero before the contract phase.

Enable the feature flag gradually—one canary pod, then a small traffic segment, then all replicas. Watch refresh success ratio, `lease_busy`, latency, and `invalid_grant`/revocation rate at each increment. A rollback is a flag rollback, not a schema rollback.

### 4.5 Phase D — Contract after the compatibility window

Only after every active row is backfilled and no legacy cookies remain, add check constraints as `NOT VALID`, validate them online, and retain the additive columns for an agreed recovery window.

```sql
ALTER TABLE keycloak_refresh_sessions
  ADD CONSTRAINT keycloak_refresh_sessions_version_present
  CHECK (refresh_version IS NOT NULL) NOT VALID;
ALTER TABLE keycloak_refresh_sessions
  VALIDATE CONSTRAINT keycloak_refresh_sessions_version_present;

ALTER TABLE keycloak_refresh_sessions
  ADD CONSTRAINT keycloak_refresh_sessions_epoch_present
  CHECK (session_epoch IS NOT NULL) NOT VALID;
ALTER TABLE keycloak_refresh_sessions
  VALIDATE CONSTRAINT keycloak_refresh_sessions_epoch_present;
```

Retaining validated check constraints is often safer than immediately converting to `NOT NULL` during an active release. Contract removals—legacy fields, legacy code path, or old cookies—require a separate release, backup verification, and an explicit rollback decision.

### 4.6 Migration decision table

| Observation | Action | Safe rollback |
|---|---|---|
| Additive column migration blocks past lock timeout | Abort; do not retry in a tight loop; inspect long transactions. | No data change to undo. |
| Concurrent index becomes invalid | Drop invalid index concurrently, fix cause, retry. | Existing queries continue using prior indexes. |
| Backfill error | Stop worker, correct code/data, resume idempotent batches. | Values already backfilled are valid and can remain. |
| Canary raises refresh errors | Disable `REFRESH_LEASES_ENABLED`; retain expanded schema. | Old compatible behavior resumes. |
| Provider timeout after lease claim | Revoke affected session family; do not retry old token. | Reauthentication only. |
| PITR before migration/backfill | Treat refresh rows as potentially stale; increment global session epoch. | Force new login; do not reconstruct token state manually. |

## 5. Test and Drill Requirements

| Drill | Acceptance criterion |
|---|---|
| Prometheus metric test | Every refresh terminal branch increments one bounded outcome and records one duration; no metric sample contains a secret or identifier. |
| Alert rule test | `promtool test rules` or Grafana provisioning test proves page/warning thresholds trigger only after their `for` duration. |
| Two-pod concurrency test | Two BFF processes plus ten concurrent clients yield exactly one mocked Keycloak refresh and monotonically increasing lease version. |
| Provider ambiguity test | Simulated timeout after provider request revokes one family and never repeats the old refresh token. |
| Targeted compromise drill | Single-session revocation blocks refresh, clears cookie next request, produces immutable audit event, and does not affect another user. |
| Global compromise drill | Epoch increment invalidates all old cookies; BFF refuses old version/epoch after rolling restart. |
| Database failover drill | Existing pods become unready, no duplicate refresh occurs after reconnect, and synthetic re-login succeeds after the new primary is writable. |
| Migration soak test | Expand/backfill/canary/contract sequence runs under production-like refresh load without query error, duplicate rotation, or write outage. |

## References

[1] [Prometheus: Metric and Label Naming](https://prometheus.io/docs/practices/naming/)  
[2] [Prometheus: Alerting Best Practices](https://prometheus.io/docs/practices/alerting/)  
[3] [Grafana Alerting Documentation](https://grafana.com/docs/grafana/latest/alerting/)  
[4] [Kubernetes: Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)  
[5] [PostgreSQL: CREATE INDEX and Concurrent Index Builds](https://www.postgresql.org/docs/current/sql-createindex.html)  
[6] [Kubernetes: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
