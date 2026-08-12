# Checkr.com vs BIS Platform — Gap Analysis

**Date:** 2026-06-29  
**Method:** Full feature inventory of Checkr API docs vs BIS server routers, schema tables, and service inventory.

---

## Existing BIS Features (No Duplication Needed)

The following Checkr capabilities are already present in BIS under different names or broader scope:

| Checkr Feature | BIS Equivalent | BIS Location |
|---|---|---|
| Global Watchlist Search | AML Watchlist / Sanctions screening | `server/lex.ts`, `services/aml-engine` |
| Identity Data Evaluation | KYC + BVN/NIN verification | `server/quickcheck.ts`, `services/verifier` |
| Candidate PII management | KYC Records + Investigations | `drizzle/schema.ts: kycRecords, investigations` |
| Adverse Media Search | Social Monitoring + LEX adverse media | `server/socialMonitoring.ts`, `server/lex.ts` |
| Webhooks | Webhook subscriptions | `drizzle/schema.ts: webhooks` |
| Multi-tenant hierarchy | Tenants + Nodes | `server/tenants.ts`, `drizzle/schema.ts: tenants` |
| API Key management | API Tokens | `server/apiTokens.ts`, `drizzle/schema.ts: apiTokens` |
| Report generation | Reports + Audit | `server/reports.ts`, `drizzle/schema.ts: reports` |
| Continuous monitoring | Monitors (sanctions/PEP/adverse_media/social) | `drizzle/schema.ts: monitors` |
| Drug screening (basic) | Screening requests (drug type) | `drizzle/schema.ts: screeningRequests` |
| Biometric verification | Biometric engine + liveness | `services/biometric-engine`, `server/biometric.ts` |
| Document management | Document Vault | `server/documentVault.ts` |
| Case management | Cases + Case timeline | `drizzle/schema.ts: cases, caseTimeline` |
| Audit logging | Audit log | `drizzle/schema.ts: auditLog` |
| User roles (Admin/Recruiter) | User roles (admin/user) | `drizzle/schema.ts: user.role` |
| Push notifications | Push subscriptions + broadcasts | `server/pushNotify.ts` |
| Search | OpenSearch indexer | `server/search.ts`, `services/opensearch-indexer` |
| Risk scoring | Risk engine + ML enrichment | `services/risk-engine`, `services/ml-enrichment` |

---

## Gaps: Checkr Features Missing from BIS

### Category 1 — Screening Types (Core Criminal & Identity)

| # | Checkr Feature | BIS Status | Gap |
|---|---|---|---|
| 1 | SSN Trace (US) | Partial — NIN/BVN only | Need SSN trace + address history builder |
| 2 | Sex Offender Registry Search | Missing | New screening type needed |
| 3 | National Criminal Search | Missing | New screening type needed |
| 4 | Federal Criminal Search (PACER) | Missing | New screening type needed |
| 5 | Federal District Criminal Search | Missing | New screening type needed |
| 6 | Federal Civil Search | Missing | New screening type needed |
| 7 | Federal District Civil Search | Missing | New screening type needed |
| 8 | County Criminal Search | Missing | New screening type needed |
| 9 | State Criminal Search | Missing | New screening type needed |
| 10 | FACIS Search (healthcare exclusions) | Missing | New screening type needed |

### Category 2 — Motor Vehicle & Transport

| # | Checkr Feature | BIS Status | Gap |
|---|---|---|---|
| 11 | Motor Vehicle Report (MVR) | Partial — screeningTypeEnum has "mvr" but no implementation | Full MVR screening needed |
| 12 | Drug & Alcohol Clearinghouse (FMCSA) | Missing | New screening type needed |
| 13 | FMCSA PSP Search | Missing | New screening type needed |

### Category 3 — Employment & Education Verification

| # | Checkr Feature | BIS Status | Gap |
|---|---|---|---|
| 14 | Employment Verification | Missing | New screening type + verifier integration |
| 15 | Education Verification | Missing | New screening type + verifier integration |
| 16 | Personal Reference Verification | Missing | New screening type needed |
| 17 | Professional Reference Verification | Missing | New screening type needed |
| 18 | Professional License Verification | Missing | New screening type needed |

### Category 4 — International Screenings

| # | Checkr Feature | BIS Status | Gap |
|---|---|---|---|
| 19 | International Criminal Search (200+ countries) | Missing | New international screening service |
| 20 | International Education Verification | Missing | New international screening service |
| 21 | International Employment Verification | Missing | New international screening service |
| 22 | International Global Watchlist Search | Partial — AML covers some | Expand to 200+ country coverage |
| 23 | International Identity Document Validation | Partial — KYC document review | Expand to international ID docs |
| 24 | International Adverse Media Search | Partial — social monitoring | Expand to international media |
| 25 | International Motor Vehicle Report | Missing | New international screening service |

### Category 5 — Workflow & Compliance

| # | Checkr Feature | BIS Status | Gap |
|---|---|---|---|
| 26 | Screening Packages (bundled checks) | Missing | Package builder + CRUD |
| 27 | Programs (per-business-unit screening programs) | Missing | Programs CRUD + assignment |
| 28 | Assessments / Auto-assess rules engine | Missing | Rules engine for pass/fail |
| 29 | Invitations (hosted apply flow) | Partial — hostedVerificationLinks | Full candidate invitation + apply flow |
| 30 | Checkr-hosted candidate experience | Partial — hosted links | Full hosted portal with disclosures |
| 31 | eSignature collection (ESIGN Act) | Missing | eSignature capture + PDF generation |
| 32 | Consumer rights disclosure (FCRA) | Missing | FCRA disclosure presentation |
| 33 | State-specific disclosures | Missing | State disclosure library |
| 34 | Authorization PDF generation | Missing | PDF generation + storage |
| 35 | Candidate consent upload | Missing | Consent document upload endpoint |
| 36 | Geos (geographic compliance rules) | Missing | Geo-based compliance filter engine |
| 37 | Report ETA | Missing | ETA calculation per screening type |
| 38 | Report Tags | Missing | Custom label system for reports |
| 39 | Report Addresses (from SSN trace) | Missing | Address history table + API |
| 40 | Candidate Stories | Missing | Candidate-provided context for records |

### Category 6 — Adverse Action (FCRA Compliant)

| # | Checkr Feature | BIS Status | Gap |
|---|---|---|---|
| 41 | Pre-adverse action notice | Missing | Pre-adverse notice with 5-day wait |
| 42 | Adverse action notice (final) | Missing | Final adverse action notice |
| 43 | Adverse Items (individual flagged records) | Missing | Adverse items table + API |
| 44 | Dispute management | Missing | Candidate dispute workflow |
| 45 | Individualized assessment workflow | Missing | Assessment + adjudication UI |

### Category 7 — Continuous Checks & Subscriptions

| # | Checkr Feature | BIS Status | Gap |
|---|---|---|---|
| 46 | Continuous Checks (post-hire monitoring) | Partial — monitors table | Full continuous check subscription + re-screen |
| 47 | Subscription management (per event type) | Partial — webhooks table | Per-event-type subscription management |

### Category 8 — I-9 / Work Authorization

| # | Checkr Feature | BIS Status | Gap |
|---|---|---|---|
| 48 | FORM I-9 (work authorization) | Missing | I-9 form + worksite management |
| 49 | Worksites | Missing | Worksite CRUD |

### Category 9 — Hierarchy & Multi-Tenancy

| # | Checkr Feature | BIS Status | Gap |
|---|---|---|---|
| 50 | Node hierarchy (parent/child accounts) | Partial — tenants table | Full node tree with inheritance |
| 51 | Per-node package/geo settings | Missing | Node-level configuration |
| 52 | Per-node user roles | Missing | Node-scoped RBAC |

### Category 10 — Billing & Analytics

| # | Checkr Feature | BIS Status | Gap |
|---|---|---|---|
| 53 | Per-screening billing (TigerBeetle ledger) | Partial — billing topups | Per-screening charge ledger |
| 54 | Screening analytics (volume, TAT, pass rates) | Missing | Screening analytics dashboard |
| 55 | Report volume by package/program | Missing | Analytics aggregation |

---

## Summary

| Category | Total Checkr Features | Already in BIS | Net Gaps |
|---|---|---|---|
| Screening Types (Criminal/Identity) | 10 | 2 (partial) | 8 new + 2 expand |
| Motor Vehicle / Transport | 3 | 1 (partial) | 2 new + 1 expand |
| Employment & Education | 5 | 0 | 5 new |
| International | 7 | 2 (partial) | 5 new + 2 expand |
| Workflow & Compliance | 15 | 3 (partial) | 12 new + 3 expand |
| Adverse Action | 5 | 0 | 5 new |
| Continuous Checks | 2 | 1 (partial) | 1 new + 1 expand |
| I-9 / Work Authorization | 2 | 0 | 2 new |
| Hierarchy | 3 | 1 (partial) | 2 new + 1 expand |
| Billing & Analytics | 3 | 1 (partial) | 2 new + 1 expand |
| **Total** | **55** | **11 (partial)** | **44 gaps** |

---

## Implementation Plan

All 44 gaps will be implemented across the following layers:

1. **Database schema** — 12 new tables in `drizzle/schema.ts`
2. **tRPC BFF** — 8 new routers in `server/`
3. **Rust microservice** — `services/screening-engine` (criminal/MVR/watchlist)
4. **Python microservice** — `services/screening-scorer` (ML-based risk scoring per screening)
5. **Go gateway** — APISIX plugin for screening rate-limiting + OpenAppsec WAF rules
6. **Middleware** — Kafka topics, Temporal workflows, TigerBeetle ledger, Lakehouse sink
7. **PWA** — 6 new pages + updates to existing screening pages
8. **React Native** — Candidate apply flow + screening status tracker
