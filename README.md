# BIS — Background Intelligence System

> **Production-ready compliance intelligence platform for Nigerian financial institutions and law enforcement agencies.**

[![Tests](https://img.shields.io/badge/tests-260%20passing-brightgreen)](./server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](./tsconfig.json)
[![Go](https://img.shields.io/badge/Go-1.21-00ADD8)](./services/lex-intake)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB)](./services/lex-validator)
[![License](https://img.shields.io/badge/license-Proprietary-red)](./LICENSE)

---

## Overview

BIS is a full-stack compliance intelligence platform built for Nigerian AML/CFT operations. It integrates identity verification (NIN/BVN), sanctions screening (OFAC, UN, EU), adverse media monitoring, field agent dispatch, LEX (Law Enforcement Exchange) submission processing, and goAML STR filing into a single unified platform.

### Key Capabilities

| Capability | Description |
|---|---|
| **KYC/AML Screening** | NIN/BVN verification, PEP detection, sanctions screening, risk scoring |
| **Investigation Management** | Full case lifecycle with timeline, notes, risk scores, document vault |
| **LEX Integration** | SMS/web/API incident submission from law enforcement agencies |
| **goAML Filing** | Structured STR/SAR generation and submission to NFIU |
| **Field Agent Dispatch** | GPS-tracked agent assignment with real-time status updates |
| **Analytics** | Geospatial heatmaps, trend analysis, agency performance dashboards |
| **Multi-tenant** | Isolated tenant environments with role-based access control |
| **Audit Trail** | Immutable HMAC-signed audit log for regulatory compliance |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BIS Platform                             │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  React PWA  │  │  BIS BFF    │  │   PostgreSQL (TiDB)      │  │
│  │  (Vite 7)   │◄─┤  (Express)  ├──┤   46 tables, 25 migs    │  │
│  │  Tailwind 4 │  │  tRPC 11    │  │   Drizzle ORM            │  │
│  │  shadcn/ui  │  │  Node 22    │  └─────────────────────────┘  │
│  └─────────────┘  └──────┬──────┘                               │
│                           │                                       │
│  ┌────────────────────────┼────────────────────────────────────┐ │
│  │                 Microservices                                │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │ │
│  │  │lex-intake│ │lex-valid │ │  gateway │ │risk-engine   │  │ │
│  │  │  (Go)    │ │ (Python) │ │  (Go)    │ │  (Python)    │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │ │
│  │  │event-proc│ │lakehouse │ │ml-enrich │ │ollama-adapter│  │ │
│  │  │  (Rust)  │ │(Python)  │ │(Python)  │ │  (Go)        │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Node.js 22+, pnpm 9+
- Go 1.21+
- Python 3.11+
- Rust 1.75+ (for event processor)
- PostgreSQL 15+ (or TiDB Serverless)
- Docker + Docker Compose (optional, for full stack)

### 1. Clone and install

```bash
git clone https://github.com/your-org/bis-pwa.git
cd bis-pwa
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your values — see Environment Variables section below
```

### 3. Set up the database

```bash
# Create the PostgreSQL database
createdb bis_db

# Run migrations
pnpm db:push

# Seed with demo data (optional)
pnpm db:seed
```

### 4. Start development server

```bash
pnpm dev
# Open http://localhost:3000
```

### 5. Run tests

```bash
pnpm test                          # Vitest (260 tests)
cd services/lex-intake && go test ./...    # Go tests (24 tests)
cd services/lex-validator && python -m pytest  # Python tests (36 tests)
```

---

## Docker Deployment

### Full stack with Docker Compose

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f bis-bff

# Stop
docker-compose down
```

### Production build

```bash
# Build the BFF + frontend
pnpm build

# Build microservices
cd services/lex-intake && go build -o lex-intake .
cd services/gateway && go build -o gateway .
cd services/lex-validator && pip install -r requirements.txt
cd services/event-processor && cargo build --release

# Start production server
NODE_ENV=production node dist/index.js
```

---

## Environment Variables

All environment variables are documented in `.env.example`. The server validates them on startup and exits with a clear error message if required variables are missing.

### Critical (required in production)

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/bis_db` |
| `JWT_SECRET` | Session signing secret (min 32 chars) | `your-32-char-secret-here-change-me` |
| `VITE_APP_ID` | Manus OAuth application ID | `app_xxxxxxxxxxxx` |

### SMS Gateway (at least one required for LEX)

| Variable | Description |
|---|---|
| `AT_API_KEY` | Africa's Talking API key |
| `AT_USERNAME` | Africa's Talking username (`sandbox` for testing) |
| `TERMII_API_KEY` | Termii API key (alternative) |
| `SMS_PROVIDER` | `africas_talking` or `termii` (default: `africas_talking`) |

### Microservices

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_URL` | `http://localhost:8081` | Go gateway service |
| `RISK_ENGINE_URL` | `http://localhost:8082` | Python risk engine |
| `LEX_INTAKE_URL` | `http://localhost:8087` | Go LEX intake service |
| `LEX_VALIDATOR_URL` | `http://localhost:8088` | Python LEX validator |
| `OLLAMA_ADAPTER_URL` | `http://localhost:8086` | Ollama LLM adapter |
| `LAKEHOUSE_URL` | `http://localhost:8085` | Delta Lake writer |

### Security

| Variable | Default | Description |
|---|---|---|
| `DB_SSL_STRICT` | `false` | Set `true` in production to verify DB TLS cert |
| `ALLOWED_ORIGINS` | (none) | Comma-separated additional CORS origins |
| `GRAFANA_WEBHOOK_SECRET` | (insecure default) | **Change before production** |
| `LEX_HMAC_SECRET` | (insecure default) | **Change before production** |
| `BIS_API_KEY` | (insecure default) | **Change before production** |

---

## API Reference

### Health Check

```
GET /api/health
```

Returns JSON with DB, LLM, and uptime status. Returns 503 if any critical service is down.

### CSRF Token

```
GET /api/csrf-token
```

Returns a CSRF token for use in state-changing requests. Include as `X-CSRF-Token` header in all POST requests in production.

### tRPC Procedures

All application logic is exposed via tRPC at `/api/trpc`. The full procedure reference is available at `/api/docs` (Swagger UI).

Key namespaces:

| Namespace | Procedures |
|---|---|
| `auth` | `me`, `logout` |
| `investigations` | `list`, `get`, `create`, `update`, `delete`, `addNote`, `addTimeline` |
| `cases` | `list`, `get`, `create`, `update`, `bulkUpdateStatus`, `bulkAssign`, `exportCsv` |
| `lex` | `submitIncident`, `listSubmissions`, `getSubmission`, `validateSubmission`, `overdueSubmissions` |
| `kyc` | `verify`, `list`, `get`, `batchVerify` |
| `alerts` | `list`, `acknowledge`, `dismiss`, `getUnreadCount` |
| `fieldAgents` | `list`, `dispatch`, `updateStatus`, `getLocation` |
| `analytics` | `getDashboardStats`, `getHeatmapData`, `getAgencyBreakdown` |
| `reports` | `generateCase`, `generateInvestigation`, `generateAgency` |
| `users` | `list`, `updateRole`, `deactivate` (admin only) |
| `auditLog` | `list`, `export` (admin only) |
| `tenants` | `list`, `create`, `update`, `getUsage` (admin only) |

---

## LEX SMS Format

Law enforcement officers submit incidents via SMS using the following format:

```
LEX <AGENCY_CODE> <PIN> <INCIDENT_TYPE> <STATE_CODE> <NARRATIVE>
```

**Example:**
```
LEX NPF-LA-001 123456 ARREST LA Suspect arrested at Mile 2 market with stolen goods
```

**Incident Types:** `ARREST`, `THEFT`, `ASSAULT`, `FRAUD`, `DRUG`, `KIDNAP`, `ROBBERY`, `HOMICIDE`, `VANDALISM`, `OTHER`

**State Codes:** `LA` (Lagos), `KN` (Kano), `AB` (Abia), `FC` (FCT/Abuja), `RI` (Rivers), and all 37 Nigerian states/FCT.

After successful submission, the officer receives an SMS confirmation with a reference number.

---

## goAML Integration

BIS generates NFIU-compliant STR/SAR XML files from investigation data. To file a Suspicious Transaction Report:

1. Open an Investigation and click **File STR**
2. Complete the goAML wizard (transaction details, parties, narrative)
3. Review the generated XML
4. Submit to NFIU via the goAML portal or direct API

---

## Security

### Authentication
- Manus OAuth 2.0 with JWT session cookies
- TOTP/2FA support (TOTP setup, QR code, backup codes)
- Session management (view and revoke active sessions)

### Authorization
- Role-based access control (`admin`, `user`)
- Tenant isolation (row-level security via tenant_id)
- Admin-only procedures protected by `adminProcedure` middleware

### Transport Security
- HSTS with 1-year max-age and preload
- Strict CSP (no `unsafe-eval`, no cross-origin frames)
- CSRF token validation on all state-changing requests (production)
- Rate limiting: 300 req/15min global, 20/hr for LEX submissions, 30/15min for auth

### Data Security
- All secrets validated on startup (insecure defaults rejected in production)
- DB connections use SSL in production (`DB_SSL_STRICT=true`)
- Audit log with HMAC integrity verification
- Webhook signatures verified with timing-safe HMAC comparison

---

## Microservices

### lex-intake (Go, port 8087)
Receives SMS webhooks from Africa's Talking and Termii, parses LEX format, queues offline, and sends outbound SMS confirmation to the submitting officer.

```bash
cd services/lex-intake
go run . --port 8087 --bis-url http://localhost:3000 --bis-key $BIS_API_KEY
```

### lex-validator (Python, port 8088)
Validates LEX submission content, checks agency codes, deduplicates, and enriches with ML classification.

```bash
cd services/lex-validator
pip install -r requirements.txt
uvicorn main:app --port 8088
```

### gateway (Go, port 8081)
API gateway for external integrations (NIMC, CBN BVN, CAC, OFAC).

### risk-engine (Python, port 8082)
ML-based risk scoring using XGBoost + rule engine.

### event-processor (Rust, port 8083)
High-throughput event stream processor writing to Parquet/Delta Lake.

### ml-enrichment (Python, port 8084)
NLP enrichment: entity extraction, sentiment analysis, topic classification.

### lakehouse (Python, port 8085)
Delta Lake writer for analytics data warehouse.

### ollama-adapter (Go, port 8086)
Local LLM adapter for on-premise AI inference via Ollama.

---

## Database Schema

46 tables across 25 migrations. Key tables:

| Table | Description |
|---|---|
| `users` | Platform users with roles |
| `tenants` | Multi-tenant organisations |
| `investigations` | Investigation records with risk scores |
| `cases` | Compliance cases with SLA tracking |
| `kyc_records` | KYC/AML verification records |
| `alerts` | Automated risk alerts |
| `lex_submissions` | LEX incident reports |
| `lex_agencies` | Registered law enforcement agencies |
| `field_agents` | Field agent registry |
| `audit_log` | Immutable audit trail |
| `notifications` | In-app notifications |
| `platform_settings` | Global configuration |
| `tenants_billing` | Billing and usage tracking |
| `goaml_filings` | STR/SAR filing records |
| `investigation_case_links` | Bidirectional investigation-case links |

---

## Development

### Project Structure

```
bis-pwa/
├── client/              # React PWA (Vite 7, Tailwind 4, shadcn/ui)
│   ├── src/
│   │   ├── pages/       # 53 page components
│   │   │   ├── bis/     # Core BIS pages (cases, investigations, KYC, alerts)
│   │   │   ├── lex/     # LEX pages (review, analytics, agencies)
│   │   │   ├── settings/# Settings pages (2FA, sessions, profile)
│   │   │   └── admin/   # Admin pages (users, audit log, tenants)
│   │   ├── components/  # Shared components (BISLayout, charts, maps)
│   │   └── lib/         # tRPC client, utils
├── server/              # Express BFF (tRPC 11, Drizzle ORM)
│   ├── _core/           # Framework: auth, context, env, LLM, storage
│   ├── routers.ts       # All tRPC procedures (~3200 lines)
│   ├── db.ts            # Database query helpers
│   └── *.ts             # Feature modules (billing, SLA, OpenClaw, etc.)
├── drizzle/             # Schema + 25 migrations
├── services/            # 8 microservices
│   ├── lex-intake/      # Go SMS gateway
│   ├── lex-validator/   # Python validation
│   ├── gateway/         # Go API gateway
│   ├── risk-engine/     # Python ML risk scoring
│   ├── event-processor/ # Rust event stream
│   ├── ml-enrichment/   # Python NLP
│   ├── lakehouse/       # Python Delta Lake
│   └── ollama-adapter/  # Go Ollama bridge
├── bis-mobile/          # React Native Expo mobile app
├── infra/               # Docker, Terraform, Kubernetes
├── scripts/             # Migration, seed, deployment scripts
├── docs/                # Architecture, security audit, API guides
└── shared/              # Shared types and constants
```

### Scripts

```bash
pnpm dev          # Start development server
pnpm build        # Production build
pnpm test         # Run all Vitest tests
pnpm db:push      # Run database migrations
pnpm db:seed      # Seed demo data
pnpm lint         # ESLint
pnpm format       # Prettier
```

---

## Production Checklist

Before deploying to production:

- [ ] Set `NODE_ENV=production`
- [ ] Set a strong `JWT_SECRET` (min 32 chars, random)
- [ ] Set `DB_SSL_STRICT=true`
- [ ] Replace all insecure default secrets (`GRAFANA_WEBHOOK_SECRET`, `LEX_HMAC_SECRET`, `BIS_API_KEY`)
- [ ] Configure `ALLOWED_ORIGINS` with your production domain
- [ ] Set up SMS gateway credentials (`AT_API_KEY`/`TERMII_API_KEY`)
- [ ] Configure Paystack (`PAYSTACK_SECRET_KEY`) if accepting payments
- [ ] Run `pnpm db:push` on the production database
- [ ] Verify `/api/health` returns `{"status":"ok"}`
- [ ] Enable HSTS preload via your DNS provider
- [ ] Set up Grafana/Prometheus monitoring with `GRAFANA_WEBHOOK_SECRET`
- [ ] Commission penetration test using `docs/security-audit-phase45.md` as scope

---

## Contributing

This is a proprietary platform. Internal development follows the phase-based roadmap in `todo.md`. All changes must:

1. Pass `pnpm test` (260 Vitest + 24 Go + 36 Python tests)
2. Pass `npx tsc --noEmit` (0 TypeScript errors)
3. Be reviewed by a senior engineer before merging to main

---

## License

Proprietary — All rights reserved. © 2026 BIS Technologies Ltd.

For licensing inquiries: licensing@bis.ng
