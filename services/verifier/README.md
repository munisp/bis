# BIS Verifier Microservice

Standalone Go microservice that provides Nigerian identity verification over a clean REST API.

## Architecture

```
Client → [BIS Verifier :8086] → BIS Own Engine (NIMC/NIBSS/CAC/OFAC)
                               → Youverify (fallback)
                               → Sandbox mock (always available)
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/v1/nin` | NIN lookup (NIMC) |
| POST | `/v1/bvn` | BVN lookup (NIBSS) |
| POST | `/v1/cac` | CAC RC number lookup |
| POST | `/v1/sanctions` | OFAC/UN/EU/EFCC sanctions check |

## Authentication

All endpoints except `/health` require the `X-BIS-Key` header or `Authorization: Bearer <token>`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BIS_VERIFIER_KEY` | `dev-verifier-key-change-in-prod` | API key for this service |
| `VERIFIER_PORT` | `8086` | Port to listen on |
| `GATEWAY_SANDBOX` | `false` | Force sandbox mode |
| `BIS_VERIFY_NIMC_URL` | — | NIMC API endpoint |
| `BIS_VERIFY_NIMC_KEY` | — | NIMC API key |
| `BIS_VERIFY_NIBSS_URL` | — | NIBSS API endpoint |
| `BIS_VERIFY_NIBSS_KEY` | — | NIBSS API key |
| `BIS_VERIFY_CAC_URL` | — | CAC API endpoint |
| `BIS_VERIFY_CAC_KEY` | — | CAC API key |
| `YOUVERIFY_BASE_URL` | `https://api.youverify.co/v2` | Youverify fallback URL |
| `YOUVERIFY_API_KEY` | — | Youverify API key |

## Running Locally

```bash
# Sandbox mode (no real API keys needed)
GATEWAY_SANDBOX=true go run .

# With real credentials
BIS_VERIFY_NIMC_URL=https://api.nimc.gov.ng/v1/nin \
BIS_VERIFY_NIMC_KEY=your-key \
go run .
```

## Docker

```bash
docker build -t bis-verifier .
docker run -p 8086:8086 -e GATEWAY_SANDBOX=true bis-verifier
```

## Testing

```bash
go test ./...
```

## Example Requests

```bash
# NIN lookup
curl -X POST http://localhost:8086/v1/nin \
  -H "X-BIS-Key: dev-verifier-key-change-in-prod" \
  -H "Content-Type: application/json" \
  -d '{"nin":"12345678901"}'

# Sanctions check
curl -X POST http://localhost:8086/v1/sanctions \
  -H "X-BIS-Key: dev-verifier-key-change-in-prod" \
  -H "Content-Type: application/json" \
  -d '{"name":"John Smith","nationality":"NG"}'
```
