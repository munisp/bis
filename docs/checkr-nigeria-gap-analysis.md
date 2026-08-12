# Checkr.com → Nigerian Background Screening Platform: Gap Analysis

**Date:** 2026-06-29  
**Regulatory Framework:** NDPR 2019, CBN AML/CFT Guidelines, EFCC Act, ICPC Act, CAC Act 2020, NPC Act, Labour Act, Immigration Act (NIS), NIMC Act, NIBSS Standards, NCC Regulations.

---

## Mapping: Checkr Feature → Nigerian Equivalent

Every Checkr screening type has a direct Nigerian equivalent. The table below maps each one and identifies whether BIS already covers it (fully, partially, or not at all).

| # | Checkr (US) Feature | Nigerian Equivalent | Data Source / Regulator | BIS Status |
|---|---|---|---|---|
| 1 | SSN Trace + Address History | NIN Trace + Address History (NIMC) | NIMC NIN API | Partial — NIN lookup exists, no address history builder |
| 2 | Sex Offender Registry Search | NDLEA Drug Offender Register + Sex Offender (State Police) | Nigeria Police Force, NDLEA | Missing |
| 3 | National Criminal Search | Nigeria Police Force Criminal Records Check (CRC) | NPF Criminal Records Bureau | Missing |
| 4 | Federal Criminal Search | EFCC Watchlist + ICPC Debarment List | EFCC, ICPC APIs | Partial — AML watchlist covers EFCC; ICPC missing |
| 5 | Federal District Criminal Search | Federal High Court Records Search | Federal High Court (NICN) | Missing |
| 6 | Federal Civil Search | Federal Civil Court Records | Federal High Court | Missing |
| 7 | County Criminal Search | State Magistrate / High Court Records | 36 State Judiciaries | Missing |
| 8 | State Criminal Search | State Police Command Records | NPF State Commands | Missing |
| 9 | Motor Vehicle Report (MVR) | FRSC Driver's Licence + Vehicle Licence Check | FRSC API | Partial — screeningTypeEnum has mvr, no impl |
| 10 | Drug & Alcohol Clearinghouse | NDLEA Drug Conviction Register | NDLEA | Missing |
| 11 | FMCSA PSP (transport pre-employment) | FRSC Commercial Driver History | FRSC | Missing |
| 12 | Education Verification | WAEC/NECO/NABTEB Certificate Verification | WAEC, NECO, NABTEB portals | Missing |
| 13 | Employment Verification | Previous Employer Verification (PenCom + direct) | PenCom RSA, employer contact | Missing |
| 14 | Personal Reference Verification | Personal Reference Check | Direct contact | Missing |
| 15 | Professional Reference Verification | Professional Reference Check | Direct contact | Missing |
| 16 | Professional License Verification | COREN (engineers), NBA (lawyers), MDCN (doctors), ICAN (accountants), COREN, NSE, ICAN, CIBN, NIM | Professional councils | Missing |
| 17 | Global Watchlist Search | OFAC + UN + EU + CBN Sanctions + EFCC + INTERPOL | BIS AML engine | Covered — AML engine |
| 18 | Adverse Media Search | Nigerian Adverse Media (Punch, Vanguard, ThisDay, NAN) | Social monitoring + LEX | Partial — social monitoring covers some |
| 19 | International Criminal Search | INTERPOL Red Notice + African Union Watchlist | INTERPOL, AU | Partial — global watchlist covers INTERPOL |
| 20 | International Education Verification | Foreign Degree Verification (NYSC attestation, WES) | NYSC, WES | Missing |
| 21 | International Employment Verification | Foreign Employment Verification | Direct contact | Missing |
| 22 | International Identity Document Validation | International Passport Validation (NIS) + Foreign ID | NIS, NIMC | Partial — KYC document review |
| 23 | International Adverse Media | International Adverse Media | Social monitoring | Partial |
| 24 | International MVR | Foreign Driving Licence Verification | NIS, foreign authorities | Missing |
| 25 | FACIS Search (healthcare exclusions) | MDCN Suspension/Revocation Register + HEFAMAA | MDCN, HEFAMAA | Missing |
| 26 | Identity Data Evaluation (fraud) | BVN Fraud Blacklist + NIBSS BVN Watch | NIBSS BVN API | Partial — BVN lookup exists, no fraud blacklist |
| 27 | FORM I-9 (work authorization) | Work Permit / Expatriate Quota (NIS) | Nigerian Immigration Service | Missing |
| 28 | Screening Packages (bundles) | Screening Packages (NG-specific bundles) | BIS internal | Missing |
| 29 | Programs (per-BU) | Programs / Screening Programs | BIS internal | Missing |
| 30 | Auto-assess Rules Engine | Auto-assess Rules (NG compliance thresholds) | BIS internal | Missing |
| 31 | Candidate Invitation Flow | Candidate Invitation (email + SMS via NCC-registered channels) | BIS internal | Partial — hosted links |
| 32 | eSignature (ESIGN Act) | eSignature (NITDA Electronic Transactions Act) | NITDA | Missing |
| 33 | FCRA Consumer Rights Disclosure | NDPR Data Subject Rights Disclosure | NDPR 2019 | Missing |
| 34 | State-specific Disclosures | State-level Disclosures (Lagos, Abuja, Rivers, Kano) | State laws | Missing |
| 35 | Authorization PDF Generation | Consent PDF (NDPR Article 2.2) | NITDA, NDPR | Missing |
| 36 | Geo-based Compliance Filters | State-level Compliance Rules (36 states + FCT) | State laws | Missing |
| 37 | Report ETA | Report ETA (per screening type SLA) | BIS internal | Missing |
| 38 | Report Tags | Report Tags | BIS internal | Missing |
| 39 | Report Addresses (from NIN trace) | Address History (from NIN trace) | NIMC | Missing |
| 40 | Candidate Stories | Candidate Stories (NDPR right to explanation) | NDPR | Missing |
| 41 | Pre-adverse Action Notice | Pre-adverse Notice (NDPR + Labour Act) | NDPR, Labour Act | Missing |
| 42 | Adverse Action Notice | Adverse Action Notice | NDPR, Labour Act | Missing |
| 43 | Adverse Items | Adverse Items | BIS internal | Missing |
| 44 | Dispute Management | Dispute Management (NDPR right to rectification) | NDPR Art. 3.1(7) | Missing |
| 45 | Continuous Checks (post-hire) | Continuous Monitoring (post-hire) | BIS monitors table | Partial — monitors table exists |
| 46 | Per-event Webhook Subscriptions | Per-event Webhook Subscriptions | BIS webhooks table | Partial |
| 47 | Node Hierarchy | Node Hierarchy (parent/child tenants) | BIS tenants table | Partial |
| 48 | Per-node Package/Geo Settings | Per-node Configuration | BIS internal | Missing |
| 49 | Per-screening Billing | Per-screening TigerBeetle Ledger | TigerBeetle | Partial — billing exists, not per-screening |
| 50 | Screening Analytics | Screening Analytics Dashboard | Lakehouse | Missing |

---

## Nigerian-Specific Additions (Not in Checkr)

These are features required for Nigerian compliance that Checkr does not have:

| # | Feature | Regulator | Priority |
|---|---|---|---|
| N1 | NYSC Discharge Certificate Verification | NYSC | High |
| N2 | CAC Directorship / Beneficial Ownership Search | CAC | High |
| N3 | PenCom RSA Employment History | PenCom | High |
| N4 | NDPR Consent Ledger (immutable consent audit trail) | NITDA / NDPR | High |
| N5 | BVN Fraud Blacklist (NIBSS BVN Watch) | NIBSS | High |
| N6 | EFCC Asset Declaration Check | EFCC | Medium |
| N7 | ICPC Debarment List | ICPC | Medium |
| N8 | NCC Telecom Subscriber Verification | NCC | Medium |
| N9 | FRSC Vehicle Ownership Check | FRSC | Medium |
| N10 | CBN Bank Verification (account ownership) | CBN / NIBSS | Medium |
| N11 | NDLEA Drug Conviction Register | NDLEA | High |
| N12 | NIS Work Permit / Expatriate Quota Verification | NIS | High |
| N13 | MDCN / NBA / ICAN / COREN Professional Licence | Professional Councils | High |
| N14 | State Court Records (36 states + FCT) | State Judiciaries | High |
| N15 | WAEC / NECO / NABTEB Certificate Verification | WAEC, NECO, NABTEB | High |

---

## Net Implementation Scope

| Layer | New Items |
|---|---|
| Database tables | 16 new tables |
| tRPC routers | 8 new routers (screening-orders, packages, programs, assessments, adverse-actions, consents, work-permits, screening-analytics) |
| Screening types (enum extension) | 28 new types added to screeningTypeEnum |
| Rust microservice | `services/screening-engine` (criminal/court/watchlist/FRSC) |
| Python microservice | `services/screening-scorer` (ML risk per screening) |
| Go APISIX plugin | Screening rate-limit + OpenAppsec WAF rules |
| Kafka topics | 6 new topics (bis.screening.ordered/completed/failed/adverse/consent/analytics) |
| Temporal workflows | 1 new workflow (NG multi-step screening orchestration) |
| TigerBeetle | Per-screening charge entries |
| Lakehouse | Screening analytics sink |
| PWA pages | 7 new pages |
| React Native screens | 4 new screens |
