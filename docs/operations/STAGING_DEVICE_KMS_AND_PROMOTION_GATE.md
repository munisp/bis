# Staging Device, SSE-KMS, and Production Promotion Gate

This procedure governs the final acceptance gate for the mobile Keychain/Keystore session implementation, encrypted KYC document upload, immutable container promotion, and OBS-001 monitoring. It is deliberately **fail closed**. The verification scripts make no network request unless every required staging control is present, and they use only a generated one-pixel PNG with no personal data.

## 1. Required staging controls

The staging environment must be isolated from production DNS, object storage, KMS keys, and registry providers. The device-lab application profile must point to the staging BFF and use a staging-only tenant, user, and KYC record. The profile must be discarded or reset after the probe completes.

| Control | Required value or behavior | Why it is required |
|---|---|---|
| Physical device | Managed Android or iOS device exposing hardware-backed Keychain/Keystore security | Emulator and JavaScript-native mocks cannot prove `SECURE_HARDWARE` persistence behavior. |
| Isolated app profile | Staging bundle identifier/profile with no real user session | The probe writes and clears a synthetic session credential. |
| Device probe | Execute `runSecureSessionDeviceProbe()` from `mobile/src/testing/secureSessionDeviceProbe.ts` and save its returned JSON immediately | The attestation proves hardware security, device-only policy, persistence after process-cache reset, legacy-service isolation, and logout cleanup. |
| Staging BFF | HTTPS root endpoint in `STAGING_BFF_URL`; it must expose `/api/kyc/documents/*` | The mobile client uses the BFF, not the internal gateway, for KYC upload authorization and custody completion. |
| Staging identity | A short-lived staging mobile token and a KYC record owned by the token’s tenant | The server enforces tenant and actor ownership before issuing a direct upload authorization. |
| Object store and KMS | Staging-only S3-compatible bucket, key, grant, TLS endpoint, and versioning | Completion verifies `aws:kms`, expected key identity, content type, byte count, and SHA-256 metadata. |
| Retention | Confirmed policy for short-lived synthetic test artifacts | The synthetic document becomes a real staging custody object and must follow approved test-data retention. |
| Metrics | HTTPS Prometheus, Alertmanager, protected gateway metrics endpoint, and archive Pushgateway | OBS-001 promotion checks verify ingestion, loaded rules, alert delivery availability, and no firing critical alerts. |

## 2. Device-lab attestation contract

The device runner must emit the exact JSON shape returned by `runSecureSessionDeviceProbe()`. It must not contain a token, password, credential value, device serial, user identifier, or document data. The acceptance runner rejects attestations older than 30 minutes.

```json
{
  "generatedAt": "2026-09-04T12:00:00.000Z",
  "platform": "android",
  "session": {
    "writeSucceeded": true,
    "survivedProcessRestart": true,
    "hardwareBacked": true,
    "deviceOnlyPolicyConfigured": true,
    "legacyServiceIsolated": true,
    "logoutCleared": true
  }
}
```

> The device runner must call the exported probe in an actual Android or iOS application process. A Vitest mock, an emulator assertion, or a hand-authored JSON document is not evidence of a physical-device result.

## 3. Staging mobile/KMS acceptance invocation

The protected staging job provides these values through the protected `staging` environment. Do not place the access token, device attestation, SSH key, object-store credentials, or KMS identifiers in the repository.

| Variable | Classification | Purpose |
|---|---|---|
| `BIS_ENV=staging` | Fixed control | Refuses production execution. |
| `BIS_STAGING_CONFIRMATION=I_APPROVE_NON_PRODUCTION_MOBILE_KMS_TESTS` | Fixed control | Requires explicit human approval of the non-production test. |
| `STAGING_BFF_URL` | Environment variable | HTTPS root BFF endpoint. |
| `STAGING_MOBILE_ACCESS_TOKEN` | Secret | Short-lived staging user token. |
| `STAGING_KYC_RECORD_ID` | Environment variable | Staging KYC record owned by the test tenant. |
| `STAGING_DEVICE_ATTESTATION_FILE` | Ephemeral protected file | Fresh output from the physical-device probe. |
| `STAGING_EXPECTED_KMS_KEY_ID` | Environment variable | Exact key ID returned in the signed upload header and by object verification. |
| `STAGING_DATA_RETENTION_CONFIRMED=synthetic-only-approved` | Fixed control | Confirms policy for generated test data. |

The runner performs these checks in order: it validates the attestation, verifies unauthenticated KYC initiation is denied, initiates a tenant-scoped upload, requires signed SSE-KMS headers, uploads the synthetic PNG over HTTPS, completes custody verification, and deletes its temporary plaintext file. It never prints access tokens, direct upload URLs, object keys, KYC record IDs, or request bodies.

## 4. Immutable promotion prerequisites

The `BIS Production Promotion` workflow accepts only a full commit SHA that is reachable from `hardening/production-readiness`. It runs canonical migrations and full local validation before publishing the BFF runtime, BFF migration, gateway, and cold-archive images. Each is reference-pinned by SHA-256 digest with provenance and SBOM attestation.

| Environment setting | Staging | Production |
|---|---|---|
| Approval | Protected `staging` environment | Separate protected `production` environment after staging passes |
| SSH credentials | `STAGING_SSH_PRIVATE_KEY`, `STAGING_SSH_KNOWN_HOSTS` | `PRODUCTION_SSH_PRIVATE_KEY`, `PRODUCTION_SSH_KNOWN_HOSTS` |
| Host configuration | `STAGING_HOST`, `STAGING_USER`, `STAGING_DEPLOY_ROOT`, `STAGING_DEPLOY_ENV_FILE` | Equivalent `PRODUCTION_*` values |
| Host secrets | A root-readable environment file outside the checkout | A distinct root-readable production environment file outside the checkout |
| Host requirements | Docker Compose, immutable release directory, private registry pull access | Same, plus completed backup/restore controls and production approval |

The remote executor creates a compressed PostgreSQL backup and detached SHA-256 checksum, runs `pnpm db:migrate` from the immutable migration image, starts only digest-pinned application images with `--no-build`, requires internal gateway and BFF database health, and restores the prior release symlink/images when a post-migration deployment check fails. The previous database backup is retained for reconciliation; database rollback is a separately approved recovery operation and is never automatic.

## 5. OBS-001 acceptance invocation

Set the protected environment values below before promotion. The verifier makes read-only HTTPS calls and stores sanitized evidence under `artifacts/obs001-promotion/`.

| Variable | Purpose |
|---|---|
| `OBS_PROMETHEUS_URL` | HTTPS Prometheus API endpoint. |
| `OBS_GATEWAY_METRICS_URL` | HTTPS gateway `/internal/metrics` endpoint. |
| `OBS_GATEWAY_KEY` | Dedicated least-privilege protected metrics credential. |
| `OBS_ALERTMANAGER_URL` | HTTPS Alertmanager API endpoint. |

The gate requires authenticated presence of all gateway OBS-001 series, successful Prometheus scrapes for the gateway and archive Pushgateway, loaded required alert rules, a healthy Alertmanager status API, and zero firing critical alerts. A failure is a release block until the monitoring path, not merely the application, is restored.
