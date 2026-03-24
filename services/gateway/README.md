# BIS API Gateway (Go)

High-performance data source proxy service. Exposes a unified REST API for all Nigerian identity and compliance data sources.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no auth) |
| GET | `/v1/nin/:nin` | NIMC NIN lookup |
| GET | `/v1/bvn/:bvn` | CBN BVN lookup |
| GET | `/v1/cac/:rc` | CAC company registration |
| GET | `/v1/sanctions/:name` | OFAC + UN + INTERPOL screening |
| GET | `/v1/pep/:name` | PEP screening |
| GET | `/v1/credit/:bvn` | Credit bureau check |

## Authentication

All protected endpoints require `X-BIS-Key` header matching `BIS_GATEWAY_KEY` env var.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_PORT` | `8081` | HTTP listen port |
| `BIS_GATEWAY_KEY` | `dev-gateway-key-change-in-prod` | API key for auth |
| `RISK_ENGINE_URL` | `http://localhost:8082` | Python risk engine URL |

## Run

```bash
go run .
# or
docker build -t bis-gateway . && docker run -p 8081:8081 bis-gateway
```
