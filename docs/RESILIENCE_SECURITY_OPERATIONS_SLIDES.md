# BIS Identity Resilience & Security Operations

## Cover

**Identity Resilience & Security Operations**

**Keycloak Outage Recovery, Safe Delivery, and Refresh-Session Defense**

Manus AI | August 2026

## Slide 1

**The operating objective: fail closed, recover predictably**

- Keep refresh tokens exclusively inside the BFF; browsers hold a short-lived `HttpOnly` BIS cookie only.
- Allow only explicitly outage-tolerant local-session routes while Keycloak is unreachable.
- Treat each refresh as a database-serialized transaction, not a browser retry loop.

## Slide 2

**One trusted path governs session recovery**

- Browser → Nginx/Ingress → BFF → Keycloak and PostgreSQL refresh-session store.
- The BFF owns PKCE, state/nonce, token validation, encrypted refresh storage, and lease coordination.
- Prometheus receives bounded outcomes; logs receive sanitized correlation IDs—not credentials.

## Slide 3

**The Keycloak outage drill proves the real user contract**

- Inject a directed BFF-to-Keycloak partition only in `bis-staging` with synthetic users and a finite expiry.
- Valid local sessions follow route policy; new login, refresh, and fresh-assurance actions fail with bounded availability errors.
- Recovery requires a brand-new refresh transaction; timed-out refresh attempts are never replayed.

## Slide 4

**Chaos must be bounded by policy, not intent**

- Chaos Mesh targets BFF labels and Keycloak destination labels; a staging-only admission policy rejects broader scope.
- Litmus is an alternative controller when its workflow/probe model is the platform standard—never run both for one fault.
- Abort immediately on namespace mismatch, non-synthetic activity, token leakage, unbounded retries, or orphaned leases.

## Slide 5

**Observability shows user pain and containment**

- Measure refresh outcome, duration, lease contention, revocations, BFF availability, and database health.
- Page on sustained user-visible refresh failure; warn on lease contention and scrape degradation.
- Labels remain bounded: no user ID, session ID, token, email, raw error message, or authorization code.

## Slide 6

**STRIDE focuses defenses on the refresh trust boundaries**

- Spoofing: PKCE S256, one-time state/nonce, issuer/audience/subject binding, hardened cookies.
- Tampering and disclosure: AEAD-encrypted token rows, CAS leases, least-privilege database roles, private metrics.
- DoS and privilege escalation: single-flight leases, bounded timeouts, rate limits, fresh assurance, and dual control.

## Slide 7

**Deploy schema change as an expand–contract program**

- Expand nullable lease/version/epoch fields and concurrent indexes before requiring them.
- Backfill in short idempotent batches, then deploy dual-compatible BFF replicas and canary the feature flag.
- Contract only after legacy traffic reaches zero and restore rehearsal, synthetic checks, and audit gates pass.

## Slide 8

**CI/CD separates reversible app rollout from irreversible data change**

- Pull requests validate test, build, migration manifest, Helm render, and policy checks against disposable PostgreSQL.
- Protected deployment uses short-lived GitHub OIDC workload identity—not a static cluster-admin credential.
- Helm `--atomic --wait` protects resource rollout; phase gates protect data compatibility and recovery.

## Slide 9

**Contain refresh-token compromise at the smallest safe scope**

- Revoke one session family first, clear its lease, increment version, and terminate the matching Keycloak session.
- Freeze refresh issuance when scope is unknown; do not destroy evidence or repeat ambiguous provider requests.
- For key exposure or broad replay, increment global session epoch, revoke active rows, rotate roots, and force reauthentication.

## Slide 10

**Operational readiness is a chain of verifiable gates**

- Staging chaos drill: bounded user behavior, alert routing, lease cleanup, and recovery verified.
- Security drill: targeted and global invalidation create immutable audit evidence without leaking credentials.
- Production promotion: backups, restore rehearsal, OIDC trust, migration phase evidence, and approved communication owners.

## Slide 11

**Next decision: make resilience executable in staging**

- Approve a Docker/Kubernetes-capable staging environment and scoped chaos-controller installation.
- Implement the BFF-owned PKCE, refresh lease, metrics, and audit contracts before enabling fault injection.
- Start with one finite Keycloak partition drill; expand only after every success and abort condition is automated.
