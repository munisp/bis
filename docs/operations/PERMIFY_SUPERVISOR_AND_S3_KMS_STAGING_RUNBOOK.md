# Permify Supervisor Policy and Portable S3-Compatible KMS Staging Runbook

**Scope:** This runbook deploys the supervisor-only consumer-dispute policy required by `consumerDisputesRouter` and runs the synthetic checksum/SSE-KMS acceptance suite. It is **cloud-agnostic**: BIS operates against an HTTPS S3-compatible object API that supports the `aws:kms` SSE protocol and `HeadObject` checksum retrieval. It can be hosted in a public cloud or on premises.

> This procedure is staging-only. Use a synthetic KYC record and the built-in synthetic PNG only. No production bucket, real consumer document, provider credential, NIN, BVN, static object-store credential, or KMS secret may enter the acceptance-runner environment.

## 1. Exact Permify supervisor authorization policy

The BFF calls Permify in production with the platform entity and the exact permission below:

```ts
await permifyCheck("platform", "bis", "supervise_consumer_disputes", String(ctx.user.id));
```

The checked-in schema in `infra/permify/bis.perm` is:

```perm
entity user {}

entity platform {
  relation admin @user
  relation consumer_dispute_supervisor @user
  relation consumer_dispute_caseworker @user
  relation consumer_dispute_auditor @user

  permission manage_consumer_disputes = admin or consumer_dispute_supervisor or consumer_dispute_caseworker
  permission supervise_consumer_disputes = admin or consumer_dispute_supervisor
}

entity consumer_dispute_case {
  relation platform @platform
  relation consumer @user
  relation assigned_caseworker @user
  relation assigned_supervisor @user

  permission view = consumer or assigned_caseworker or assigned_supervisor or platform.manage_consumer_disputes
  permission manage = assigned_caseworker or assigned_supervisor or platform.manage_consumer_disputes
  permission supervise = assigned_supervisor or platform.supervise_consumer_disputes
}
```

Permify evaluates permissions from a schema and relationship tuples at runtime. [1] BIS applies a second local defense: only users with the application role `admin` or `supervisor` can reach the check. In production, a missing URL, tenant ID, API key, transport failure, or non-allowed decision results in `FORBIDDEN` and **no PostgreSQL mutation**.

| Relation | Subject type | Grant authority | Meaning |
|---|---|---|---|
| `platform:bis#admin` | `user:<id>` | Break-glass authorization owner, dual-approved | May manage and supervise platform-wide consumer disputes. |
| `platform:bis#consumer_dispute_supervisor` | `user:<id>` | Consumer-rights operations owner with compliance approval | May acknowledge/resolve deadline escalations and perform supervision. |
| `platform:bis#consumer_dispute_caseworker` | `user:<id>` | Consumer-rights operations owner | May manage cases but **cannot** supervise/escalation-resolve. |
| `consumer_dispute_case:<caseRef>#assigned_supervisor` | `user:<id>` | Case assignment workflow | Supports future resource-specific supervision; current BFF control remains the platform relation. |
| `consumer_dispute_case:<caseRef>#platform` | `platform:bis` | Policy provisioning service | Links a case to the platform policy root. |

The relationship-write API must be used by a dedicated policy-administration identity, not the BFF runtime identity. Apply the model only through the guarded command:

```sh
export BIS_ENV=staging
export PERMIFY_SCHEMA_APPLY_CONFIRMATION=I_APPROVE_PERMIFY_SCHEMA_APPLY
export PERMIFY_URL=https://<internal-permify-staging-origin>
export PERMIFY_TENANT_ID=<per-environment-permify-tenant-id>
export PERMIFY_API_KEY=<policy-admin-secret>
pnpm permify:apply-schema
```

The BFF identity receives **check-only** access to the same tenant; it must not write schema or tuples. Admin tuple changes require two-person approval, a ticket reference, immediate removal on role transfer/offboarding, and a staging decision test proving: supervisor allowed; analyst/caseworker denied; unavailable Permify denied.

## 2. Portable storage and KMS capability contract

BIS does not depend on AWS. The evidence client uses an endpoint/region/bucket plus standard S3 protocol features and an opaque provider KMS key identifier. It uses path-style addressing when `BIS_EVIDENCE_S3_FORCE_PATH_STYLE=true`, which is commonly needed for on-premises S3-compatible deployments.

| Required capability | Required behavior | Acceptance proof |
|---|---|---|
| HTTPS S3-compatible `PutObject` | Accepts SigV4 presigned PUT and binds all signed headers. | Correct synthetic PUT returns 2xx. |
| SSE-KMS protocol profile | Requires `x-amz-server-side-encryption: aws:kms` and the configured opaque KMS key identity. | BFF signed headers and `HeadObject` report the expected algorithm/key. |
| SHA-256 object checksum | Accepts `x-amz-checksum-sha256`, validates it on single-part upload, and returns it through `HeadObject` when checksum mode is enabled. | Same-length altered bytes are rejected; exact bytes return `verified`. |
| Object metadata/version read | Returns upload ID/hash metadata, content type/length, SSE fields, object version, and checksum to the BFF workload identity. | BFF custody completion returns `verified`. |
| Isolated service identity | BFF workload identity can presign/write/read custody headers in only approved prefixes. | No broad bucket/object access, and runner has no storage/KMS credential. |
| KMS access boundary | KMS enables server-side envelope encryption and authorizes only object store/BFF workload paths required to generate data keys and retrieve checksum-protected headers. | A wrong KMS identity causes PUT or custody completion failure. |
| Versioning/lifecycle/audit | Supports object versioning, lifecycle expiration, and auditable object/KMS operations. | Synthetic artifacts are purged and redacted custody proof retained. |

### Supported deployment profiles

| Profile | Object API | KMS/key service | Required BIS configuration |
|---|---|---|---|
| Public-cloud S3-compatible | Vendor S3 endpoint | Vendor customer-managed symmetric KMS key | Set HTTPS endpoint, region, bucket, opaque key identifier, and workload credentials. |
| On-premises MinIO/AIStor + KES | MinIO S3-compatible endpoint | MinIO KES backed by an approved HSM or HashiCorp Vault | Set internal HTTPS endpoint, deployment region label, bucket, `aws:kms` key name/ID, `BIS_EVIDENCE_S3_FORCE_PATH_STYLE=true` where required, and workload credentials from the on-prem secret platform. MinIO documents SSE with KES and external key managers. [2] |
| Other S3-compatible appliance | Provider’s S3-compatible endpoint | Provider-supported external KMS/HSM | Onboard only after the acceptance suite confirms exact signed checksum, `HeadObject` checksum, SSE-KMS key identity, versioning, and lifecycle support. |

An S3-compatible service that does not preserve the signed SHA-256 checksum or does not return it through checksum-enabled `HeadObject` is **not eligible** for BIS evidence custody, even if it claims S3 compatibility.

## 3. Exact BFF configuration

All values below are injected into the **BFF workload only** through a protected on-premises or cloud secret/configuration system. Omit the static access key pair to use the AWS SDK standard workload credential chain; provide both values together only when the selected S3-compatible platform requires static service credentials.

| Variable | Required value/boundary |
|---|---|
| `BIS_DEPLOYMENT_ENV` | `staging` for the acceptance run. |
| `BIS_EVIDENCE_S3_ENDPOINT` | Approved **HTTPS** S3-compatible internal/external endpoint. |
| `BIS_EVIDENCE_S3_REGION` | Provider region or stable on-prem deployment region label used by SigV4. |
| `BIS_EVIDENCE_S3_BUCKET` | Dedicated, versioned staging evidence bucket. |
| `BIS_EVIDENCE_S3_FORCE_PATH_STYLE` | `true` only when the S3-compatible service requires path-style request addressing; otherwise `false`/unset. |
| `BIS_EVIDENCE_S3_SSE_ALGORITHM` | Exactly `aws:kms`; any other value fails closed. |
| `BIS_EVIDENCE_S3_KMS_KEY_ID` | Exact opaque active KMS key identity. It may be a cloud key ARN/URI or an on-prem KMS key name/ID; it must exactly match `STAGING_EXPECTED_KMS_KEY_ID`. |
| `BIS_EVIDENCE_S3_ACCESS_KEY` and `BIS_EVIDENCE_S3_SECRET_KEY` | Both set or both absent. When present, are BFF-only secrets. When absent, the SDK standard workload identity chain is used. |
| `BIS_EVIDENCE_ACTIVE_KEY_VERSION`, `BIS_EVIDENCE_KEYRING` | Versioned 32-byte AES evidence description keyring, BFF-only; distinct from storage KMS. |
| `BIS_DATABASE_URL` | Tenant-scoped staging PostgreSQL with canonical migrations `0007` through `0009` applied. |
| `PERMIFY_URL`, `PERMIFY_TENANT_ID`, `PERMIFY_API_KEY` | Internal HTTPS authorization service, explicit environment tenant, and BFF check-only credential. |

## 4. Acceptance-runner environment and steps

The runner has one short-lived BFF bearer secret and no storage/KMS credential:

```sh
export BIS_ENV=staging
export BIS_STAGING_CONFIRMATION=I_APPROVE_NON_PRODUCTION_SSE_KMS_ACCEPTANCE
export STAGING_BFF_URL=https://<approved-staging-bff-origin>
export STAGING_MOBILE_ACCESS_TOKEN=<short-lived-tenant-and-synthetic-KYC-scoped-token>
export STAGING_KYC_RECORD_ID=<positive-synthetic-only-kyc-record-id>
export STAGING_EXPECTED_KMS_KEY_ID=<exact-opaque-storage-kms-key-identity>
export STAGING_DATA_RETENTION_CONFIRMED=synthetic-only-approved
export BIS_STAGING_REPORT_PATH=artifacts/staging-sse-kms/acceptance.json
pnpm staging:sse-kms-evidence
```

1. Security, privacy, and the on-prem/cloud infrastructure owner approve the synthetic record, lifecycle policy, object-store endpoint, KMS identity, BFF workload identity, and change window.
2. Deploy the revision containing the portable evidence-storage client and run canonical PostgreSQL migrations. Confirm the BFF is using the exact storage profile described above.
3. Provision a short-lived token restricted to the synthetic KYC record and staging tenant. Do not use a general administrator/session token.
4. Inject only the seven runner variables above into a short-lived restricted job. The script rejects missing/invalid inputs before network use.
5. Run `pnpm staging:sse-kms-evidence`. The runner tests unauthenticated denial; signed SHA-256/SSE-KMS headers; rejection of same-length substituted bytes; valid exact-byte upload; and BFF custody completion.
6. Preserve the redacted boolean report, BFF custody event hashes, release SHA, endpoint profile, KMS key identity, and lifecycle evidence. Do not retain signed URLs, bearer tokens, document bytes, or object-store secrets.
7. Confirm automated synthetic-object/version cleanup and revoke the token. A checksum-less response, substituted-byte success, wrong KMS key, absent key identity, failed checksum-head read, or failed cleanup is a release gate failure.

## 5. On-premises operational boundaries

On premises, the object store, KMS/KES, PostgreSQL, Permify, BFF, observability stack, and secret manager must be deployed as independent services under the customer’s network/security boundary. Use mTLS or internal TLS with a managed private CA for service paths; do not weaken the code’s HTTPS endpoint requirement. Store service credentials and application keyrings in an on-prem secret manager/HSM-backed system, rotate them, and mount them only into the workloads that require them.

The acceptance runner remains isolated from those secrets. Its success proves the BFF-to-object-store custody path, not broad administrator access. This division permits air-gapped or private-data-center deployments while preserving the same direct-upload and fail-closed verification semantics.

## References

[1]: https://permify-permify-61.mintlify.app/introduction "Permify — Modeling Authorization"
[2]: https://docs.min.io/aistor/installation/linux/server-side-encryption/minio-key-encryption-service/ "MinIO AIStor — Server Side Encryption with KES"
[3]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html "Amazon S3 — Checking object integrity for data uploads"
