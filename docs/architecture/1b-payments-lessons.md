# 1 Billion Payments/Day — Architecture Lessons Applied to BIS Platform

> Sources:
> - [backend.how — 1B Payments Per Day](https://backend.how/posts/1b-payments-per-day/)
> - [pratikgajjar/1b-payments (GitHub)](https://github.com/pratikgajjar/1b-payments)

## Executive Summary

The 1B payments/day architecture demonstrates that high-throughput payment systems require a fundamentally different approach from standard CRUD applications. The key insight is that **financial systems must prioritise correctness over convenience**, and that **throughput comes from batching and partitioning, not from raw hardware**.

## Lesson 1: TigerBeetle for Financial Ledger Operations

TigerBeetle is a purpose-built financial database that processes up to 1 million transfers/second on commodity hardware. Key properties: ACID by design, batch API (8,190 transfers/batch), deterministic execution, and two-phase transfers (pending to posted/voided).

**BIS Implementation:** `services/payment-rails/internal/tigerbeetle/client.go`
- MaxBatchSize = 8,190 (TigerBeetle hard limit)
- Amounts stored as int64 in kobo (1 NGN = 100 kobo)
- Transfer IDs are uint128 native type

## Lesson 2: Idempotency Keys

Without idempotency keys, network retries create duplicate payments. With them, you can retry safely forever.

**BIS Implementation:**
- DB: `transactions.idempotency_key` (varchar 128, unique index)
- DB: `transactions.tiger_beetle_id` (varchar 64)
- tRPC: `transactions.create` checks for existing key before processing
- Go: `services/payment-rails/internal/idempotency/key.go`

## Lesson 3: Kafka Partitioning by Account Range

Partition by account ID so all transfers for an account land on the same partition, guaranteeing per-account ordering without global coordination.

**BIS Implementation:** `services/event-emitter/src/main.rs`
- NUM_PAYMENT_PARTITIONS = 32
- Partition key = murmur2(account_id) % 32
- Topics: bis.payments (32p), bis.case.events (16p), bis.aml.alerts (8p)

## Lesson 4: Backpressure

When the system is saturated, return 503 immediately rather than queuing indefinitely. An infinite queue is just a delayed crash.

**BIS Implementation:**
- Event-emitter: tokio::sync::Semaphore(8_190)
- Payment-rails: BackpressureMiddleware returns 503 with retry_after_ms=100
- k6 tests: clients back off 100-200ms on 503 responses

## Lesson 5: Hot/Warm/Cold Data Tiering

Keep 90 days in MySQL (hot), 1 year in S3 Parquet (warm), archive older data to Glacier (cold).

**BIS Implementation:** `server/archival.ts`
- HOT: MySQL, under 90 days, under 50ms query latency
- WARM: S3 Parquet, 90d-365d, under 2s query latency
- COLD: S3 Glacier, over 365d, under 4h retrieval
- Nightly archival job via `archival.runNightlyArchival`

## Lesson 6: Integer Amounts

0.1 + 0.2 = 0.30000000000000004 in IEEE 754. Use integers. All amounts in kobo throughout the stack (TigerBeetle uint64, MySQL bigint, Kafka i64, tRPC number, UI divides by 100 for display).

## Lesson 7: Redis Sentinel for Cache HA

A single Redis node is a single point of failure. Sentinel provides automatic failover in under 30 seconds without application restart.

**BIS Implementation:** `server/cache.ts`
- REDIS_SENTINELS=host1:26379,host2:26379,host3:26379
- REDIS_SENTINEL_NAME=mymaster
- Automatic master failover with retryStrategy

## Lesson 8: GATEWAY_SANDBOX=false in Production

Defaulting to sandbox mode silently swallows errors. Production should fail loudly when real APIs are unreachable.

**BIS Implementation:** `server/_core/env.ts` — default changed from "true" to "false".

## Performance Targets

| Metric | Target |
|--------|--------|
| Payment throughput | 10,000 TPS |
| p99 payment latency | under 500ms |
| p95 payment latency | under 200ms |
| Cache hit rate | over 80% |
| Idempotency success | over 99% |
| Error rate | under 0.1% |

## Implementation Checklist

- [x] TigerBeetle client with 8,190-transfer batch support
- [x] Idempotency keys in DB schema
- [x] Idempotency deduplication in tRPC transactions.create
- [x] Kafka bis.payments topic with 32 partitions (murmur2 key)
- [x] Backpressure semaphore in event-emitter (MAX_INFLIGHT = 8,190)
- [x] Backpressure middleware in payment-rails
- [x] Hot/Warm/Cold archival tiers (90d/365d/infinity)
- [x] Nightly archival job
- [x] Redis Sentinel support in server/cache.ts
- [x] GATEWAY_SANDBOX defaults to false in production
- [x] k6 load tests with SLO thresholds
- [x] GitHub Actions load test workflow (smoke + nightly + stress)
- [x] Integer amounts (kobo) throughout the stack
- [x] Prometheus metrics endpoint in event-emitter (/metrics)
