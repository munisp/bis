# BIS Platform — k6 Load Tests

Performance tests derived from the **1 billion payments/day** architecture research.

## Quick Start

```bash
# Install k6
brew install k6  # macOS
# or
sudo apt-get install k6  # Ubuntu

# Run payment load test (local)
k6 run k6/payment-load-test.js

# Run against staging
BASE_URL=https://staging.bis-platform.com \
  API_TOKEN=$STAGING_TOKEN \
  k6 run k6/payment-load-test.js

# Run with Grafana output
k6 run --out influxdb=http://localhost:8086/k6 k6/payment-load-test.js
```

## Test Files

| File | Purpose |
|------|---------|
| `payment-load-test.js` | Payment API ramp-up + idempotency replay |
| `verification-load-test.js` | NIN/BVN/CAC verification with cache hit measurement |

## SLO Targets

Derived from the 1B payments architecture (see `docs/architecture/1b-payments-lessons.md`):

| Metric | Target |
|--------|--------|
| p50 latency | < 50ms |
| p95 latency | < 200ms |
| p99 latency | < 500ms |
| Error rate | < 0.1% |
| Idempotency success | > 99% |
| Cache hit rate | > 80% |

## Key Scenarios

### 1. Payment Ramp-Up (`ramp_up`)
Tests gradual load increase from 0 → 1,000 VUs. Reveals:
- Backpressure activation threshold
- Database connection pool exhaustion
- TigerBeetle batch saturation point

### 2. Idempotency Replay (`idempotency_replay`)
Replays the same idempotency keys concurrently. Verifies:
- No duplicate transactions created
- Same response returned for duplicate requests
- p99 latency < 50ms for cached idempotency checks

## Architecture Lessons Applied

From [pratikgajjar/1b-payments](https://github.com/pratikgajjar/1b-payments):

1. **Batch size = 8,190**: TigerBeetle's optimal batch size. The payment API
   accumulates transfers and flushes at this threshold or every 10ms.

2. **Partition by account**: Kafka `bis.payments` topic uses 32 partitions
   keyed by `murmur2(account_id) % 32`. This guarantees per-account ordering.

3. **Backpressure = 503**: When `MAX_INFLIGHT_EVENTS` is reached, the API
   returns 503 immediately. Clients must retry with exponential backoff.

4. **Idempotency keys**: All payment mutations require an `idempotencyKey`.
   Duplicate requests within 24h return the original result without re-processing.

5. **Integer amounts**: All amounts stored in kobo (1 NGN = 100 kobo) to avoid
   floating-point precision issues.

## CI Integration

The GitHub Actions workflow (`.github/workflows/load-test.yml`) runs a
smoke test (10 VUs, 30s) on every PR merge to `main`.
Full load tests run nightly via the `load-test-nightly` workflow.
