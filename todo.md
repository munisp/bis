# BIS Platform TODO

## Frontend (React PWA)
- [x] 24 fully functional pages with dark/light theme toggle
- [x] Dashboard with KPI cards, risk trend chart, live ticker strip
- [x] Investigation list with advanced filters, saved presets, sparklines, CSV export
- [x] Investigation detail with 3 tabs (Overview, Evidence timeline, Processing Log)
- [x] Investigation status workflow and assignment dropdown
- [x] New Investigation slide-over wizard (3-step)
- [x] KYC verification with bulk CSV upload
- [x] Social monitoring with live mock feeds (8s intervals) + link-to-investigation
- [x] Messaging channels with incoming reports (12s intervals)
- [x] Field agent management with map view and task dispatch
- [x] Report builder with 6 templates and preview panel
- [x] Advanced search with saved filter presets
- [x] Audit log with CSV export
- [x] User management with role-based access
- [x] Tenant API key management with rotation/revocation
- [x] Webhook configuration with delivery logs
- [x] Risk score sparklines with hover tooltips
- [x] @mention autocomplete in notes
- [x] Mobile responsiveness with ScrollArea wrappers
- [x] Lazy route splitting with React.lazy + Suspense
- [x] Notification bell slide-over with severity badges
- [x] Data Sources catalog page (25 Nigerian integrations)
- [x] Alerts page with Open Investigation links and CSV export

## Backend Services (Polyglot)
- [x] Go API Gateway (:8081) — NIMC NIN, NIBSS BVN, CAC RC, OFAC/UN/EU sanctions, EFCC watchlist, credit bureau proxy routes with OIDC middleware
- [x] Python ML Risk Engine (:8082) — Composite risk scoring (5 factors) + NLP adverse media analysis
- [x] Rust Event Processor (:8083) — Sub-100µs event publishing, webhook fan-out, audit log
- [x] Node.js tRPC BFF — PostgreSQL database with 6 tables, typed procedures proxying all services

## Middleware Integration
- [x] PostgreSQL — Primary database (migrated from MySQL)
- [x] Kafka — Event bus between services (bis.events, bis.alerts, bis.audit, bis.billing topics)
- [x] Redis — Session store, rate limiting, LRU cache
- [x] Keycloak — OIDC authentication with realm config (5 roles, 2 clients)
- [x] Temporal — Investigation workflow engine (NIN→BVN→Sanctions→RiskScore→FieldTask)
- [x] Docker Compose — 15-service orchestration

## Phase 3 — Production Readiness Additions
- [x] Permify authorization layer — Go client middleware, Node.js tRPC helper, Permify schema (infra/permify/schema.perm)
- [x] APISix API gateway — Single ingress point with JWT validation, rate limiting, CORS, request-ID plugins for all BIS routes (infra/apisix/)
- [x] TigerBeetle ledger — Go client in gateway, Node.js billing tRPC router, Docker service with HTTP proxy
- [x] billing.ts tRPC router wired into appRouter
- [x] docker-compose.yml updated: Permify + APISix + TigerBeetle + TigerBeetle HTTP proxy (15 total containers)
- [x] docs/environment-variables.md — complete port map and variable reference

## Phase 4 — Observability & Billing UI
- [x] Permify relationship seeding on investigation create/assign in tRPC procedures
- [x] Replace role-only checks with permifyMiddleware in tRPC procedures (assign procedure)
- [x] Billing UI page (/billing) with NGN balance, top-up form, transaction history
- [x] Wire /billing route into App.tsx and sidebar navigation
- [x] APISix kafka-logger plugin config for bis.audit topic (tRPC BFF + Go gateway routes)
- [x] Prometheus + Grafana Docker services with APISix dashboard provisioning
- [x] Update docker-compose.yml with prometheus + grafana containers (17 total)
