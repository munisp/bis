# Isolated On-Premises MinIO, Vault/KES, and Permify Runbook

**Purpose:** Deploy and validate BIS’s private, S3-compatible evidence-custody and Permify authorization controls in an isolated **staging** environment. The profile uses MinIO plus KES backed by HashiCorp Vault’s K/V v2 engine, but its BFF contract remains portable to any S3-compatible platform satisfying the required checksum/SSE-KMS capabilities.

> **Never use Vault development mode, MinIO’s default credentials, HTTP, sample secrets, consumer documents, NINs, BVNs, provider credentials, or a production-named bucket in this procedure.** The configuration files are templates; a secret manager must render the actual runtime environment outside the Git worktree.

The KES documentation identifies KES as a legacy integration path and advises new MinIO AIStor deployments to use MinIO KMS. This guide retains KES because it is a tested MinIO-to-Vault path; operators with MinIO KMS should implement the same BIS capability contract and run the identical synthetic acceptance suite. [1]

## 1. What must exist before startup

| Component | Minimum secure state | Do not proceed when |
|---|---|---|
| Host/container runtime | Docker/Compose or Podman-compatible runtime, private network, encrypted persistent volumes, signed immutable images by digest | Images use mutable tags, the host has unpatched critical defects, or service ports are Internet-exposed. |
| Private PKI | CA and distinct certificate/key pairs for Vault, KES, MinIO, BFF, and administrative clients. SANs must match the service names/ingress names used. | Any service uses HTTP, an invalid SAN, a shared private key, or a public self-signed certificate outside the approved private CA. |
| Vault | Non-development Vault using integrated Raft, initialized/unsealed by an approved ceremony or HSM/transit auto-unseal, mTLS listener, audited storage, backups tested. | `-dev`, in-memory storage, root-token runtime access, or an uninitialized/sealed cluster is used. |
| Vault K/V | Dedicated **K/V v2** mount named `kv` and the KES AppRole bound only to `kv/data/bis/staging/kes/*` / `kv/metadata/bis/staging/kes/*`. | The KES policy is broad (`kv/*`), has root policy, or shares a production prefix. |
| KES | mTLS, root identity break-glass only, MinIO policy restricted to `bis-evidence-*`, no offline key cache, audit logging enabled. | KES can reach unrelated key names, has `offline > 0s`, runs without TLS, or uses a copied API key. |
| MinIO | Dedicated staging data volume, private HTTPS endpoint, versioning, SSE-KMS default for the evidence bucket, private bucket policy, lifecycle expiry for synthetic prefixes. | It is public, uses a production bucket, has no versioning/lifecycle, or SSE-KMS cannot be proven. |
| Permify | PostgreSQL-backed, TLS/private network, preshared runtime authentication, distinct policy-admin and BFF check-only identities. | The BFF can write tuples/schema, runtime tenant ID is blank/defaulted, or policy checks are unauthenticated. |
| BFF/PostgreSQL | Canonical migrations `0007`–`0009`; BFF workload can use only the evidence prefixes and Permify check API. | A client/device gets storage/KMS credentials, or a broad administrator token is used for testing. |

## 2. Repository configuration assets

| File | Purpose | Secret status |
|---|---|---|
| `docker-compose.onprem.yml` | Adds the portable BFF storage/Permify contract and read-only BFF hardening. | No secrets. |
| `infra/onprem/docker-compose.minio-kes-vault.yml` | Isolated Vault, KES, MinIO, synthetic-bucket bootstrap, and private Permify profile. | No secrets. |
| `infra/onprem/templates/vault.hcl` | Vault Raft/mTLS template. | No secrets; operator must add selected seal mechanism outside Git. |
| `infra/onprem/templates/kes.yaml` | KES-to-Vault K/V v2 profile limited to evidence-key names. | No secret values; variables are rendered at runtime. |
| `infra/onprem/templates/vault-kes-policy.hcl` | Least-privilege KES Vault policy. | No secrets. |
| `infra/onprem/minio-bootstrap.sh` | Staging-only private versioned bucket, SSE-KMS default, and lifecycle bootstrap. | No secrets. |
| `infra/onprem/bis-onprem.env.example` | Exhaustive variable inventory. | Template only; rendered environment is ignored by Git. |
| `infra/permify/bis.perm` | Supervisor-only consumer-dispute policy. | No secrets. |

## 3. Render secure runtime configuration

Copy `infra/onprem/bis-onprem.env.example` to an operator-controlled secret-manager output such as `/run/secrets/bis/bis-onprem.env`. Never copy it under the repository as a real `.env` file.

The profile requires these key values:

```dotenv
# Staging-only BIS storage contract.
BIS_DEPLOYMENT_ENV=staging
BIS_EVIDENCE_S3_ENDPOINT=https://minio:9000
BIS_EVIDENCE_S3_REGION=onprem-1
BIS_EVIDENCE_S3_BUCKET=bis-staging-evidence
BIS_EVIDENCE_S3_FORCE_PATH_STYLE=true
BIS_EVIDENCE_S3_SSE_ALGORITHM=aws:kms
BIS_EVIDENCE_S3_KMS_KEY_ID=bis-evidence-staging-v1

# BFF-only application keyring; this is separate from the Vault/KES storage key.
BIS_EVIDENCE_ACTIVE_KEY_VERSION=v1
BIS_EVIDENCE_KEYRING=v1:<BASE64_32_BYTE_APPLICATION_KEY>

# BFF runtime authorization identity; do not use it for schema/tuple writes.
PERMIFY_URL=https://permify-tls:8443
PERMIFY_TENANT_ID=bis-staging
PERMIFY_API_KEY=<BFF_CHECK_ONLY_SECRET>

# MinIO/KES/Vault identities. All values are supplied from the secret manager.
MINIO_ROOT_USER=<OPERATOR_USER>
MINIO_ROOT_PASSWORD=<OPERATOR_SECRET>
MINIO_KES_API_KEY=<MINIO_TO_KES_SECRET>
MINIO_KES_IDENTITY=<PUBLIC_IDENTITY_HASH>
VAULT_KES_ROLE_ID=<APPROLE_ID>
VAULT_KES_SECRET_ID=<APPROLE_SECRET_ID>
KES_ROOT_IDENTITY=<BREAK_GLASS_PUBLIC_IDENTITY_HASH>
```

Set both `BIS_EVIDENCE_S3_ACCESS_KEY` and `BIS_EVIDENCE_S3_SECRET_KEY` only if the selected MinIO deployment requires a BFF-specific static service account. Otherwise leave both absent and configure the runtime’s standard credential provider. BIS rejects a partial pair.

## 4. Fail-closed isolated preflight

Before starting a service, render the templates under an operator-owned configuration directory and set the required environment variables. Then run the local-only validator:

```sh
cd /srv/bis
export BIS_ENV=staging
export BIS_ONPREM_VALIDATION_CONFIRMATION=I_APPROVE_ISOLATED_ONPREM_PROFILE_VALIDATION
set -a
. /run/secrets/bis/bis-onprem.env
set +a
export BIS_ONPREM_CONFIG_DIR=/etc/bis/onprem-config
export BIS_ONPREM_PKI_DIR=/etc/bis/pki
pnpm validate:onprem-s3-kms
```

The command makes **no network call**. It rejects a non-staging environment, missing confirmation, template marker, non-HTTPS object-storage or Permify URL, non-`aws:kms` profile, non-path-style MinIO setting, incomplete static credential pair, development/in-memory Vault configuration, Vault without Raft/mTLS, KES without TLS Vault access or `offline: 0s`, broad KES key namespace, and a Vault policy outside the staging K/V v2 prefix.

| Preflight test | Expected result |
|---|---|
| Omit `BIS_ONPREM_VALIDATION_CONFIRMATION` | Non-zero exit before reading endpoints. |
| Set `BIS_ENV=production` | Non-zero exit; production is prohibited. |
| Set `BIS_EVIDENCE_S3_SSE_ALGORITHM=AES256` | Non-zero exit. |
| Provide an access key without its secret | Non-zero exit. |
| Add `inmem` to `vault.hcl` | Non-zero exit. |
| Set KES offline cache to a nonzero duration | Non-zero exit. |
| Broaden Vault policy from `bis/staging/kes/*` | Non-zero exit. |

## 5. Vault and KES initialization

These commands are run from an administrative workstation connected to the isolated network, not inside the BFF or the acceptance runner. The specific Vault unseal/HSM process is selected by the operator’s approved cryptographic standard; do not add a token or unseal key to Compose.

1. Start Vault only, use the non-development Raft/TLS configuration, initialize it through the approved ceremony, and securely distribute recovery/unseal material outside the deployment host.
2. Enable Vault K/V v2 at `kv/`, apply `infra/onprem/templates/vault-kes-policy.hcl`, enable AppRole, and create a KES AppRole. Store the Role ID/Secret ID only in the secret manager.
3. Issue KES server, KES client, MinIO, and BFF certificates from the private CA. Compute the MinIO KES identity from its KES credential/certificate according to the deployed KES version, then populate `MINIO_KES_IDENTITY`.
4. Render `kes.yaml` with the secret-manager values. The template allows only `bis-evidence-*` key operations, has `offline: 0s`, and checks that the configured active evidence key exists before accepting requests.
5. Start KES. Verify its ready/status endpoint using the approved mTLS administrative identity. Create `bis-evidence-staging-v1` in the KMS before MinIO starts. A missing/deactivated key must leave KES/MinIO unavailable rather than falling back to unencrypted storage.

MinIO documents that an SSE/KES deployment needs an external key before encrypted operations and that the object store requires KES and the external KMS to decrypt its backend/start normally. [1] Vault development mode is explicitly in-memory and unsuitable for production-like use. [2]

## 6. Start the isolated Compose profile

Use image digests maintained by the operator’s signed-image process. This example intentionally does not supply image names or secrets:

```sh
cd /srv/bis
set -a
. /run/secrets/bis/bis-onprem.env
set +a
export BIS_ONPREM_CONFIG_DIR=/etc/bis/onprem-config
export BIS_ONPREM_PKI_DIR=/etc/bis/pki
export BIS_ONPREM_MINIO_BOOTSTRAP_CONFIRMATION=I_APPROVE_SYNTHETIC_STAGING_BUCKET_BOOTSTRAP
export MINIO_SYNTHETIC_RETENTION_DAYS=7

docker compose \
  -f docker-compose.yml \
  -f docker-compose.onprem.yml \
  -f infra/onprem/docker-compose.minio-kes-vault.yml \
  --env-file /run/secrets/bis/bis-onprem.env \
  up -d vault kes minio minio-bootstrap permify bff
```

The one-shot `minio-bootstrap` service refuses non-staging, a missing confirmation, HTTP endpoint, production-named bucket, missing KMS key ID, or invalid retention. After MinIO is reachable over TLS, it creates/reuses the staging bucket, enables versioning, sets SSE-KMS default encryption to the configured opaque key ID, disables anonymous access, and adds lifecycle expiry for `kyc/`, `consumer-disputes/`, and `field-evidence/` prefixes.

The Compose profile does not expose Permify publicly; Vault, KES, and MinIO console bind to loopback by default. Use a hardened mutually authenticated ingress only when an external administrative endpoint is necessary.

## 7. Apply the Permify schema and supervisor mappings

First apply the policy through a separate policy-admin key. The BFF `PERMIFY_API_KEY` is runtime/check-only and should not be used for this operation.

```sh
cd /srv/bis
export BIS_ENV=staging
export PERMIFY_SCHEMA_APPLY_CONFIRMATION=I_APPROVE_PERMIFY_SCHEMA_APPLY
export PERMIFY_URL=https://permify-tls:8443
export PERMIFY_TENANT_ID=bis-staging
export PERMIFY_API_KEY=<POLICY_ADMIN_SECRET_FROM_SECRET_MANAGER>
pnpm permify:apply-schema
```

Then write relationships with the policy-admin identity. The exact supervisor tuple is:

```json
{
  "entity": {"type": "platform", "id": "bis"},
  "relation": "consumer_dispute_supervisor",
  "subject": {"type": "user", "id": "<BIS_SUPERVISOR_USERS_ID>"}
}
```

Write a separate `consumer_dispute_caseworker` tuple for caseworkers; do not promote caseworkers to supervisor. Verify with three runtime calls: a mapped supervisor must receive `RESULT_ALLOWED`; an analyst/caseworker must receive `RESULT_DENIED`; an unavailable Permify endpoint must result in BFF `FORBIDDEN` without creating a consumer-dispute transition.

## 8. Run the live synthetic custody acceptance test

After BFF migrations and service health are confirmed, create one synthetic KYC record and a short-lived token restricted to that record and tenant. The acceptance runner receives no MinIO, KES, Vault, or Permify secret.

```sh
export BIS_ENV=staging
export BIS_STAGING_CONFIRMATION=I_APPROVE_NON_PRODUCTION_SSE_KMS_ACCEPTANCE
export STAGING_BFF_URL=https://<BFF_STAGING_INGRESS>
export STAGING_MOBILE_ACCESS_TOKEN=<SHORT_LIVED_SCOPED_BFF_TOKEN>
export STAGING_KYC_RECORD_ID=<SYNTHETIC_ONLY_KYC_RECORD_ID>
export STAGING_EXPECTED_KMS_KEY_ID=bis-evidence-staging-v1
export STAGING_DATA_RETENTION_CONFIRMED=synthetic-only-approved
export BIS_STAGING_REPORT_PATH=/var/lib/bis-artifacts/sse-kms-acceptance.json
pnpm staging:sse-kms-evidence
```

The expected sequence is: anonymous initiation denied; signed checksum/SSE-KMS headers present; a same-length byte substitution rejected; exact bytes uploaded through the presigned URL; BFF `HeadObject` reports the same SHA-256 checksum, exact length/type, `aws:kms`, and the expected KMS key; custody completion becomes `verified`. A missing checksum, acceptance of substituted bytes, changed KMS key, checksum-read failure, or cleanup failure is a release gate failure.

## 9. Required evidence and cleanup

Retain only redacted evidence: release SHA, configuration version, migration version, policy schema version, KMS key identifier, object-key hash, custody-event hash, synthetic record identifier, runner boolean result, and lifecycle completion evidence. Revoke the test token, remove any temporary operator grants, and verify lifecycle/retention behavior. Do not retain document bytes, URLs, token values, Vault secrets, KES API keys, or full object metadata in tickets.

## References

[1]: https://docs.min.io/aistor/installation/linux/server-side-encryption/minio-key-encryption-service/ "MinIO AIStor — Server Side Encryption with KES"
[2]: https://docs.min.io/kms/legacy-key-management/installation/hashicorp-vault-keystore/ "MinIO KMS — HashiCorp Vault Keystore"
[3]: https://docs.permify.co/getting-started/modeling "Permify — Modeling Authorization"
