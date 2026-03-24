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

## Phase 5 — Invoice Export, Grafana Alerts, Assign UI
- [x] billing.exportLedger tRPC procedure (CSV generation, S3 presigned URL + data-URI fallback)
- [x] Download CSV button in BillingPage header (respects active transaction filter)
- [x] Grafana alerting provisioning YAML (P99 > 2s, error rate > 5%, Kafka lag > 1000)
- [x] notifyOwner webhook contact point + email fallback + notification policies in Grafana
- [x] Investigation assign dropdown in InvestigationDetail — live trpc.users.list, Permify-gated assign mutation
- [x] trpc.users.list procedure (protectedProcedure, optional role filter, ordered by name)

## Phase 6 — Grafana Webhook, Paystack, Live Investigation Detail

- [x] POST /api/webhooks/grafana-alert Express route with bearer token auth and notifyOwner forwarding
- [x] Paystack initiate/verify tRPC procedures (billing.initiateTopUp, billing.verifyTopUp)
- [x] Top-up dialog updated with Paystack checkout flow (card/bank/USSD) + Verify Payment banner
- [x] InvestigationDetail subject card replaced with live trpc.investigations.get query (with mock fallback)
- [x] InvestigationDetail evidence items merged with live trpc.audit.list (targetRef filter)
- [x] Processing Log tab wired to live audit entries; risk score from live investigation record

## Phase 7 — Paystack Webhook, Live Investigations List, Grafana Secret

- [x] POST /api/webhooks/paystack with x-paystack-signature HMAC-SHA512 validation
- [x] Auto-credit TigerBeetle on charge.success event via creditTenantAccount helper + notifyOwner
- [x] Investigations list page wired to live trpc.investigations.list with search/filter/pagination
- [x] Replace mockInvestigations array in Investigations.tsx with live tRPC data (mock fallback retained)
- [x] GRAFANA_WEBHOOK_SECRET env var — dev default (bis-grafana-webhook-dev) used; configurable via secrets
- [x] /api/webhooks/grafana-alert bearer check reads GRAFANA_WEBHOOK_SECRET from env (already implemented)

## Phase 8 — Full Production Pass (No Mocks)

### Schema
- [x] Added reports, alerts, kyc_records, field_tasks, field_agents, data_sources, monitors, screening_requests tables
- [x] Added tenants, api_keys, webhooks tables
- [x] Extended userRoleEnum with auditor and readonly
- [x] Switched to PostgreSQL (drizzle pg-core, drizzle.config postgresql dialect)
- [x] Local PostgreSQL: bis_db / bis_user — all 14 tables created

### Server Procedures
- [x] dashboard.stats procedure (real DB aggregates: investigations, alerts, kyc, field tasks, risk scores)
- [x] reports CRUD procedures (list, create)
- [x] alerts CRUD procedures (list, markRead)
- [x] kyc CRUD procedures (list, get, create, update)
- [x] fieldTasks CRUD procedures (list, create, update)
- [x] fieldAgents CRUD procedures (list, get, create, update)
- [x] dataSources CRUD + seed procedures (seed upserts 25 Nigerian data sources)
- [x] monitors CRUD procedures (list, create, update)
- [x] screeningRequests CRUD procedures (list, create, update)
- [x] tenantsRouter: tenants list/create/suspend/reactivate + apiKeys + webhooks CRUD
- [x] usersRouter extended: updateRole, deactivate, reactivate
- [x] investigations.create wired to real DB with Permify seeding
- [x] billing.getLedger procedure (reads audit_log billing entries)

### Frontend
- [x] Dashboard KPIs from trpc.dashboard.stats
- [x] Dashboard recent investigations from trpc.investigations.list
- [x] Dashboard alerts from trpc.alerts.list
- [x] NewInvestigationSlideOver uses real trpc.investigations.create mutation
- [x] Reports page wired to trpc.reports.*
- [x] Alerts page wired to trpc.alerts.*
- [x] AuditLogPage wired to trpc.audit.list
- [x] FieldAgentsPage wired to trpc.fieldAgents.* + trpc.fieldTasks.create
- [x] ContinuousMonitoringPage wired to trpc.monitors.* + trpc.alerts.list
- [x] DataSourcesPage wired to trpc.dataSources.seed + trpc.dataSources.list
- [x] BillingPage MOCK_TRANSACTIONS replaced with trpc.billing.getLedger
- [x] BISLayout nav badges from trpc.dashboard.stats, notifications from trpc.alerts.list
- [x] Tenants.tsx fully wired to tenantsRouter
- [x] UserManagementPage wired to trpc.users.list + updateRole + deactivate
- [x] InvestigationDetail — removed MOCK_EVIDENCE, live trpc.investigations.get + trpc.audit.list
- [x] Investigations.tsx — removed mockInvestigations fallback, live only
- [x] SocialMonitoringDashboard — removed SEED_MENTIONS dead code
- [x] MessagingChannelsPage — removed SEED_REPORTS/SEED_STATS dead code
- [x] Extracted utility functions from mockData.ts → client/src/lib/bisUtils.ts
- [x] Zero mockData imports remaining across entire client/src tree
- [x] TypeScript: 0 errors
- [x] Tests: 15/15 passing

## Phase 9 — Final Production Pass (Stub Elimination)

### New DB Tables
- [x] platform_settings table — key/value store for settings persistence
- [x] onboarding_applications table — multi-stakeholder onboarding records

### New Server Procedures
- [x] settingsRouter (settings.get, settings.set) — real DB persistence
- [x] onboardingRouter (onboarding.create, list, get, updateStatus) — real DB persistence
- [x] investigations.addNote — persists analyst notes to audit_log
- [x] lookup.nigerianDataBundle — Nigerian phone/NIN/BVN data bundle lookup
- [x] kyc.create — save KYC decision record to DB
- [x] screening.create — extended with result/resultSummary fields

### Frontend Wiring (Stub → Real tRPC)
- [x] Settings.tsx — all save handlers wired to trpc.settings.set (namespace-scoped)
- [x] DrugScreeningPage — handleSubmit wired to trpc.screening.create
- [x] MVRCheckPage — handleSubmit wired to trpc.screening.create
- [x] WorkAuthorizationPage — handleSubmit wired to trpc.screening.create
- [x] ZeroFootprintPage — handleSubmit wired to trpc.screening.create
- [x] BiometricEnrollmentPage — handleSubmit wired to trpc.screening.create
- [x] NigerianDataBundlePage — handleRun wired to trpc.lookup.nigerianDataBundle
- [x] KYCVerificationPage — getFinalDecision wired to trpc.kyc.create
- [x] StakeholderOnboardingWizard — handleSubmitApplication wired to trpc.onboarding.create
- [x] InvestigationDetail — handleAddNote wired to trpc.investigations.addNote

### Quality Gates
- [x] TypeScript: 0 errors
- [x] Tests: 15/15 passing
- [x] 0 remaining fetch('/api/...') calls to non-existent endpoints
- [x] 0 remaining setTimeout stubs in critical form submission paths

## Phase 10 — Suggested Next Steps

### Onboarding Admin View
- [x] /admin/onboarding page listing all applications with status filters
- [x] Approve/reject action buttons wired to trpc.onboarding.updateStatus
- [x] Wire /admin/onboarding route into App.tsx and sidebar nav

### Settings Persistence on Load
- [x] Settings.tsx calls trpc.settings.get on mount to pre-populate all form fields
- [x] All 5 setting sections (General, Security, Notifications, Integrations, Compliance) load from DB

### KYC AI Endpoint Proxy
- [x] trpc.kyc.extractDocument procedure — proxies /api/kyc/extract-document
- [x] trpc.kyc.detectTampering procedure — proxies /api/kyc/detect-tampering
- [x] trpc.kyc.verifyLiveness procedure — proxies /api/kyc/verify-liveness
- [x] trpc.kyc.matchFace procedure — proxies /api/kyc/match-face
- [x] KYCVerificationPage updated to use trpc.kyc.* instead of direct fetch('/api/kyc/...')

### Archive
- [x] Comprehensive project archive generated (bis-pwa-archive-v10-20260324.zip, 4.6 MB, 272 files)

## Phase 11 — Next Steps (Round 2)

### Role-Gate Onboarding Admin
- [x] Wrap onboarding.updateStatus in adminProcedure (role check server-side)
- [x] Wrap onboarding.list in adminProcedure
- [x] Conditionally hide "Onboarding Admin" sidebar link for non-admin users
- [x] Show 403 Forbidden message in OnboardingAdminPage for non-admins

### KYC Batch Status Dashboard
- [x] /kyc-records page with list of all KYC records from trpc.kyc.list
- [x] Pass/fail/review/pending filter chips
- [x] CSV export of filtered records
- [x] Re-verify action that triggers trpc.kyc.verify for flagged records
- [x] trpc.kyc.list procedure already in kycRouter
- [x] trpc.kyc.verify procedure already in kycRouter
- [x] Register /kyc-records route in App.tsx
- [x] Add KYC Records nav item to BISLayout sidebar

### Onboarding Email Notifications
- [x] Call notifyOwner in onboarding.create when new application submitted
- [x] Call notifyOwner in onboarding.updateStatus when status changes to approved/rejected
- [x] Owner notified with contactEmail context on terminal status changes

### Archive
- [x] Comprehensive project archive v11 generated (bis-pwa-archive-v11-20260324.zip, 72 MB, 1148 files)

## Phase 12 — Next Steps (Round 3)

### KYC Records Cursor Pagination
- [x] Add cursor-based pagination to trpc.kyc.list (cursor = last record id, limit = 50)
- [x] Update KYCRecordsPage with Load More button and page state
- [x] Show total count and loaded count in table footer

### Onboarding Document Upload
- [x] Add document upload step to StakeholderOnboardingWizard (Step 5: Documents)
- [x] Add trpc.onboarding.uploadDocument mutation (S3 storagePut + DB link)
- [x] Add document_urls column to onboarding_applications table (migration 0005)
- [x] Show uploaded file list with remove option in wizard
- [x] Queued documents auto-upload after application creation

### Admin Promotion
- [x] trpc.users.updateRole already existed (adminProcedure)
- [x] Add /admin/users page listing all users with role management
- [x] Register /admin/users route in App.tsx and sidebar (admin-only)

### Archive
- [x] Comprehensive project archive v12 generated (bis-pwa-archive-v12-20260324.zip, 72 MB, 1151 files)

## Phase 13 — Next Steps (Round 4) + DB Seed

### Uploaded Docs in Onboarding Admin Drawer
- [x] Fetch documentUrls from application record in OnboardingAdminPage detail drawer
- [x] Render clickable file list with download links in review drawer

### Filter-Aware KYC Pagination
- [x] Add status filter input to trpc.kyc.list cursor pagination
- [x] Enable Load More button when status filter is active (removed statusFilter === "all" restriction)

### User Audit Trail Deep-Link
- [x] Add "View Audit Log" action to each row in /admin/users
- [x] Deep-link to /audit-log?userId=X showing all actions for that user
- [x] AuditLogPage reads userId query param and pre-filters the table
- [x] Add userId filter to trpc.audit.list procedure

### Database Seed (local PostgreSQL 14)
- [x] Seed users table (10 users across all roles)
- [x] Seed tenants table (6 tenants)
- [x] Seed api_keys table (12 API keys)
- [x] Seed investigations table (25 investigations)
- [x] Seed investigation_notes table (31 notes in audit_log)
- [x] Seed screening_requests table (30 records)
- [x] Seed kyc_records table (20 records)
- [x] Seed alerts table (20 alerts)
- [x] Seed audit_log table (91 entries total)
- [x] Seed field_agents table (10 agents)
- [x] Seed field_tasks table (15 tasks)
- [x] Seed webhooks table (4 webhooks)
- [x] Seed onboarding_applications table (10 applications)
- [x] Seed platform_settings table (13 settings)
- [x] Seed monitors table (12 monitors)
- [x] Seed data_sources table (12 sources)
- [x] Seed reports table (10 reports)
- [x] Total: 291 rows across 16 tables

### Archive
- [x] Comprehensive project archive v13 generated (bis-pwa-archive-v13-20260324.zip)

## Phase 14 — Next Steps (Round 5)

### Connect App to Local PostgreSQL
- [x] DATABASE_URL already overridden to local PostgreSQL in server/_core/index.ts
- [x] App confirmed serving seeded data from local PostgreSQL (291 rows)

### Document Preview Modal
- [x] Add document preview modal to OnboardingAdminPage detail drawer
- [x] PDF files open in full-screen iframe modal
- [x] Image files open in full-screen img modal
- [x] Modal has close button, file name header, download link, click-outside to close

### Bulk KYC Re-Verify
- [x] Add checkbox column to KYCRecordsPage table (only review/failed rows are selectable)
- [x] Add Select All / Deselect All header checkbox (selects all eligible rows)
- [x] Add "Re-verify selected (N)" toolbar button with bulk action bar
- [x] Sequential parallel trpc.kyc.verify calls with animated progress bar (N of M)
- [x] Row highlight for selected records (bg-primary/5)
- [x] Toast summary on completion (X passed, Y failed)

### Archive
- [ ] Comprehensive project archive v14 generated

## Phase 15 — Next Steps (Round 6)

### Dashboard Live Stats
- [x] trpc.dashboard.stats already existed and queries real DB counts
- [x] Seeded bis_db with 291 rows — Dashboard now shows real counts
- [x] Verified: investigations, KYC, alerts, monitors, screening, biometric, duplicates all from DB

### Investigation Notes Full CRUD
- [x] Add trpc.investigations.updateNote procedure (FORBIDDEN for non-owners)
- [x] Add trpc.investigations.deleteNote procedure (FORBIDDEN for non-owners)
- [x] Add Edit button (pencil icon) to each analyst_note evidence item
- [x] Add Delete button with spinner to each analyst_note evidence item
- [x] Inline edit mode: textarea with Save/Cancel buttons
- [x] addNote now returns DB row id for use in edit/delete

### Alerts Acknowledge / Resolve
- [x] trpc.alerts.acknowledge already existed
- [x] Add trpc.alerts.resolve mutation (sets resolved=true + acknowledged, writes audit log)
- [x] Add trpc.alerts.dismiss mutation (sets dismissed=true)
- [x] Add resolved, resolvedBy, resolvedAt, dismissed columns to alerts table (migration 0006)
- [x] Fix getAlertStatus() helper: resolved > dismissed > reviewed > new
- [x] Resolve button shown only for reviewed alerts (emerald color)
- [x] Dismiss button shown only for new alerts
- [x] Stat cards updated: New/Critical/Reviewed/Resolved
- [x] Status badge uses getAlertStatus() for accurate display

### Archive
- [x] Comprehensive project archive v15 generated (bis-pwa-archive-v15-20260324.zip, 72 MB)

## Phase 16 — Next Steps (Round 7)

### Screening Requests List Page
- [x] trpc.screening.list procedure already existed with type/status filters and pagination
- [x] Build /screening-records page with type filter chips and status filter
- [x] Detail drawer showing full result JSON for each request
- [x] CSV export of filtered screening records
- [x] Register /screening-records route in App.tsx and sidebar nav (SCREENING group)
- [x] Wrap ScreeningRecordsPage in BISLayout for consistent shell

### Field Task Assignment from Investigation Detail
- [x] trpc.fieldTasks.dispatch procedure already existed
- [x] trpc.fieldAgents.list procedure already existed
- [x] Add "Dispatch Agent" button in Investigation Detail header actions
- [x] Build slide-over with agent selector, task type, priority, address, instructions fields
- [x] Dispatch wired to trpc.fieldTasks.dispatch with investigationId pre-filled
- [x] Dispatched task appears as field_task evidence item in timeline

### Continuous Monitor Alert Drill-Down
- [x] Add subjectRef query param support to Alerts page (useEffect on mount)
- [x] Pre-filter Alerts list when ?subjectRef=X is in URL with dismissible banner
- [x] Alert count badge in Continuous Monitoring navigates to /alerts?subjectRef=X
- [x] Add trpc.alerts.list subjectRef filter to server procedure

### Archive
- [ ] Comprehensive project archive v16 generated

## Phase 17 — Next Steps (Round 8)

### Escalation Workflow
- [x] Add alerts.escalate mutation (acknowledge + dispatch critical field task + notify owner + audit log)
- [x] Add Escalate button on critical/high new alerts in Alerts.tsx
- [x] Escalation dialog with agent selector and optional instructions
- [x] Owner notification via notifyOwner() on escalation

### Agent Recruitment Form
- [x] Add recruitOpen state and recruitMutation to FieldAgentsPage
- [x] Replace recruitment toast stub with real setRecruitOpen(true)
- [x] Build full slide-over with agentCode, name, email, phone, state, lga, tier, notes fields
- [x] Wire to trpc.fieldAgents.create mutation with cache invalidation

### Alert Rules Configuration Page
- [x] Add alert_rules table to drizzle schema and push migration
- [x] Add alertRulesRouter (list, create, update, delete) to server/routers.ts
- [x] Add alertRules to appRouter
- [x] Build AlertRulesPage with stats, rule list, create/edit dialog, delete confirm dialog
- [x] Register /alert-rules route in App.tsx
- [x] Add Alert Rules nav item to INTELLIGENCE group in BISLayout

### Tests
- [x] Write phase17.test.ts with 11 tests covering alertRules CRUD, alerts.escalate, fieldAgents.create
- [x] All 26 tests pass (3 test files)

### Archive
- [ ] Comprehensive project archive v17 generated (>= 17 MB)
