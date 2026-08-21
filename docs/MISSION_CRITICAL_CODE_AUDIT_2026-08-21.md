# Mission-Critical Code Audit — 21 August 2026

**Author:** Manus AI  
**Scope:** BIS BFF, payment and ledger integration, Paystack verification and retry handling, reconciliation controls, tenant authorization, privileged recovery paths, and deployed-edge configuration.

## Executive Assessment

This review found material flow-of-funds defects in the payment-credit path. The defects were repaired in code and protected with targeted regressions, but the system is **not production-ready for money movement** while its managed PostgreSQL database and dependent production services remain unavailable. The application now fails closed rather than treating an unposted ledger credit as successful; this is safer, but it does not substitute for a running, migrated, independently monitored production environment.

| Domain | Weight | Evidence-based score | Rationale |
|---|---:|---:|---|
| Flow-of-funds correctness | 25 | 16 | Deterministic ledger identifiers, pre-credit claims, reconciliation-only failures, and retry leases are implemented; a live ledger/database exercise remains unavailable. |
| Authorization and insider controls | 20 | 14 | Permify, OPA/PBAC, MFA, dual-control, break-glass evidence, billing and core transaction tenant checks, and core payment-rail tenant isolation are implemented; proof against a live database remains unavailable. |
| Persistence and recovery | 20 | 11 | Retry queue, lease expiry, and recovery contract are versioned; migration application is blocked by unavailable PostgreSQL and Drizzle snapshot collisions. |
| Test and build evidence | 15 | 10 | Strict type checking, 55 Vitest files / 1,409 tests, targeted payment regressions, and production build pass locally. No live-provider or production database proof exists. |
| Operational security and resilience | 15 | 6 | Caddy, APISIX, OpenAppSec, OPA, Keycloak MFA, canary, bounded k6 scenarios, and fail-closed production configuration are code-complete. The deployed site is still degraded and the authorized staging exercise has not run. |
| Published service availability | 5 | 0 | The published service and its database/dependency stack are not healthy enough for attested financial operations. |
| **Overall** | **100** | **57 / 100** | The source is materially safer than before the audit but cannot be represented as production-ready for flow-of-funds. |

## Verified Findings and Remediation

| ID | Severity | Finding | Remediation completed | Evidence |
|---|---|---|---|---|
| FOF-01 | Critical | The Paystack top-up path wrote its idempotency record only after requesting a TigerBeetle credit. A timeout after ledger acceptance could be retried with a new random transfer ID and create a duplicate credit. | A unique provider reference is claimed before the ledger side effect; TigerBeetle transfer IDs are deterministically derived from the reference. | `server/billing.ts`; `server/billing.flowFundsGuard.test.ts` |
| FOF-02 | Critical | A TigerBeetle failure returned `success: true` with a fallback transfer ID, representing an unposted customer balance as credited. | The path now retains a `pending:` reconciliation marker and returns a retryable service-unavailable error. No PostgreSQL-only balance is created. | `server/billing.ts`; `server/routers.ts` |
| FOF-03 | High | Paystack verification accepted a successful provider response without confirming that provider metadata bound the payment to the requesting tenant. | The reference and `metadata.tenant_id` must both match the authenticated request tenant before a ledger claim is created. | `server/billing.ts`; `server/billing.flowFundsGuard.test.ts` |
| FOF-04 | High | Webhook retry enqueue used an invalid raw execution path before its parameterized statement, allowing a persistence error to prevent durable retry creation. | Enqueue now performs exactly one parameterized insert and fails closed when durable persistence is unavailable. | `server/webhookRetry.ts`; `server/webhookRetry.flowFunds.test.ts` |
| FOF-05 | High | Multiple retry workers could select the same pending webhook and independently call the ledger. | Workers atomically lease a due item with `UPDATE … RETURNING`; expired leases are recovered after five minutes. | `server/webhookRetry.ts`; `drizzle/migrations/0062_financial_retry_reliability.sql` |
| FOF-06 | High | The retry queue was referenced by code but lacked a versioned typed schema and repository migration. | Added typed `webhookRetryQueue` schema and migration 0062 with uniqueness, positive amount check, status constraint, due index, and lease index. | `drizzle/schema.ts`; migration 0062 |
| AUTH-01 | High | Billing procedures accepted a caller-supplied tenant ID without consistently comparing it to the authenticated context tenant. | Tenant-scoped identities are now denied cross-tenant billing access; only explicit platform-admin context retains global scope. | `server/billing.ts`; `server/billing.flowFundsGuard.test.ts` |
| AUTH-02 | High | The generic transaction mutation allowed a non-admin caller to set `completed` or `reversed`, which could misrepresent settlement outside the authoritative ledger workflow. | The generic transaction update is now admin-gated, excludes settled states, rejects changes to settled records, and scopes read/update/flag operations to tenant context. | `server/transactions.ts`; `server/transactions.securityGuard.test.ts` |
| AUTH-03 | High | Payment-rail transfer reads, workflow status checks, local account-name enrichment, account details, exports, and reversal selection could resolve another tenant’s transaction by globally unique reference or account identifier. | These core paths now add tenant predicates for tenant-scoped contexts; platform administrators retain intentionally global access. | `server/paymentRails.ts` |
| CFG-01 | High | Development gateway, WAF, edge, audit, and localhost service defaults could be inherited by a production process. | Production defaults now resolve to empty values, and startup requires explicit gateway, ledger, authorization, identity, cache, WAF, edge, audit, and monitoring configuration. | `server/_core/env.ts`; `server/envProductionDefaults.test.ts` |

## Validation Evidence

The following validations passed after the final code changes.

| Validation | Result |
|---|---|
| Strict TypeScript | Passed locally with `pnpm check --noEmit` |
| Payment binding, deterministic ledger ID, tenant access | 5 targeted tests passed |
| Webhook durability and concurrent lease guard | 3 targeted tests passed |
| Full Vitest suite | 55 files, 1,409 tests passed |
| Production bundle | `pnpm build` passed; bundle-size warnings remain non-blocking |
| GitHub main validation and CodeQL | Passed for the previously synchronized hardening changes; the audit remediation requires a subsequent checkpoint and CI run |

## Residual Risks and Required Release Gates

| Risk | Release gate | Current state |
|---|---|---|
| Managed PostgreSQL unavailable | Configure the PostgreSQL connection, apply migrations 0061 and 0062, and verify tables, constraints, and leases using the BFF database identity. | Blocked |
| Migration generator collision | Repair `drizzle/meta` parent-snapshot collision, regenerate and review migration state, then retain the reviewed migration history. | Blocked |
| Live provider and ledger ambiguity | Run an authorized staging test that simulates accepted-but-timeout TigerBeetle responses and proves a retry observes the deterministic transfer rather than double-crediting. | Not run |
| Payment-rail reporting completeness | Extend explicit tenant-scope regression coverage to every payment-rail analytics and scheduling endpoint, then execute it against a real PostgreSQL dataset. | Open |
| Retry queue deployment | Apply migration 0062 before enabling retry workers; do not start them against an unverified schema. | Blocked |
| Production edge validation | Execute the authorized WAF/rate-limit/k6 staging scenario and capture error-rate, latency, rate-limit, and correlation-ID evidence. | Not run |

## Release Decision

> **Do not authorize production financial operations at this time.** The code remediations reduce duplicate-credit, false-success, and cross-tenant risk, but the absence of an available managed PostgreSQL database and live ledger/provider validation leaves the remaining failure modes unproven. The next acceptable release gate is a migrated PostgreSQL environment followed by an end-to-end, failure-injected top-up and reconciliation test.
