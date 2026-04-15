# BIS Platform — Environment Variables Reference

This document lists all environment variables required to run the BIS platform.
Copy the values into your deployment secrets manager or Docker `.env` file.

## Core Infrastructure

| Variable | Default (dev) | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | `bis_dev_password` | PostgreSQL superuser password |
| `REDIS_PASSWORD` | `bis_redis_dev` | Redis AUTH password |
| `JWT_SECRET` | `change-me-in-production` | Session cookie signing secret |
| `BIS_GATEWAY_KEY` | `dev-gateway-key-change-in-prod` | Internal service-to-service API key |

## Keycloak (OIDC)

| Variable | Default (dev) | Description |
|---|---|---|
| `KEYCLOAK_ADMIN` | `admin` | Keycloak admin username |
| `KEYCLOAK_ADMIN_PASSWORD` | `admin_dev_password` | Keycloak admin password |
| `KEYCLOAK_HOSTNAME` | `localhost` | Public hostname for Keycloak |
| `KEYCLOAK_REALM` | `bis` | Keycloak realm name |
| `KEYCLOAK_CLIENT_ID` | `bis-bff` | OAuth2 client ID |
| `KEYCLOAK_CLIENT_SECRET` | _(empty)_ | OAuth2 client secret |

## Permify (Fine-grained Authorization)

| Variable | Default (dev) | Description |
|---|---|---|
| `PERMIFY_URL` | `http://localhost:3476` | Permify HTTP API base URL |
| `PERMIFY_TENANT_ID` | `t1` | Permify tenant identifier |
| `PERMIFY_API_KEY` | `bis-permify-dev-key` | Permify pre-shared authentication key |

## APISix (API Gateway)

| Variable | Default (dev) | Description |
|---|---|---|
| `APISIX_ADMIN_KEY` | `bis-apisix-admin-dev` | APISix admin API key |
| `APISIX_VIEWER_KEY` | `bis-apisix-viewer-dev` | APISix viewer API key |

## TigerBeetle (Financial Ledger)

| Variable | Default (dev) | Description |
|---|---|---|
| `TIGERBEETLE_URL` | `http://localhost:4000` | TigerBeetle HTTP proxy base URL |

## Nigerian Data Sources

| Variable | Default (dev) | Description |
|---|---|---|
| `NIMC_API_URL` | `https://api.nimc.gov.ng` | NIMC NIN verification endpoint |
| `NIMC_API_KEY` | _(empty)_ | NIMC API key |
| `BVN_API_URL` | `https://api.nibss-plc.org.ng` | NIBSS BVN lookup endpoint |
| `BVN_API_KEY` | _(empty)_ | NIBSS API key |
| `CAC_API_URL` | `https://api.cac.gov.ng` | CAC RC number lookup endpoint |
| `CAC_API_KEY` | _(empty)_ | CAC API key |
| `EFCC_API_URL` | `https://api.efcc.gov.ng` | EFCC watchlist endpoint |
| `CREDITBUREAU_API_KEY` | _(empty)_ | Credit bureau API key |

## Manus OAuth (auto-injected in Manus environment)

| Variable | Description |
|---|---|
| `VITE_APP_ID` | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Manus OAuth backend base URL |
| `VITE_OAUTH_PORTAL_URL` | Manus login portal URL (frontend) |
| `BUILT_IN_FORGE_API_URL` | Manus built-in APIs base URL |
| `BUILT_IN_FORGE_API_KEY` | Manus built-in APIs bearer token (server-side) |
| `VITE_FRONTEND_FORGE_API_KEY` | Manus built-in APIs bearer token (frontend) |
| `VITE_FRONTEND_FORGE_API_URL` | Manus built-in APIs URL (frontend) |

## Port Map

| Port | Service |
|---|---|
| `9080` | APISix HTTP ingress (public entry point) |
| `9180` | APISix Admin API |
| `9091` | APISix Prometheus metrics |
| `3001` | Node.js tRPC BFF (internal, behind APISix) |
| `8081` | Go API Gateway (internal) |
| `8082` | Python Risk Engine (internal) |
| `8083` | Rust Event Processor (internal) |
| `5432` | PostgreSQL |
| `6379` | Redis |
| `9093` | Kafka (external listener) |
| `8080` | Keycloak |
| `7233` | Temporal gRPC |
| `8088` | Temporal UI |
| `3476` | Permify HTTP API |
| `3478` | Permify gRPC |
| `3100` | TigerBeetle binary protocol |
| `4000` | TigerBeetle HTTP proxy |

## BIS Own Verification Engine

| Variable | Default (dev) | Description |
|---|---|---|
| `GATEWAY_SANDBOX` | `true` | Set to `false` to enable live verification calls |
| `BIS_VERIFY_NIMC_URL` | `https://api.nimc.gov.ng/v1` | NIMC NIN verification base URL |
| `BIS_VERIFY_NIMC_KEY` | _(empty — sandbox used if unset)_ | NIMC API bearer token |
| `BIS_VERIFY_NIBSS_URL` | `https://api.nibss-plc.com.ng/v1` | NIBSS BVN lookup base URL |
| `BIS_VERIFY_NIBSS_KEY` | _(empty — sandbox used if unset)_ | NIBSS API bearer token |
| `BIS_VERIFY_CAC_URL` | `https://search.cac.gov.ng/api/v1` | CAC RC number lookup base URL |
| `BIS_VERIFY_CAC_KEY` | _(empty — sandbox used if unset)_ | CAC API bearer token |
| `BIS_VERIFY_OFAC_URL` | `https://api.ofac.treasury.gov/v1` | OFAC sanctions list base URL |
| `YOUVERIFY_API_KEY` | _(empty — sandbox used if unset)_ | Youverify fallback API key |
| `YOUVERIFY_BASE_URL` | `https://api.youverify.co/v2` | Youverify API base URL |

**Verification priority chain:** BIS own engine → Youverify fallback → Sandbox (dev/test only).
Set `GATEWAY_SANDBOX=false` and provide at least one set of own-engine keys to enable live calls.

## Temporal Workflow Engine

| Variable | Default (dev) | Description |
|---|---|---|
| `TEMPORAL_HOST` | `localhost:7233` | Temporal gRPC endpoint |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | `bis-investigation` | Task queue for investigation workflows |

## Observability

| Variable | Default (dev) | Description |
|---|---|---|
| `PROMETHEUS_URL` | `http://prometheus:9090` | Prometheus scrape endpoint |
| `GRAFANA_ADMIN_PASSWORD` | `bis_grafana_dev` | Grafana admin password |
| `GRAFANA_SECRET_KEY` | `bis-grafana-secret-dev` | Grafana secret key for cookie signing |

## CI/CD & Deployment

| Variable | Description |
|---|---|
| `STAGING_HOST` | Staging server hostname/IP |
| `STAGING_USER` | SSH username for staging deploys |
| `STAGING_URL` | Staging base URL for smoke tests |
| `PRODUCTION_HOST` | Production server hostname/IP |
| `PRODUCTION_USER` | SSH username for production deploys |
| `PRODUCTION_URL` | Production base URL |
| `SMOKE_API_TOKEN` | Session token used in smoke test requests |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook for deploy notifications |
| `GITHUB_REPOSITORY` | GitHub repo (owner/name) for GHCR image paths |
| `IMAGE_TAG` | Docker image tag to deploy (default: `latest`) |

## Additional Service Ports

| Port | Service |
|---|---|
| `8084` | Biometric Engine |
| `8085` | Lakehouse Writer |
| `8086` | ML Enrichment |
| `8087` | Risk Scoring |
| `8088` | Temporal UI |
| `8089` | Case Manager |
| `8090` | Event Emitter |
| `8091` | Lex Intake |
| `8092` | AML Engine |
| `8093` | Ollama Adapter |
| `8094` | Payment Rails |
| `8095` | Risk Engine |
| `8096` | Event Processor |
| `8097` | Lex Validator |
| `11434` | Ollama LLM (internal) |
