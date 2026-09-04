# Gateway Fail-Closed Controls and Parquet Cold-Archive Operations Runbook

**Owner:** Platform Reliability and Financial Integrity
**Applies to:** `services/gateway`, `services/cold-archive-writer`, PostgreSQL, S3-compatible cold storage, Permify, Kafka, and Redis.
**Release baseline:** `f59ad75` plus the forward migration `0001_cold_archive_parquet`.

## 1. Operational contract

The gateway is intentionally **fail closed**. It must not authorize a protected request when Permify is unavailable, and it must not accept a protected rate-limited operation when Redis is unavailable. It must also return a dependency error to a business handler that requires durable Kafka/DLQ event delivery. The cold-archive worker is deliberately isolated from the Node BFF: it marks a transaction cold only after PostgreSQL batch ownership, Parquet serialization, S3-compatible object verification, manifest persistence, and the final PostgreSQL commit all succeed.

> **Do not weaken a 401, 403, or 503 issued by these controls to restore availability.** That converts a dependency incident into an authorization, rate-limit, or audit-integrity incident.

| Component | Required configuration | Safe failure response | Data-integrity boundary |
|---|---|---|---|
| Permify | `PERMIFY_URL`, `PERMIFY_TENANT_ID`, `PERMIFY_API_KEY` | Protected request receives 503 when policy service is unavailable; explicit denial is 403. | The downstream handler is not called. |
| Redis | `REDIS_ADDR`, `REDIS_PASSWORD` | Rate-limited/session/DLQ operations return dependency failure; cache-only reads may be treated as a miss only by explicitly designated callers. | No request gets an automatic rate-limit allowance on backend failure. |
| Kafka/DLQ | `KAFKA_BROKERS`, durable Kafka cluster, Redis only as durable DLQ | Durable business operation receives 503 when neither primary topic nor durable DLQ accepts its event. | No in-memory DLQ fallback exists. |
| Parquet worker | PostgreSQL URL and all `BIS_ARCHIVE_S3_*` variables | Worker exits non-zero, records `failed`, and leaves source transactions unarchived. | `archivedTier='cold'` occurs only after object/manifest verification. |

## 2. Monitoring baseline and required telemetry

The current worker emits structured JSON log events and retains durable batch state in PostgreSQL. The gateway currently emits dependency-state logs but does **not** yet expose dedicated Prometheus counters for Permify, Kafka, and Redis fail-closed outcomes. Until those counters are added, use the log queries and PostgreSQL queries below as the authoritative monitoring baseline. The alerting work item `OBS-001` should add the proposed metrics before unrestricted production promotion.

### 2.1 Worker event log contract

| Event | Required fields | Operational meaning |
|---|---|---|
| `cold archive skipped; another worker holds the lock` | timestamp | A run did not start because a prior worker holds the PostgreSQL advisory lock. One occurrence can be normal; persistent occurrences require investigation. |
| `planned cold archive batch` | `batch_id`, `rows`, `object_key` | PostgreSQL selected and claimed a finite immutable set of transactions. |
| `cold archive committed` | `batch_id`, `rows`, `bytes`, `object_key`, `sha256` | Object/manifest validation and PostgreSQL source-state commit succeeded. |
| `cold archive configuration invalid` | error | The worker did not start; configuration is incomplete or violates the TLS/PostgreSQL policy. |
| `cold archive failed` | error | The job ended non-zero; inspect `cold_archive_batches.error_detail` before retrying. |

### 2.2 Database-derived archive metrics

Configure the PostgreSQL exporter or a scheduled read-only monitoring query to emit the following metrics. The monitoring identity may only `SELECT` these tables.

```sql
-- bis_cold_archive_batches_total{status}
SELECT status, COUNT(*)::bigint AS value
FROM cold_archive_batches
GROUP BY status;

-- bis_cold_archive_oldest_inflight_seconds
SELECT COALESCE(EXTRACT(EPOCH FROM NOW() - MIN(created_at)), 0)::bigint AS value
FROM cold_archive_batches
WHERE status IN ('planned', 'uploading', 'verified');

-- bis_cold_archive_failed_total_24h
SELECT COUNT(*)::bigint AS value
FROM cold_archive_batches
WHERE status IN ('failed', 'quarantined')
  AND created_at >= NOW() - INTERVAL '24 hours';

-- bis_cold_archive_committed_rows_24h
SELECT COALESCE(SUM(row_count), 0)::bigint AS value
FROM cold_archive_batches
WHERE status = 'committed'
  AND committed_at >= NOW() - INTERVAL '24 hours';

-- bis_cold_archive_unassigned_eligible_rows
SELECT COUNT(*)::bigint AS value
FROM transactions
WHERE "archivedTier" IS NULL
  AND "coldArchiveBatchId" IS NULL
  AND "createdAt" < NOW() - INTERVAL '365 days'
  AND status::text IN ('completed', 'failed', 'reversed', 'blocked');
```

### 2.3 Required gateway metrics: `OBS-001`

Before general availability, instrument the following Prometheus counters and histogram in `services/gateway`. These names are **required design targets**, not claims about the current code.

| Metric | Labels | Alert purpose |
|---|---|---|
| `bis_gateway_dependency_fail_closed_total` | `dependency={permify,redis,kafka,durable_dlq}`, `operation`, `http_status` | Detect protection or durable-event requests rejected because a dependency cannot prove safety. |
| `bis_gateway_authorization_decisions_total` | `decision={allowed,denied,unavailable}`, `resource_type`, `permission` | Detect policy outages and denial spikes separately. |
| `bis_gateway_rate_limit_decisions_total` | `decision={allowed,limited,unavailable}`, `route` | Detect Redis-controlled abuse protection outages and tuning needs. |
| `bis_gateway_event_delivery_total` | `outcome={primary_ack,dlq_ack,failed}`, `topic`, `operation` | Detect audit delivery degradation before it causes business rejection. |
| `bis_gateway_dependency_latency_seconds` | `dependency`, `operation` | Detect degradation before fail-closed rejection rates increase. |

Until `OBS-001` is deployed, create log-derived counters from the gateway’s `authorization_unavailable`, `rate_limit_unavailable`, `Kafka initialization failed`, `durable DLQ unavailable`, and `Permify is not fully configured` messages. Alert rules must preserve dependency and route context while redacting all identities, tokens, request bodies, and transaction values.

## 3. Alerts and service objectives

| Priority | Condition | Initial threshold | First response |
|---|---|---:|---|
| P1 | Archive worker exits non-zero or `cold_archive_batches.status='quarantined'` | Any occurrence | Stop scheduled retries; preserve object and database evidence; page Financial Integrity. |
| P1 | `bis_gateway_dependency_fail_closed_total` for Permify/Redis/Kafka | >0 for 5 minutes on protected or financial routes | Page on-call; dependency incident, not a reason to bypass enforcement. |
| P1 | Oldest archive batch in `planned/uploading/verified` | >30 minutes | Stop concurrent manual runs; inspect batch and object key; recover same batch only. |
| P2 | No `committed` archive batch | >26 hours when eligible row count >0 | Check CronJob schedule, image revision, object-store policy, PostgreSQL lock. |
| P2 | DLQ acknowledgment share | >1% of events for 10 minutes | Investigate Kafka availability/partition leadership and Redis DLQ capacity. |
| P2 | Eligible cold rows increasing daily | >10% day-over-day | Check worker capacity, cutoff, batch size, and failed batches. |
| P3 | Explicit Permify denials increase | >3× 7-day baseline | Review deployment, policy changes, caller authorization, and resource mapping. |

## 4. Standard operational procedures

### 4.1 Pre-deployment checklist

The platform operator must first apply the forward PostgreSQL migration. The migration is checksum-verified and refuses incompatible state.

```bash
DATABASE_URL="$DATABASE_URL" pnpm exec tsx scripts/migrate-postgres.ts
```

Confirm the manifest schema, then deploy the worker image and schedule. The S3-compatible bucket must be created outside the worker with TLS-only access, versioning, encryption, retention/object lock appropriate to the jurisdiction, and a least-privilege writer identity restricted to the archive prefix.

```sql
SELECT to_regclass('public.cold_archive_batches'),
       to_regclass('public.cold_archive_batch_items');
```

For Kubernetes, populate `bis-cold-archive-writer` through the organization’s secret manager and set the release image digest in `infra/kubernetes/cold-archive-cronjob.yaml`. The included CronJob uses `concurrencyPolicy: Forbid`, a non-root filesystem, capped resources, and a 30-minute active deadline. For a controlled run using Compose, use the profile and pass all variables through a secret-injected environment; never commit them.

```bash
docker compose --profile archive run --rm cold-archive-writer
```

### 4.2 Normal archive verification

After a scheduled run, verify both database state and object metadata. The database result must be `committed`; a storage object alone is not success.

```sql
SELECT id, status, row_count, byte_count, object_key, manifest_key,
       sha256_hex, object_version_id, created_at, committed_at, error_detail
FROM cold_archive_batches
ORDER BY created_at DESC
LIMIT 20;

SELECT COUNT(*) AS incorrectly_marked_rows
FROM transactions t
LEFT JOIN cold_archive_batch_items i ON i.transaction_id = t.id
WHERE t."archivedTier" = 'cold' AND i.transaction_id IS NULL;
```

The second query must return zero. Retrieve the object and manifest using a read-only audit identity, recompute SHA-256, and inspect Parquet metadata with an independent reader such as DuckDB or PyArrow. Reconcile the file’s record count against `row_count` and recompute the total amount only using decimal-safe representations.

### 4.3 Failed worker run

If the worker reports `cold archive failed`, identify the immutable batch first:

```sql
SELECT * FROM cold_archive_batches
WHERE status IN ('failed', 'quarantined', 'planned', 'uploading', 'verified')
ORDER BY created_at;
```

Do not delete `cold_archive_batch_items`, clear `coldArchiveBatchId`, or create a new batch for the same transactions. Preserve the object key, manifest key, worker log, and database error. A retry must resume or reconcile the same batch ID. If checksum, schema, record count, object version, or manifest verification differs, set status `quarantined`, preserve artifacts, and use a documented incident investigation before any manual recovery.

### 4.4 Gateway dependency incident

When protected gateway requests return `authorization_unavailable`, first verify the configured Permify endpoint, tenant, API key reference, and client TLS/DNS reachability. When rate-limited routes return `rate_limit_unavailable`, verify Redis cluster health, authentication, memory, replication, and latency. When a financial/compliance request fails because durable event delivery is unavailable, verify Kafka cluster/partition/acknowledgment health, then Redis DLQ capacity.

The correct remediation is to restore the dependency. A temporary bypass requires a formally approved emergency change and a new risk assessment; it must never be a code edit that allows protected traffic or acknowledges a financial operation without durable audit state.

### 4.5 Restore drill

Run a quarterly restore drill with a read-only archive identity. Select a committed manifest, retrieve the exact object version, validate checksum and schema, load into an isolated PostgreSQL table, and reconcile all `transaction_id`, `transaction_ref`, decimal amount, currency, and timestamp values to the source database. Record the duration, mismatches, object version, manifest hash, operator, and outcome in an immutable audit record. No source-data deletion policy may be enabled until this drill succeeds repeatedly within the approved recovery time and point objectives.

## 5. Security and retention controls

The archive object may contain regulated PII and financial data. Storage logs, worker logs, Prometheus labels, and alert payloads must not contain names, account identifiers, raw transaction references, request bodies, API keys, or PostgreSQL URLs. Use workload identity or a secret manager, not hard-coded `BIS_ARCHIVE_S3_*` credentials. The object storage identity should be write-only to new objects and manifests, while a distinct audit identity has read-only recovery access.

Archive retention must be managed by a legal/compliance-approved object retention policy. This worker does not delete the PostgreSQL source. Any later purge job must be independently approved, operate only on committed and successfully restored batches, and emit a durable audit event.

## 6. Validation commands

Run these on every release affecting the gateway or archive worker:

```bash
# Gateway fail-closed behavior and concurrency safety
(cd services/gateway && go test -race ./...)

# Worker configuration and writer safety
(cd services/cold-archive-writer && go vet ./... && go test -race ./...)

# Application contracts and migration runner
DATABASE_URL="$DATABASE_URL" BIS_DATABASE_URL="$DATABASE_URL" pnpm check
DATABASE_URL="$DATABASE_URL" BIS_DATABASE_URL="$DATABASE_URL" pnpm test
DATABASE_URL="$DATABASE_URL" pnpm exec tsx scripts/migrate-postgres.ts
```

The full repeatable local test matrix is `scripts/run-full-local-integration.sh`. It intentionally performs no remote provider, settlement, or real object-store operation. A pre-production release must also run PostgreSQL-plus-versioned-MinIO integration tests and a restore drill in an isolated environment.

## 7. Ownership and escalation

| Incident type | Primary owner | Escalation |
|---|---|---|
| Parquet mismatch, quarantine, restore failure | Financial Integrity | Security, Data Governance, and SRE |
| Kafka/DLQ durable-event failure | Platform Messaging | Financial Integrity for affected financial/compliance operations |
| Permify authorization outage | Identity and Access | Security and Gateway on-call |
| Redis rate-limit/session state outage | Platform Reliability | Security for rate-limit bypass pressure |
| Archive retention or data-subject request | Data Governance | Legal/Compliance and Security |
