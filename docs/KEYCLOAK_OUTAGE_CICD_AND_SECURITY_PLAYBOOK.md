# Keycloak Outage Drill, Migration-Safe CI/CD, and Refresh-Token Security Playbook

**Author:** Manus AI  
**Status:** Production implementation reference. This document defines target operating behavior for the BFF-owned PKCE, refresh-session, lease, and Helm architecture described in the accompanying BIS references. It does not assert that the current deployment has every control enabled.

## Operating Model and Safety Boundaries

The BFF, not the browser, is responsible for holding encrypted Keycloak refresh tokens and for serializing refresh rotation through the PostgreSQL lease row. A total Keycloak outage therefore has two distinct effects. An already valid BIS session cookie can continue to authenticate requests that do not need a new Keycloak token, while any operation requiring a new Keycloak access token must fail closed after the locally defined session grace policy. New interactive login and any BFF refresh must return a clear, retryable availability error rather than silently reusing a stale refresh token.

Keycloak session durability is deployment-dependent. Keycloak’s documented persistent-session feature stores sessions in its database and can reload a missing in-memory session, but login, refresh, and logout still increase database activity and latency sensitivity. [1] This makes a Keycloak outage drill incomplete unless it tests both the Keycloak service and its session database dependency.

| System state | Allowed behavior | Prohibited behavior |
|---|---|---|
| Valid BIS cookie, no downstream Keycloak token needed | Authenticate within the configured local-cookie lifetime and serve operations explicitly classified as outage-tolerant. | Extending the cookie or asserting that Keycloak is reachable. |
| Access token nearing expiry, refresh endpoint unavailable | Return a retryable `503 idp_temporarily_unavailable` with `Retry-After`; preserve the encrypted refresh row and release the lease. | Retrying an ambiguous refresh request with the old token or exposing token details to the browser. |
| New login or callback | Display the IdP outage state and retain a sanitized `returnTo` route. | Creating a local user session without completed OIDC authentication. |
| High-risk action requiring recent authentication | Deny with `reauthentication_unavailable` and retain an immutable audit event. | Downgrading the action’s authentication requirement during the outage. |
| Keycloak returns after outage | Resume only new refresh transactions after discovery, JWKS, token endpoint, and synthetic login checks pass. | Replaying refresh attempts that timed out while the IdP was unavailable. |

## 1. Concrete Total-Keycloak-Outage Disaster-Recovery Drill

### 1.1 Drill objective and controls

The drill validates that a Keycloak outage neither causes an unauthorized extension of an active session nor creates a refresh storm or repeated use of a single-use refresh token. It must run in a staging environment with an isolated Keycloak realm, synthetic users, a representative Keycloak session database, BFF replicas in at least two pods, Prometheus, Grafana, and Alertmanager. It must never be run by blocking the production identity provider without a formally approved change and customer communication plan.

| Required role | Responsibility during drill |
|---|---|
| Drill lead | Declares start/stop, validates boundaries, owns the go/no-go decision. |
| BFF operator | Verifies readiness, refresh outcomes, lease cleanup, and pod behavior. |
| Keycloak operator | Applies and removes the staged outage fault and validates recovery health. |
| Database operator | Observes Keycloak and BFF PostgreSQL health; confirms no lease corruption. |
| Security observer | Confirms no token value is logged, exported in metrics, or pasted into incident artifacts. |
| Communications observer | Exercises internal and customer-facing templates without sending a real public incident notice. |

Before beginning, create two synthetic users. User A should have an active BFF cookie and an access token with a deliberately short lifetime; User B should have no active BFF session. Open two browser tabs for User A, and arrange for both to request refresh at the same point. Capture baseline values for BFF refresh success ratio, p95 refresh duration, lease contention, Keycloak availability, and BFF replica availability.

### 1.2 Failure injection

Inject the outage at the network boundary between the BFF namespace and Keycloak service. A temporary NetworkPolicy or service-mesh deny rule is preferable because it tests the same network failure class seen by BFF pods without deleting Keycloak data.

```yaml
# staging-only fault; apply only after the drill start is declared.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-bff-to-keycloak-drill
  namespace: bis-staging
  labels:
    bis.example.com/drill: keycloak-total-outage
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: bff
  policyTypes: [Egress]
  egress:
    # Intentionally omit the Keycloak namespace/service destination.
    # Include only the DNS and PostgreSQL destinations needed for BFF survival.
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
```

The exact policy must be adapted to the cluster’s CNI semantics before the drill. Confirm that the injection affects only the staging BFF selector and cannot accidentally isolate monitoring, database, or unrelated services.

### 1.3 Step-by-step execution

| Drill step | Operator action | Expected BFF and user outcome | Evidence to collect |
|---|---|---|---|
| 1. Establish baseline | Run the synthetic login for User A, visit an outage-tolerant page, and record metrics. | Login, refresh, and page navigation succeed. | Sanitized correlation IDs, metrics screenshots, Keycloak health result. |
| 2. Verify concurrency baseline | Trigger two refresh calls from User A’s tabs. | One BFF transaction claims the lease; the other waits/polls and adopts the resulting cookie. Exactly one Keycloak refresh occurs. | `bis_auth_refresh_lease_claims_total`, refresh version before/after, no token values. |
| 3. Inject outage | Apply the staging deny rule and confirm Keycloak discovery/token endpoint cannot be reached from BFF pods. | Existing BFF pods remain live. Readiness stays true only if its database and local dependencies are healthy; IdP health is reported separately. | NetworkPolicy UID, BFF logs with redacted error class, Keycloak black-box probe failure. |
| 4. Test active valid session | Use User A’s still-valid BIS cookie on outage-tolerant routes. | The BFF authenticates the local cookie only for operations permitted by policy; it does not call Keycloak. | Route audit events and no refresh metric increment. |
| 5. Test expiry and refresh | Let User A’s BFF access/refresh path require Keycloak, then invoke `/api/auth/refresh` from both tabs. | The lease claimant records `provider_unavailable`; the waiting tab receives the same bounded availability response. The BFF releases/clears the lease. | One refresh outcome per terminal attempt, lease expiry/clear state, HTTP `503` and `Retry-After`. |
| 6. Test new login | Navigate User B to sign-in. | The BFF’s PKCE start route may redirect only if Keycloak authorization endpoint is reachable; otherwise it renders a clear outage message and preserves safe `returnTo`. No local cookie is issued. | HTTP response, no new session row, no OIDC transaction leaked. |
| 7. Test high-risk path | Attempt an action classified as requiring fresh or recent authentication. | The BFF denies the action while the IdP is unavailable and writes a reason-coded audit event. | Audit event and user-facing error classification. |
| 8. Observe alerting | Hold the fault through the configured alert duration. | Refresh user-impact and/or Keycloak black-box alert fires; unrelated pod-health alert does not page unless replicas are actually unavailable. | Alert event, runbook link, alert routing destination. |
| 9. Recover IdP path | Remove the deny rule. First verify Keycloak discovery, JWKS, token endpoint, and a synthetic test login. | BFF does not replay timed-out refresh attempts. A new User A refresh creates a new lease claim and succeeds. | Recovery checklist results, metrics return toward baseline. |
| 10. Close and review | Delete staging fault artifact, confirm no lingering deny policy, and examine leases. | No active expired lease remains; no synthetic session was unintentionally promoted to production. | Change record, final metrics, action items. |

The stop condition is any unexpected success of a new login while Keycloak is unreachable, a high-risk action accepted without its required assurance, a token value appearing in telemetry, an unbounded retry loop, a lease that remains held beyond its expiry policy, or the fault escaping the designated staging namespace.

### 1.4 Recovery decision tree

```text
Keycloak unavailable
        |
        +-- Local BFF cookie valid and route is outage-tolerant? -- yes --> allow until local policy expiry
        |                                                     |
        |                                                     no
        v
Does request need new Keycloak token or fresh assurance? -- no --> deny if route policy says not outage-tolerant
        |
       yes
        v
Return bounded 503 / reauthentication unavailable
        |
        +-- Do not retry old refresh token after a timeout
        +-- Clear lease; revoke only if outcome is ambiguous after send
        +-- Once IdP health passes: start a brand-new refresh transaction
```

## 2. GitHub Actions CI/CD Pipeline for Expand–Contract Migration and Helm Deployment

### 2.1 Pipeline principles

The pipeline separates code rollout from irreversible database contract changes. A failed Helm rollout can be rolled back, but a completed data migration cannot safely be “rolled back” by dropping fields that a prior pod version may still read. Therefore the pipeline permits automatic rollback of an application release but requires explicit, auditable promotion between expand, backfill, feature activation, and contract phases.

GitHub Actions OIDC can exchange a workflow identity for a short-lived cloud credential after a trust relationship is configured; this is preferable to a long-lived Kubernetes or cloud credential stored as a GitHub secret. [2] Restrict the cloud trust policy to this repository, protected branch, target environment, and optionally a named reusable workflow.

| Pipeline stage | Trigger | Immutable output | Required gate |
|---|---|---|---|
| Verify | Pull request | Test/build/SBOM/Helm-render artifacts | Unit, integration, migration lint, image scan, Helm lint. |
| Build | Protected main merge | Signed image by Git SHA and immutable chart package | CI and CodeQL success. |
| Expand | Approved staging then production environment | Additive nullable columns/index jobs only | Backup/failover health, migration manifest validation, operator approval for production. |
| Backfill | After expand deployment | Idempotent batch-job execution evidence | Backfill progress, error count zero, canary read compatibility. |
| Activate | After all BFF replicas run dual-compatible release | Feature-flag rollout record | Refresh/lease SLOs and synthetic flows remain healthy. |
| Contract | Separate approved change after compatibility window | Validated constraints/legacy-code removal | Backfill zero, no legacy-cookie/version traffic, restore rehearsal. |

### 2.2 Repository conventions

```text
.github/workflows/
  verify.yml
  release-auth.yml
  deploy-auth.yml
deploy/helm/bis-auth/
  Chart.yaml
  values.yaml
  values-staging.yaml
  values-production.yaml
database/refresh-leases/
  001-expand.sql
  002-indexes-concurrently.sql
  003-backfill.ts
  004-contract.sql
  manifest.yaml
scripts/
  validate-refresh-migration.sh
  wait-for-backfill.sh
  synthetic-auth-check.sh
```

Each migration carries an immutable ID, phase, checksum, owner, required application version, rollback classification, and whether it may be executed transactionally. The CI validation script rejects a `contract` migration in the same release as an `expand` migration and rejects `CREATE INDEX CONCURRENTLY` inside transaction-managed migration tooling.

```yaml
# database/refresh-leases/manifest.yaml
schema: bis.refresh-lease/v1
migrations:
  - id: refresh-lease-expand-v1
    phase: expand
    file: 001-expand.sql
    transactional: true
    minimumAppVersion: 2026.08.18-dual-read
  - id: refresh-lease-indexes-v1
    phase: expand
    file: 002-indexes-concurrently.sql
    transactional: false
    minimumAppVersion: 2026.08.18-dual-read
  - id: refresh-lease-backfill-v1
    phase: backfill
    file: 003-backfill.ts
    transactional: false
    minimumAppVersion: 2026.08.18-dual-read
  - id: refresh-lease-contract-v1
    phase: contract
    file: 004-contract.sql
    transactional: true
    minimumAppVersion: 2026.09.XX-no-legacy
```

### 2.3 Pull-request verification workflow

```yaml
# .github/workflows/verify.yml
name: Verify
on:
  pull_request:
    branches: [main]
permissions:
  contents: read
  security-events: write
  packages: read
concurrency:
  group: verify-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  app:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: bis_ci
          POSTGRES_USER: bis_ci
          POSTGRES_PASSWORD: ${{ secrets.CI_POSTGRES_PASSWORD }}
        options: >-
          --health-cmd "pg_isready -U bis_ci -d bis_ci"
          --health-interval 5s --health-timeout 5s --health-retries 20
        ports: ["5432:5432"]
    env:
      DATABASE_URL: postgresql://bis_ci:${{ secrets.CI_POSTGRES_PASSWORD }}@localhost:5432/bis_ci
      NODE_ENV: test
      KEYCLOAK_URL: https://keycloak.test.invalid
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v6
        with: { node-version-file: .nvmrc, cache: pnpm }
      - uses: pnpm/action-setup@v5
        with: { version: 11 }
      - run: pnpm install --frozen-lockfile
      - run: ./scripts/validate-refresh-migration.sh database/refresh-leases/manifest.yaml
      - run: pnpm check --noEmit
      - run: pnpm test
      - run: pnpm build
      - uses: azure/setup-helm@v4
      - run: helm lint deploy/helm/bis-auth
      - run: helm template bis-auth deploy/helm/bis-auth -f deploy/helm/bis-auth/values-staging.yaml > rendered.yaml
      - run: kubeconform -strict -summary rendered.yaml
```

The service password in this example must be a short-lived CI secret or an ephemeral runner value; do not use a production database credential. In a managed CI implementation, use a generated per-run password rather than a repository-level value where supported.

### 2.4 Build and deploy workflow

The cloud-specific OIDC login action is intentionally isolated. The example uses an abstract `configure-cloud-credentials` step; replace it with the approved provider action and a workload identity constrained to the production environment. Do not substitute a static cluster-admin kubeconfig secret.

```yaml
# .github/workflows/deploy-auth.yml
name: Deploy BFF Authentication
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [staging, production]
        required: true
      phase:
        type: choice
        options: [expand, backfill, activate, contract]
        required: true
      image_sha:
        required: true
  push:
    branches: [main]
    paths:
      - server/**
      - client/**
      - deploy/helm/bis-auth/**
      - database/refresh-leases/**
      - .github/workflows/deploy-auth.yml

permissions:
  contents: read
  id-token: write
  packages: write
  attestations: write
  security-events: read
concurrency:
  group: bis-auth-${{ inputs.environment || 'staging' }}
  cancel-in-progress: false

jobs:
  package:
    if: github.event_name == 'push'
    runs-on: ubuntu-24.04
    outputs:
      image: ${{ steps.meta.outputs.image }}
    steps:
      - uses: actions/checkout@v6
      - id: meta
        run: echo "image=ghcr.io/${GITHUB_REPOSITORY}@sha256:${{ github.sha }}" >> "$GITHUB_OUTPUT"
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository }}/bis-auth:${{ github.sha }}
          provenance: mode=max
          sbom: true

  deploy:
    needs: [package]
    if: always() && (github.event_name == 'workflow_dispatch' || needs.package.result == 'success')
    runs-on: ubuntu-24.04
    environment: ${{ inputs.environment || 'staging' }}
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v6
      - uses: azure/setup-helm@v4
      - uses: azure/setup-kubectl@v4
      - name: Obtain short-lived cloud credential through GitHub OIDC
        uses: your-cloud-provider/configure-cloud-credentials@v1
        with:
          role-to-assume: ${{ vars.K8S_DEPLOY_ROLE }}
          audience: ${{ vars.K8S_OIDC_AUDIENCE }}
      - name: Set cluster context
        run: ./scripts/configure-kube-context.sh "${{ inputs.environment || 'staging' }}"
      - name: Verify backup and database health before mutation
        run: ./scripts/preflight-auth-deploy.sh "${{ inputs.environment || 'activate' }}"
      - name: Execute phase-specific migration job
        env:
          PHASE: ${{ inputs.phase || 'activate' }}
        run: ./scripts/run-refresh-migration-phase.sh "$PHASE"
      - name: Deploy dual-compatible BFF and Nginx
        run: |
          helm upgrade --install bis-auth deploy/helm/bis-auth \
            --namespace bis-auth --create-namespace \
            --values deploy/helm/bis-auth/values-${{ inputs.environment || 'staging' }}.yaml \
            --set image.tag=${{ inputs.image_sha || github.sha }} \
            --set refreshLeases.phase=${{ inputs.phase || 'activate' }} \
            --atomic --wait --timeout 10m
      - name: Run synthetic post-deploy tests
        run: ./scripts/synthetic-auth-check.sh "${{ inputs.environment || 'staging' }}" "${{ inputs.phase || 'activate' }}"
      - name: Publish deployment evidence
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: auth-deploy-evidence-${{ github.run_id }}
          path: artifacts/
```

The `--atomic --wait` Helm deployment controls Kubernetes-resource rollback, not the completed database phase. Helm documents that `--atomic` enables waiting and rolls back a failed release; database operations must remain compatible with both release versions regardless. [3]

### 2.5 Phase runner behavior

```bash
#!/usr/bin/env bash
# scripts/run-refresh-migration-phase.sh
set -Eeuo pipefail
phase="$1"

case "$phase" in
  expand)
    ./scripts/assert-migration-manifest.sh expand
    kubectl -n bis-auth apply -f deploy/jobs/refresh-lease-expand.yaml
    kubectl -n bis-auth wait --for=condition=complete job/refresh-lease-expand --timeout=15m
    kubectl -n bis-auth apply -f deploy/jobs/refresh-lease-indexes.yaml
    kubectl -n bis-auth wait --for=condition=complete job/refresh-lease-indexes --timeout=45m
    ;;
  backfill)
    ./scripts/assert-migration-manifest.sh backfill
    kubectl -n bis-auth apply -f deploy/jobs/refresh-lease-backfill.yaml
    ./scripts/wait-for-backfill.sh
    ;;
  activate)
    ./scripts/assert-dual-read-version.sh
    ./scripts/assert-backfill-complete.sh
    ;;
  contract)
    ./scripts/assert-no-legacy-refresh-traffic.sh
    ./scripts/assert-backup-and-restore-rehearsed.sh
    kubectl -n bis-auth apply -f deploy/jobs/refresh-lease-contract.yaml
    kubectl -n bis-auth wait --for=condition=complete job/refresh-lease-contract --timeout=15m
    ;;
  *) echo "Unsupported phase: $phase" >&2; exit 64 ;;
esac
```

## 3. Security Incident Playbook: Compromised Refresh-Token Chain

### 3.1 Incident activation criteria

Open a security incident when any of the following is credible: the same refresh chain is accepted from divergent expected attributes or locations after controls normalize those attributes; Keycloak reports reuse/invalid-grant patterns that cannot be explained by normal rotation; encrypted refresh material, key-encryption key, session signing root, or BFF secret storage is suspected exposed; an operator observes unexplained subject mismatch; or the revocation alert crosses the agreed baseline.

The BFF must classify provider errors without storing raw provider text in metric labels. Prometheus labels must remain bounded; user IDs, email addresses, session identifiers, authorization codes, and token values are prohibited because they create high-cardinality sensitive series. [4]

| Incident level | Example trigger | Decision authority | Primary objective |
|---|---|---|---|
| SEV-2 | One suspicious user session or bounded invalid-grant anomaly. | Security on-call with auth service owner. | Contain one family and preserve evidence. |
| SEV-1 | Confirmed token-chain replay, encrypted token material exposure, encryption key compromise, or broad Keycloak session abuse. | Incident commander and security lead. | Stop refresh issuance, globally invalidate where required, restore trusted identity state. |
| SEV-0 | Active widespread account takeover or identity provider breach affecting multiple production systems. | Executive incident authority. | Contain systemic access, protect customers, invoke legal/privacy response. |

### 3.2 First-response procedure

1. **Declare and preserve.** Create an incident ID, appoint an incident commander, security lead, communications lead, recorder, BFF operator, Keycloak operator, and database operator. Preserve sanitized correlation IDs, timestamps, pod IDs, audit event IDs, Keycloak event IDs, and deployment revisions. Never copy a token, code, verifier, refresh ciphertext, IV, or authentication header into incident material.

2. **Contain narrowly when possible.** For a single chain, set `revoked_at`, clear the BFF lease, increment the family/session version, and revoke the corresponding Keycloak user/client session through the audited administration path. The next BFF request clears the cookie and requires login.

3. **Freeze the refresh path when scope is unknown.** Set the server-side feature flag `REFRESH_GRANT_ENABLED=false`, deploy it through the approved configuration path, and make `/api/auth/refresh` return a bounded `503 refresh_temporarily_disabled`. Do not delete records before evidence and scope are established.

4. **Escalate to global invalidation when needed.** For encryption key exposure, broad replay, or database integrity loss, increment the BFF `global_session_epoch`, revoke active local rows, rotate encryption/signing secrets in the secret manager, perform Keycloak realm/client session logout, and force interactive login. Validate that old cookie epochs fail on every BFF replica.

5. **Eradicate and recover.** Fix the root cause, deploy a reviewed fix, verify Keycloak discovery/JWKS/token endpoints, run synthetic auth checks with a dedicated test user, re-enable refresh only under a canary flag, and monitor revocation/error outcomes.

6. **Close with accountability.** Document affected scope, customer effect, token/session action taken, key rotations, recovered controls, evidence location, and follow-up items. Preserve audit records according to retention policy.

### 3.3 Audited containment examples

These commands illustrate intent. They must be wrapped by the existing dual-control administration procedure, use workload identity, and write an immutable audit record. They are not an authorization bypass.

```sql
BEGIN;
UPDATE keycloak_refresh_sessions
SET revoked_at = now(),
    revoke_reason = 'SEC-INC-2026-001_suspected_chain_reuse',
    refresh_lease_id = NULL,
    refresh_lease_expires_at = NULL,
    refresh_version = refresh_version + 1,
    updated_at = now()
WHERE id = :session_family_id
  AND revoked_at IS NULL;

INSERT INTO event_log (event_type, actor_id, subject_id, payload, created_at)
VALUES (
  'auth.refresh_chain_contained',
  :security_operator_id,
  :affected_user_id,
  jsonb_build_object('incidentId', 'SEC-INC-2026-001', 'scope', 'single_session_family'),
  now()
);
COMMIT;
```

```bash
# Keycloak session termination through an approved service account. Never echo its token.
curl --fail-with-body --silent \
  -X POST "${KEYCLOAK_ADMIN_URL}/admin/realms/${KEYCLOAK_REALM}/logout-all" \
  -H "Authorization: Bearer ${KEYCLOAK_ADMIN_ACCESS_TOKEN}" \
  -H "Content-Length: 0"
```

### 3.4 Communication templates

#### Internal incident channel

> **[SEV-1] Refresh-token chain security investigation — `SEC-INC-YYYY-NNN`**  
> **Declared:** `YYYY-MM-DD HH:MM UTC`  
> **Incident commander:** `<name>`; **Security lead:** `<name>`; **Communications lead:** `<name>`  
> **Observed symptom:** `<bounded metric/audit observation; no token or user PII>`  
> **Customer impact:** `<known / being assessed>`  
> **Containment:** `<single-family revocation | refresh freeze | global epoch increment>`  
> **Do not share:** tokens, authorization codes, PKCE material, decrypted refresh fields, secret values, or user PII.  
> **Next update:** `<specific UTC time or event trigger>`

#### Executive update

> **Subject:** Security incident update — authentication session containment in progress  
> We detected `<plain-language symptom>` at `<UTC timestamp>`. The response team has contained `<scope>` by `<action>`. At this time, the confirmed customer impact is `<impact or “under assessment”>`. We have not found evidence of `<claim only if verified>`. The next update will be provided `<time/event>`. The detailed investigation remains in incident `SEC-INC-YYYY-NNN`.

#### Customer status-page message

> **Investigating authentication disruption**  
> We are investigating an authentication security issue affecting some sign-in or session-refresh attempts. As a precaution, some users may be asked to sign in again. Our services continue to protect account access, and we are working to restore normal authentication behavior. We will provide another update by `<UTC time>`.

Do not claim that data were or were not accessed until forensics establishes the fact. If notification obligations may apply, route all external wording through the privacy, legal, and regulatory teams.

#### Resolution notice

> **Resolved: authentication security containment**  
> The containment actions for the authentication security issue have been completed. Some users may need to sign in again as a result of protective session invalidation. We continue to monitor the service and are completing a post-incident review. Additional customer communication will be provided if the investigation establishes that it is required.

## 4. Validation and Approval Checklist

| Gate | Evidence required before production approval |
|---|---|
| Outage drill | Staging drill record proves no new session, no token reuse, bounded error response, correct alerting, and clean recovery. |
| CI/CD | PR pipeline validates migration phase order, Helm render, image/SBOM/provenance, test suite, and policy checks. |
| OIDC deployment identity | Cloud trust policy restricts GitHub repository, branch, environment, and workflow; no static cluster-admin secret is present. |
| Database | Backup and restore rehearsal succeeds; expand/backfill feature gate remains rollbackable. |
| Security incident | Single-family and global invalidation drills create audited records without exposing token data. |
| Communications | Security, legal/privacy, and support owners have approved notification templates and escalation contacts. |

## References

[1] [Keycloak: Keeping Users Logged In with Persistent User Sessions](https://www.keycloak.org/2024/06/persistent-user-sessions-in-preview)  
[2] [GitHub Actions: OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect)  
[3] [Helm: `helm upgrade`](https://helm.sh/docs/helm/helm_upgrade/)  
[4] [Prometheus: Metric and Label Naming](https://prometheus.io/docs/practices/naming/)  
[5] [Prometheus: Alerting Best Practices](https://prometheus.io/docs/practices/alerting/)  
[6] [PostgreSQL: `CREATE INDEX` and Concurrent Index Builds](https://www.postgresql.org/docs/current/sql-createindex.html)  
[7] [Kubernetes: Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
