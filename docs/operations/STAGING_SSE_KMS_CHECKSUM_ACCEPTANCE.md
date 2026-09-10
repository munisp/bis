# Staging SSE-KMS Checksum Acceptance Run

**Purpose:** Prove that the deployed BFF signs and verifies a real S3-compatible direct KYC upload using an exact object-byte SHA-256 checksum, server-side encryption with the intended KMS key, and custody completion. The run uses only a 70-byte synthetic PNG built into `scripts/run-staging-sse-kms-evidence-acceptance.mjs`.

> This is a staging-only test. It must not run against production, must not use a real consumer document, and must not place static S3, KMS, NIMC, or NIBSS credentials on a mobile device or CI runner.

## 1. BFF and object-store prerequisites

The deployed staging BFF must contain commit `ac167e6` or a later compatible revision. Its service identity—not the runner—must have permission to issue presigned PUT requests and to call `HeadObject` with checksum retrieval for the isolated staging evidence bucket.

| BFF-side configuration | Required condition |
|---|---|
| `BIS_EVIDENCE_S3_ENDPOINT` | Approved HTTPS S3-compatible staging endpoint. |
| `BIS_EVIDENCE_S3_REGION` / `BIS_EVIDENCE_S3_BUCKET` | Dedicated versioned staging evidence bucket, not a production bucket. |
| `BIS_EVIDENCE_S3_ACCESS_KEY` / `BIS_EVIDENCE_S3_SECRET_KEY` or service-identity equivalent | Server-only least-privilege identity able to presign PUT and read object headers. Never supplied to the runner. |
| `BIS_EVIDENCE_S3_KMS_KEY_ID` | Exact active staging KMS key ID; must equal `STAGING_EXPECTED_KMS_KEY_ID`. |
| `BIS_EVIDENCE_ACTIVE_KEY_VERSION` / `BIS_EVIDENCE_KEYRING` | Valid BFF-only envelope-encryption keyring for the KYC description/custody flow. |
| PostgreSQL | `0007`, `0008`, and `0009` migrations applied; a staging-only KYC record exists in the selected tenant. |
| Object-store policy | TLS-only; requires `aws:kms` SSE and the named staging KMS key; supports S3 checksum headers and returns checksum values for `HeadObject` with checksum mode enabled. |
| Lifecycle policy | Purges the `kyc/` test object versions and matching custody records under the approved synthetic-data retention schedule. |

## 2. Runner-only protected variables

Inject only the following into the short-lived staging job. The access token is a tenant-scoped, least-privilege staging token with authority only for the one synthetic KYC record. Do not print any values in logs.

| Variable | Classification | Required value/validation |
|---|---|---|
| `BIS_ENV` | Configuration | Exactly `staging`. |
| `BIS_STAGING_CONFIRMATION` | Explicit change-control assertion | Exactly `I_APPROVE_NON_PRODUCTION_SSE_KMS_ACCEPTANCE`. |
| `STAGING_BFF_URL` | Configuration | Approved non-production HTTPS BFF origin. It must not include a `production`, `prod.`, or `.prod` hostname marker. |
| `STAGING_MOBILE_ACCESS_TOKEN` | Secret | Short-lived bearer token, minimum 16 characters, scoped to the synthetic staging user/tenant/KYC record. |
| `STAGING_KYC_RECORD_ID` | Configuration | Positive integer identifying the created **synthetic-only** KYC record. |
| `STAGING_EXPECTED_KMS_KEY_ID` | Sensitive configuration | Exact expected staging KMS key identifier; it must match the BFF configuration. |
| `STAGING_DATA_RETENTION_CONFIRMED` | Explicit retention approval | Exactly `synthetic-only-approved`. |
| `BIS_STAGING_REPORT_PATH` | Optional path | A protected CI artifact path. The JSON report contains only booleans, IDs, timestamp, and failure class—not the token, URL query string, object URL, or document bytes. |

## 3. Required execution steps

1. Create a disposable **synthetic-only** KYC record in the approved staging tenant, record its numeric ID, and obtain a short-lived access token for its designated test user.
2. Verify the deployed BFF configuration and bucket policy against the prerequisite table. Confirm that the BFF uses the exact expected KMS key ID and that no production bucket, KMS key, or credentials are in scope.
3. Mount the seven runner variables from the protected staging secret/config store. Do not export them in a developer terminal history and do not echo them in CI.
4. Invoke the runner from the repository revision deployed to staging:

```sh
pnpm staging:sse-kms-evidence
```

5. Store the generated JSON report as a restricted CI artifact. Inspect only its booleans and failure class. Preserve the BFF request/custody event IDs in a restricted incident record if escalation is necessary; do not attach signed URLs, credentials, or KYC data to a ticket.
6. Verify that lifecycle cleanup removes both synthetic objects and all object versions according to the approved schedule. Retain the redacted report and custody-event hashes as release evidence.

## 4. Assertions performed by the runner

| Order | Test action | Required result |
|---:|---|---|
| 1 | Calls KYC initiation with no bearer token. | BFF returns `401` or `403`; no object authorization is issued. |
| 2 | Initiates a synthetic KYC upload using the bearer token. | BFF returns `201`, an HTTPS presigned URL, and headers binding content type, upload ID, metadata SHA-256, `x-amz-checksum-sha256`, `aws:kms`, and the expected KMS key ID. |
| 3 | Attempts a same-length but byte-different PUT under the signed checksum. | The object store must reject the PUT. If it accepts, the runner asks BFF completion to obtain a custody rejection, then fails the run. |
| 4 | Initiates a fresh upload and PUTs the exact synthetic PNG. | Object store returns success. |
| 5 | Calls authenticated BFF completion. | BFF’s `HeadObject(ChecksumMode=ENABLED)` verification returns `status: "verified"` only if the object checksum, metadata, content type/length, SSE-KMS algorithm, and KMS key all match. |

A **passing run** requires every assertion. A PUT success for substituted bytes is a failed deployment configuration even when the subsequent BFF completion quarantines the object.

## 5. Local preflight only

Without every variable above, the script fails before URL parsing/network access. This safe local check is permitted without staging access:

```sh
env -i PATH="$PATH" HOME="$HOME" node scripts/run-staging-sse-kms-evidence-acceptance.mjs
# expected: FAIL ... BIS_ENV is required
```

The local preflight does not verify S3, KMS, device Keychain/Keystore, BFF authentication, or remote infrastructure. It is not staging acceptance evidence.
