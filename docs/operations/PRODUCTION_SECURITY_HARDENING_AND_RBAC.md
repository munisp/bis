# Production Security Hardening and RBAC Privilege Separation

## Deployment principle

BIS uses **workload separation, tenant isolation, explicit permission checks, and fail-closed dependency behavior**. A production identity is assigned one operational purpose. There is no shared administrator token, no application service account with Kubernetes write authority, and no worker identity that can both approve and execute its own financial or restricted-data decision.

> A Kubernetes ServiceAccount is not an application role. Kubernetes RBAC governs cluster API access; Permify and tenant-scoped application procedures govern BIS data access. Both layers must grant access for any privileged operation.

## Required workload identities

| Workload | Kubernetes identity | Kubernetes access | Application/secret boundary | Prohibited privilege |
|---|---|---|---|---|
| BFF | `bis-bff` | None; token automount disabled | Runtime DB, KMS/evidence, Permify, and provider secret references only | K8s API mutation, direct ledger administration, provider credential export. |
| Gateway | `bis-gateway` | None; token automount disabled | Gateway service credential and fail-closed upstream client config | Tenant administrator, schema migration, storage-admin access. |
| Scheduled workers | `bis-worker` | None; token automount disabled | Narrow workflow/database/KMS credentials for their domain | Human reconciliation approval, application admin, Kubernetes API access. |
| Migration job | `bis-migration` | Read a named release ConfigMap only | Database migration identity with DDL scope, activated only during approved release | Secret read/list, workload deployment changes, application requests. |
| Observability | `bis-observability` | None; token automount disabled | Metrics token/certificate only | Database writes, evidence reads, application authorization. |
| Human administrator | External SSO identity | No cluster-admin by default | Tenant-scoped Permify administrator relation | Approval of their own payment/reconciliation/override request. |

## Application privilege separation

| Operation | Requester | Independent approver/reviewer | Enforced boundary |
|---|---|---|---|
| Score-policy activation | Policy author | Different authorized administrator | Four-eyes `created_by <> approved_by`, policy status/effective date, audit event. |
| Biometric outcome | Consent-bound subject/requesting process | Human reviewer | Engine output becomes pending review; no automatic consequential outcome. |
| Restricted agency request | Authorized institution operator | Different authority approver | Purpose, authority, consent/legal basis, encrypted outbox, source authorization. |
| Intelligence billing uncertainty | Worker/system | Different tenant administrator | `requested_by <> reviewed_by`; deterministic ledger transfer ID is immutable. |
| Billing refund | Requester | Different billing administrator | Four-eyes refund workflow; ledger reconciliation remains separate. |
| Consumer dispute resolution | Case worker | Supervisor where escalation exists | Tenant lock, statutory clock, append-only event trail. |

## Production checklist

### Identity and access

1. Use OIDC/SSO with phishing-resistant MFA for administrators. Disable local shared accounts and require a break-glass account stored in a controlled vault.
2. Apply `infra/permify/bis.perm` and tenant-specific tuples. Run same-tenant allow, cross-tenant deny, unavailable-Permify deny, and self-approval deny tests before release.
3. Apply `infra/kubernetes/bis-production-rbac-and-networkpolicy.yaml`; verify `kubectl auth can-i --as=system:serviceaccount:bis-production:bis-worker '*' '*' -n bis-production` returns **no**. Verify the migration service account can only `get` the named ConfigMap.
4. Disable service-account token automount for all BIS workloads. Use short-lived workload identity only where a platform integration requires it.

### Secrets and cryptography

1. Store every secret as a reference to Vault/KES/HSM or the approved secret manager; do not put secret values in manifests, ConfigMaps, images, traces, dashboards, or CI logs.
2. Enforce TLS with private CA pinning between BFF, Permify, MinIO/KES, PostgreSQL, and the OTLP collector. Rotate certificates before their alert threshold.
3. Maintain separate versioned keyrings for consumer dispute outbox, institutional outbox, evidence, and billing/reconciliation data. Retain prior key versions through the approved recovery window only.
4. Validate SSE-KMS protocol, KMS key identity, and `x-amz-checksum-sha256` custody result. A storage/KES/Vault failure must prevent custody completion.

### Network and runtime

1. Start with namespace default-deny network policy. Add only documented BFF→PostgreSQL/Permify/KMS, gateway→approved dependencies, worker→its required store, and Prometheus→metrics routes. Never use broad `0.0.0.0/0` egress for a provider integration.
2. Run containers non-root with all capabilities dropped, read-only root filesystem, seccomp runtime default, no privilege escalation, pinned image digests, resource limits, and a writable `emptyDir` only where strictly needed.
3. Expose `/metrics` only through mTLS/network policy and `METRICS_TOKEN`. Restrict gateway `/internal/metrics` to its dedicated service key.
4. Enable OpenAppSec at ingress in prevention mode after controlled false-positive validation; forward only sanitized request/trace IDs to logs.

### Supply chain, resilience, and operations

1. Require protected-branch review, signed immutable image provenance, SCA/secret scanning, CodeQL, tests, migration checksum validation, and deployment approval.
2. Run PostgreSQL base backup/WAL restore drills and TigerBeetle replica recovery drills monthly. See `POSTGRES_TIGERBEETLE_DISASTER_RECOVERY_AND_PITR.md`.
3. Monitor authentication errors, Permify denial/errors, KMS/evidence custody failures, transactional outbox health, billing stale leases, reconciliation queue age, dead letters, trace exporter failure, and WAF signals.
4. Incident responders must preserve trace/request IDs, immutable audit events, database/ledger evidence, and deployment/image digests. They must not alter historical records, reuse failed transfer IDs with changed inputs, or delete forensic evidence.

## Release evidence

A production release needs a signed checklist, `kubectl auth can-i` transcript, network-policy test evidence, secret reference scan, image digest list, tenant-isolation test evidence, key rotation state, recovery drill evidence, tracing export smoke test, and OBS-001 dashboard/alert verification. Missing evidence blocks release.
