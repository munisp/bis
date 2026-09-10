# On-Premises KMS Fault Drill, Permify Tenant Isolation, and Vault/KES Rotation Runbook

**Scope:** This runbook covers three controlled operations in an **isolated staging** deployment: validating that a Vault-sealed or KES-unreachable state fails closed; assigning consumer-dispute relationships in a multi-tenant Permify model; and rotating Vault root-token access, KES credentials, and the MinIO external evidence key.

> Run these procedures only under an approved change record with a synthetic-only tenant and dedicated staging bucket. None of the commands belong in production automation. Do not log token values, KES API keys, Vault AppRole Secret IDs, MinIO root credentials, unseal shares, object bytes, signed URLs, or provider identifiers.

## 1. Roles and dual-control boundaries

| Role | May do | Must not do |
|---|---|---|
| Vault unseal custodians | Supply quorum shares for the approved ceremony. | Possess or use the full runtime configuration/MinIO root credential. |
| Vault security administrator | Initialize Vault, approve/generate a temporary root token, issue/revoke AppRole credentials, enable audit devices. | Run the BFF or acceptance runner with a root token. |
| KES administrator | Issue KES identities, restrict policies, add external keys, approve key cutover. | Give KES/Vault credentials to the BFF, a native client, or a test runner. |
| MinIO operator | Configure bucket versioning, SSE-KMS default, lifecycle, and service account. | Change Vault/KES policy or use an unscoped root key for tests. |
| Permify policy administrator | Apply schemas and tuples using a distinct policy-admin credential. | Use the BFF check-only credential for writes. |
| BIS release operator | Runs the synthetic BFF acceptance and validates redacted reports. | Seal Vault, stop KES, or administer storage identities. |

## 2. Fail-closed MinIO/KES fault verification

### Preconditions

1. Start from a passing `pnpm staging:sse-kms-evidence` run in the same isolated environment. Save only the redacted report.
2. Confirm the currently active bucket key is in KES, `offline: 0s` is set in `kes.yaml`, the BFF uses the active KMS key identity, and the staging bucket contains no real document.
3. Confirm BFF database migrations and the KYC custody endpoint are healthy. The selected scoped BFF token must be short-lived and limited to one synthetic KYC record.
4. The fault injector and release operator agree which one isolated fault will be tested and set an end time. Do not combine a Vault seal with a KES stop in one run; that makes the result ambiguous.

### Execute the verifier

The verifier does not seal Vault or stop KES. It requires the independent fault-injector attestation string and uses no Vault, KES, MinIO, or object-store credential.

```sh
export BIS_ENV=staging
export BIS_ONPREM_KMS_FAULT_VERIFICATION_CONFIRMATION=I_APPROVE_SYNTHETIC_ONPREM_KMS_FAULT_VERIFICATION
export BIS_ONPREM_KMS_FAULT_SCENARIO=vault-sealed     # or kes-unreachable
export BIS_ONPREM_KMS_FAULT_INJECTED=vault-sealed     # must equal scenario
export STAGING_BFF_URL=https://<isolated-staging-bff>
export STAGING_MOBILE_ACCESS_TOKEN=<short-lived-synthetic-record-token>
export STAGING_KYC_RECORD_ID=<synthetic-only-positive-id>
export STAGING_EXPECTED_KMS_KEY_ID=<active-onprem-evidence-key-id>
export STAGING_DATA_RETENTION_CONFIRMED=synthetic-only-approved
export BIS_ONPREM_KMS_FAULT_REPORT_PATH=/var/lib/bis-artifacts/fault-drill.json
pnpm verify:onprem-minio-kes-fail-closed
```

The tool validates every variable before network use. It then requests a BFF presigned authorization and checks that checksum, `aws:kms`, key identity, and HTTPS are bound. Under the injected fault it expects the direct 70-byte synthetic `PUT` to fail and expects BFF custody completion to return non-success/non-`verified`. A direct PUT or custody completion that succeeds is **fail-open** and is a release blocker.

### Fault 1 — Vault sealed

1. The Vault security administrator confirms that no production or shared Vault cluster is targeted.
2. From the Vault administrative session, seal the **staging Vault only** using the operator-approved procedure. The exact runtime command depends on the operator’s TLS/authentication wrapper; the Vault CLI operation is `vault operator seal`.
3. Wait for the defined readiness/monitoring signal that KES cannot obtain a new external-key operation. KES must not serve a cached offline key because its configuration sets `offline: 0s`.
4. The release operator runs the verifier with `BIS_ONPREM_KMS_FAULT_SCENARIO=vault-sealed`.
5. The only passing evidence is `directPutRejected: true`, `custodyCompletionRejected: true`, and `verifiedStatusObserved: false` in the redacted report.
6. Unseal using the approved quorum or restore the approved auto-unseal mechanism. Wait for KES/MinIO health, run the ordinary `pnpm staging:sse-kms-evidence` positive control, then revoke the scoped token.

### Fault 2 — KES unreachable

1. The KES administrator confirms that the target is the isolated staging KES instance and that the fault duration is bounded.
2. Insert a temporary network-policy/firewall deny between MinIO and KES TCP 7373 **or stop only the staging KES service**. Do not alter KES keys, Vault state, BFF configuration, or storage data during this drill.
3. Verify that the MinIO/KES availability alarm is firing and wait no more than the approved window.
4. The release operator runs the verifier with `BIS_ONPREM_KMS_FAULT_SCENARIO=kes-unreachable`.
5. Require the same redacted failing-path evidence as the Vault-sealed test.
6. Restore the network path/service, wait for health and alert resolution, run an ordinary synthetic positive control, and remove the temporary fault rule.

The verifier proves the BFF custody path fails closed under a **pre-injected and evidenced** KMS dependency failure. It does not by itself prove the operator injected the stated fault; retain the separate change ticket, service-monitoring timestamps, and incident/alert records.

## 3. Permify multi-tenant relationship model

The BIS BFF now calls:

```ts
permifyCheck("platform", String(ctx.tenantId), "supervise_consumer_disputes", String(ctx.user.id))
```

Therefore, each PostgreSQL `tenantId` maps to a distinct Permify `platform` entity ID in the **same environment-specific Permify authorization tenant**. For example, PostgreSQL tenant `108` is exactly `platform:108`; PostgreSQL tenant `109` is exactly `platform:109`. Do not use a global `platform:bis` tuple.

| Tenant | Allowed supervisor tuple | Allowed caseworker tuple | Deliberately absent tuple |
|---:|---|---|---|
| `108` | `platform:108#consumer_dispute_supervisor@user:4201` | `platform:108#consumer_dispute_caseworker@user:4202` | `platform:109#consumer_dispute_supervisor@user:4201` |
| `109` | `platform:109#consumer_dispute_supervisor@user:5301` | `platform:109#consumer_dispute_caseworker@user:5302` | `platform:108#consumer_dispute_supervisor@user:5301` |

Use an authenticated policy-admin identity to write relationship tuples. It must be distinct from `PERMIFY_API_KEY` mounted to the BFF. A tenant-scoped supervisor assignment payload is:

```json
{
  "metadata": {},
  "tuples": [
    {
      "entity": {"type": "platform", "id": "108"},
      "relation": "consumer_dispute_supervisor",
      "subject": {"type": "user", "id": "4201"}
    },
    {
      "entity": {"type": "consumer_dispute_case", "id": "BIS-DR-EXAMPLE"},
      "relation": "platform",
      "subject": {"type": "platform", "id": "108"}
    }
  ]
}
```

### Required tuple lifecycle controls

1. Create a tuple only after PostgreSQL proves the user is active in that tenant and the operations/compliance approval is recorded.
2. Write relationship changes through an audited policy-admin job. Log only tenant/user IDs and a change ticket; never log API keys.
3. On offboarding, transfer, tenant suspension, or a security incident, delete/revoke the tuple before disabling the corresponding local account/session. Propagate and verify denial before closing the change.
4. Every deployment must execute four decision tests: tenant-108 supervisor allowed on platform 108; tenant-108 supervisor denied on 109; caseworker denied `supervise_consumer_disputes`; unavailable Permify denied by the BFF with no database transition.
5. A cross-tenant request must additionally fail at the BFF/PostgreSQL tenant predicate, even if a malicious tuple is mistakenly written. Both enforcement layers are required.

Permify’s model is relation and permission based; its schema supports a parent/resource relationship and user/role relations. [1]

## 4. Vault root-token access rotation

A Vault root token is an emergency, unrestricted recovery artifact—not a normal service credential. HashiCorp states root tokens carry the root policy and should be revoked when no longer necessary. [2]

| Phase | Required operation | Pass criterion |
|---|---|---|
| Prepare | Verify Vault backup/restore, audit devices, non-root admin/AppRole access, quorum availability, and a break-glass ticket. Stop rotation if any are missing. | Operational access does not depend on an existing root token. |
| Generate | From a controlled administrative workstation, run `vault operator generate-root -init -otp`, preserve the nonce/OTP in the approved secret-sharing channel, and submit required unseal-key shares with `vault operator generate-root -nonce=<nonce> <share>`. | Threshold confirmation returns an encoded one-time root-token result. |
| Decode/use | In the controlled ceremony, run `vault operator generate-root -decode <encoded-token> -otp <otp>`. Use the root token only to create/repair narrowly scoped operations access or rotate the emergency artifact. | Root token is not stored in shell history, CI variables, Compose, or tickets. |
| Revoke | Revoke the prior root token by its accessor or from the authorized root session, validate required non-root operations, then revoke the newly generated root token if it was only needed for the ceremony. | Vault audit log confirms revocation; no persistent root credential remains in runtime use. |
| Verify | Re-authenticate KES using its AppRole and MinIO using its KES identity; run the standard synthetic positive custody test. | KES and MinIO function without a root token. |

Use an HSM or a documented auto-unseal control if required by the operator; the repository intentionally does not hard-code any seal configuration. Never rotate root access during a KES fault drill.

## 5. KES credential and external evidence-key rotation

**Do not conflate these objects.**

| Item | What it protects | Rotation method |
|---|---|---|
| Vault root token | Emergency unlimited Vault administration | Temporary generate-root ceremony and immediate revocation, as above. |
| Vault K/V/AppRole credentials | KES access to its restricted K/V prefix | Create a new Secret ID/role credentials, deploy KES with overlap, verify, revoke old Secret ID. |
| KES API key/MinIO identity | MinIO mTLS/API authorization to KES | Create a new identity/API key, add it to the same restricted KES policy, update MinIO secret/config with rolling restart, verify, revoke old identity. |
| MinIO external evidence key (`bis-evidence-staging-vN`) | Per-object SSE-KMS envelope key selected by MinIO | Create a new named key, make it default for new writes, retain old key until all old object versions are re-encrypted or expired. |
| BIS application evidence keyring | Locally encrypted evidence descriptions and application data | Follow the versioned evidence-keyring procedure separately; it is not the MinIO/KES key. |

### Controlled external evidence-key cutover

1. Schedule a staging change window. Back up Vault, export MinIO version/object inventory, verify KES and Vault audit logging, and confirm `bis-evidence-staging-v1` works with a positive synthetic acceptance run.
2. Create a **new named** KES/Vault external key such as `bis-evidence-staging-v2` using an authorized KES administrative identity. Never overwrite/delete the v1 key.
3. Add both v1 and v2 entries to KES’s required `keys` configuration during the overlap. KES must validate v2 before serving it. Keep `offline: 0s`.
4. Update MinIO’s configured default KMS key and bucket default SSE-KMS rule to v2 using the version-specific MinIO administration procedure. Update BFF `BIS_EVIDENCE_S3_KMS_KEY_ID` and acceptance `STAGING_EXPECTED_KMS_KEY_ID` to v2 atomically via the secret/configuration release.
5. Restart/canary MinIO and BFF under their normal rollout procedure. Run `pnpm staging:sse-kms-evidence`; new objects must report v2 through BFF custody completion.
6. Prove old v1 object versions remain readable/valid only by restricted MinIO/KES services. Do not grant the acceptance runner access to them.
7. Re-encrypt or retire every v1 object/version according to the selected MinIO release’s documented SSE-KMS migration capability. Do not disable/delete v1 merely because v2 accepts new writes.
8. Use MinIO inventory/version reports, lifecycle evidence, and KES/Vault audit records to prove that no retained evidence refers to v1. Then remove v1 from bucket defaults, KES required keys/policy, and Vault K/V only after retention/legal-hold review approves destruction.
9. Run the Vault-sealed and KES-unreachable fail-closed drills plus one positive synthetic custody test on v2. Preserve redacted results and restore all temporary grants.

MinIO requires an external KMS key to exist before encrypted operations and uses KES policies to restrict key operations by identity/name. [3] For KES backed by Vault K/V, MinIO documents AppRole/Kubernetes authentication and different required policy paths for K/V versions; this profile uses the restricted K/V v2 paths. [4]

## References

[1]: https://docs.permify.co/getting-started/modeling "Permify — Modeling Authorization"
[2]: https://developer.hashicorp.com/vault/docs/concepts/tokens "HashiCorp Vault — Tokens"
[3]: https://docs.min.io/aistor/installation/linux/server-side-encryption/minio-key-encryption-service/ "MinIO AIStor — Server Side Encryption with KES"
[4]: https://docs.min.io/kms/legacy-key-management/installation/hashicorp-vault-keystore/ "MinIO KMS — HashiCorp Vault Keystore"
