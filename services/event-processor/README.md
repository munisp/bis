# BIS Event Processor (Rust)

High-throughput event streaming processor built with **Tokio + Axum**.

## Responsibilities

- Receive domain events from all BIS services via `POST /v1/events`
- Fan out to registered webhook subscribers filtered by event type and severity
- Write every event to an in-memory audit log (capped at 10,000 entries, FIFO eviction)
- Broadcast events over an internal `tokio::sync::broadcast` channel for SSE/WebSocket consumers

## Performance

- Sub-100µs event publish latency (measured: ~42µs in dev)
- Lock-free subscriber map via `DashMap`
- Async fan-out with `tokio::spawn` per subscriber

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | None | Health check |
| POST | /v1/events | X-BIS-Key | Publish a domain event |
| POST | /v1/subscriptions | X-BIS-Key | Register a webhook subscriber |
| GET | /v1/subscriptions | X-BIS-Key | List all subscribers |
| DELETE | /v1/subscriptions/:id | X-BIS-Key | Remove a subscriber |
| GET | /v1/audit | X-BIS-Key | Last 200 audit entries |
| GET | /v1/stats | X-BIS-Key | Processing statistics |

## Event Types

`INVESTIGATION_CREATED` · `INVESTIGATION_FLAGGED` · `INVESTIGATION_COMPLETED`  
`KYC_COMPLETED` · `KYC_FAILED` · `ALERT_TRIGGERED` · `ALERT_ACKNOWLEDGED`  
`SANCTIONS_HIT` · `PEP_DETECTED` · `FIELD_TASK_DISPATCHED` · `FIELD_TASK_COMPLETED`  
`REPORT_GENERATED` · `USER_LOGIN` · `API_KEY_ROTATED`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EVENT_PROCESSOR_PORT` | `8083` | Listening port |
| `BIS_GATEWAY_KEY` | `dev-gateway-key-change-in-prod` | Shared API key |

## Build & Run

```bash
# Development
cargo run

# Production
cargo build --release
./target/release/bis-event-processor

# Docker
docker build -t bis-event-processor .
docker run -p 8083:8083 -e BIS_GATEWAY_KEY=your-key bis-event-processor
```
