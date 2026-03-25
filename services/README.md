# BIS Polyglot Services

This directory contains the microservices that extend the BIS platform beyond the Node.js BFF.

---

## Services Overview

| Service | Language | Port | Purpose |
|---------|----------|------|---------|
| `case-manager` | Go (chi + GORM) | 8092 | Case Management REST API with JWT auth |
| `ollama-adapter` | Go | 8090 | Ollama HTTP proxy with BIS auth, chat, embed, Lakehouse AI |
| `ml-enrichment` | Python (FastAPI) | 8091 | Risk scoring, adverse media NLP, case enrichment |
| `event-emitter` | Rust (Axum + rdkafka) | 8093 | Kafka consumer/producer, audit event pipeline |

---

## Environment Variables

### Ollama Adapter (`services/ollama-adapter`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8090` | HTTP server port |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_DEFAULT_MODEL` | `llama3.2` | Default model for completions |
| `BIS_API_KEY` | — | Bearer token for BIS internal auth |
| `ML_ENRICHMENT_URL` | `http://localhost:8091` | ML enrichment service URL |

### ML Enrichment (`services/ml-enrichment`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8091` | HTTP server port |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_DEFAULT_MODEL` | `llama3.2` | Default model |
| `BIS_API_KEY` | — | Bearer token for BIS internal auth |
| `DATABASE_URL` | — | PostgreSQL connection string |

### Case Manager (`services/case-manager`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8092` | HTTP server port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `JWT_SECRET` | — | JWT signing secret (shared with BFF) |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka broker addresses |
| `KAFKA_TOPIC_CASES` | `bis.cases` | Kafka topic for case events |
| `ML_ENRICHMENT_URL` | `http://localhost:8091` | ML enrichment service URL |

### Event Emitter (`services/event-emitter`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8093` | HTTP server port |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka broker addresses |
| `KAFKA_CONSUMER_GROUP` | `bis-event-emitter` | Kafka consumer group ID |
| `KAFKA_TOPICS` | `bis.cases,bis.investigations,bis.alerts,bis.kyc` | Topics to consume |
| `DATABASE_URL` | — | PostgreSQL connection string |

---

## Docker Compose

All services are defined in the root `docker-compose.yml`. Start the full stack:

```bash
# Start all services (including Ollama)
docker compose up -d

# Start only infrastructure (no Ollama)
docker compose up -d postgres redis kafka

# Pull a model into Ollama after startup
docker compose exec ollama ollama pull llama3.2
docker compose exec ollama ollama pull nomic-embed-text

# Check service health
docker compose ps
```

### GPU Support (NVIDIA)

To enable GPU passthrough for Ollama, uncomment the `deploy.resources` block in `docker-compose.yml`:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

Requires: NVIDIA Container Toolkit installed on the host.

---

## Development (Local)

Each service can be run independently:

```bash
# Go services (case-manager or ollama-adapter)
cd services/case-manager
go run ./cmd/server

# Python ML enrichment
cd services/ml-enrichment
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8091

# Rust event emitter
cd services/event-emitter
cargo run
```

---

## Service Communication

```
BFF (Node.js :3000)
  └─► case-manager (:8092)   ─► postgres, kafka
  └─► ollama-adapter (:8090) ─► ollama (:11434), ml-enrichment (:8091)
  └─► ml-enrichment (:8091)  ─► ollama (:11434), postgres

event-emitter (:8093)
  └─► kafka (consumer: bis.cases, bis.investigations, bis.alerts, bis.kyc)
  └─► postgres (audit log writes)
```
