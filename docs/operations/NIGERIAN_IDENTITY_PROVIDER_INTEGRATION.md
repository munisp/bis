# NIBSS BVN and NIMC NINAuth/NVS Provider Integration Contract

**Status:** Production integration contract. A signed provider agreement, provider-issued developer documentation, approved environment credentials, and active `data_provider_authorizations` record are mandatory before any outbound verification is enabled.

> **This document deliberately does not invent provider endpoint paths, request JSON/XML structures, OAuth scopes, SOAP actions, mTLS certificate names, or response fields.** NIBSS and NIMC publish the consent/onboarding requirements, but their exact production interface material is issued through the authorized provider channel. The integration must use the versioned documentation supplied to BIS under its agreement, not an unauthorised public URL, scraped endpoint, or reverse-engineered client.

## 1. Shared non-negotiable control plane

Every identity verification request follows the sequence below. Any missing precondition terminates locally before network I/O.

| Step | Required control | Failure behavior |
|---|---|---|
| 1. Product/use decision | Match the tenant, country, report purpose, data source, field set, recipient, and legal basis to counsel-approved configuration. | `403 PROVIDER_USE_NOT_AUTHORIZED`; no provider call. |
| 2. Subject and consent | Verify candidate/consumer identity and active provider-specific consent; bind consent version, scope, time, provider, requested fields, and transaction reference. | `409 CONSENT_REQUIRED`, `409 CONSENT_REVOKED`, or `409 CONSENT_EXPIRED`; no provider call. |
| 3. Provider authorization | Query `data_provider_authorizations` for `status='active'`, correct `environment`, effective/expiry window, use case, jurisdiction, field allow-list, secret reference, and network policy. | `503 PROVIDER_AUTHORIZATION_UNAVAILABLE` or `403 PROVIDER_AUTHORIZATION_OUT_OF_SCOPE`; no provider call. |
| 4. Secure transport | Resolve credentials only in the server workload through secret manager; use provider-required VPN/private route, mTLS, TLS certificate validation, request timeout, and correlation identifier. | `503 PROVIDER_TRANSPORT_UNAVAILABLE`; leave screening request pending/retryable, never mark it unverified. |
| 5. Contract validation | Validate provider response against the signed/versioned OpenAPI/WSDL/XSD/JSON schema; reject unexpected or incomplete success responses. | `502 PROVIDER_PROTOCOL_INVALID`; quarantine payload metadata, alert, and do not generate a report conclusion. |
| 6. Minimal persistence | Persist allowed fields only; encrypt regulated identifiers; store request/response fingerprints, provider transaction ID, source timestamp, consent reference, and authorization reference. | Fail transaction; do not persist partial result. |
| 7. Decisioning | Map only confirmed source outcomes to `screening_results`; a provider failure, timeout, or consent error is **not** a “no match”, “unverified”, “clear”, or adverse result. | Hold order/result in `processing` or `review`; no automated adverse conclusion. |
| 8. Audit and observability | Append immutable audit event; emit redacted metrics with provider/status class only; never log NIN, BVN, retrieval token, response body, authorization header, or client secret. | Security review and incident path if audit persistence fails. |

### Required server-side configuration

All values are supplied by staging/production secret/config management. They are never sent to browser/mobile code, never checked into Git, and never placed in an error response.

| Variable or configuration key | NIBSS BVN | NIMC NINAuth / NVS | Required policy |
|---|---|---|---|
| `BIS_DEPLOYMENT_ENV` | Yes | Yes | Exact `staging` or `production`; must match the authorization row. |
| `BIS_PROVIDER_AUTHORIZATION_REF_NIBSS_BVN` | Yes | — | Active scoped `data_provider_authorizations.authorization_ref`. |
| `BIS_PROVIDER_AUTHORIZATION_REF_NIMC_NINAUTH` | — | Yes | Active scoped authorization reference. |
| `BIS_NIBSS_BVN_BASE_URL` | Yes | — | Provider-issued HTTPS base URL only; do not use guessed `/v1` paths. |
| `BIS_NIBSS_BVN_CREDENTIAL_SECRET_REF` | Yes | — | Secret-manager reference, not secret value; includes provider-required API credential/client certificate material. |
| `BIS_NIBSS_BVN_NETWORK_POLICY_REF` | Yes | — | Provider-approved VPN/private route/IP allowlist/mTLS policy reference. |
| `BIS_NIBSS_BVN_API_CONTRACT_VERSION` | Yes | — | Exact provider documentation/version used for request and schema validation. |
| `BIS_NIMC_NINAUTH_ISSUER` | — | Yes | NIMC-approved OIDC issuer; discovery is validated against exact issuer and approved signing keys. |
| `BIS_NIMC_NINAUTH_CLIENT_SECRET_REF` | — | Yes | Server-side confidential-client secret/certificate reference where NIMC requires one. |
| `BIS_NIMC_NINAUTH_REDIRECT_URI` | — | Yes | Registered exact HTTPS callback; no wildcard or mobile deep-link substitution without provider approval. |
| `BIS_NIMC_NINAUTH_SCOPE_SET` | — | Yes | Provider-approved minimal scope list; raw NIN release is not assumed. |
| `BIS_NIMC_NVS_WSDL_URL` | — | Conditional | NIMC-issued SOAP WSDL only when BIS is separately approved for NVS. |
| `BIS_NIMC_NVS_CREDENTIAL_SECRET_REF` | — | Conditional | Authorized representative credential reference; separate from NINAuth. |
| `BIS_NIMC_NVS_NETWORK_POLICY_REF` | — | Conditional | Required secure VPN connectivity and mTLS/private networking reference. |
| `BIS_NIMC_NVS_API_CONTRACT_VERSION` | — | Conditional | Versioned provider WSDL/XSD and approved access-level profile. |
| `BIS_PROVIDER_CONNECT_TIMEOUT_MS` | Yes | Yes | 1,000–3,000 ms, bounded by agreement; no infinite connection wait. |
| `BIS_PROVIDER_REQUEST_TIMEOUT_MS` | Yes | Yes | 5,000–10,000 ms, bounded by agreement; set per endpoint class. |
| `BIS_PROVIDER_EGRESS_ALLOWLIST_REF` | Yes | Yes | Egress limited to provider-approved DNS/IP/private endpoints. |
| `BIS_AUDIT_HMAC_SECRET` | Yes | Yes | Required for immutable event integrity hash; current platform variable is `AUDIT_HMAC_SECRET`. |

The current `BIS_VERIFY_NIMC_URL`, `BIS_VERIFY_NIMC_KEY`, `BIS_VERIFY_NIBSS_URL`, and `BIS_VERIFY_NIBSS_KEY` placeholders are **not sufficient production configuration**. They must be replaced by the provider-specific configuration above and a contract-versioned adapter before a production authorization may be activated.

## 2. NIBSS BVN validation integration

NIBSS publicly states that portal users must complete MFA and that **every BVN validation requires a Retrieval Token** confirming customer consent. The retrieval token is limited in validity and cannot be reused. [1]

### 2.1 Required commercial and technical onboarding

1. Obtain NIBSS eligibility confirmation, signed service terms, approved use case, named administrators, relationship manager, and the current BVN API/certification materials.
2. Enrol all portal administrators in MFA. Store no MFA seed in BIS; follow the provider’s organisation hardware-token path where applicable.
3. Complete NIBSS sandbox/certification over the provider-approved route. Capture the issued base URL, authentication mechanism, client certificate chain, IP/VPN requirements, API specification version, rate limits, and support escalation path.
4. Create `data_sources` record `NIBSS_BVN` and a `data_provider_authorizations` record that permits only the written use cases, Nigeria jurisdiction, contracted field list, and `bvn_validation`/`reinvestigation` actions. It remains `certification_pending` until go-live approval is written.
5. Configure secret-manager references and network policy. An active production authorization requires dual approval from the provider owner and compliance owner; the adapter blocks calls outside dates/scopes.

### 2.2 Per-verification sequence

1. The consumer starts the NIBSS Consent Hub process through the provider-approved flow. BIS records the consent-request reference, but not a raw BVN in logs.
2. The consumer completes consent. BIS receives/accepts the one-time Retrieval Token only through the approved secure user-to-server path; it stores only `SHA-256(token)`, provider consent reference, expiry, and `used_at`/status. Plaintext token remains in memory only for the single request.
3. Before a provider call, lock the consent-token row and require: correct candidate binding, active consent, unexpired token, unused token, active provider authorization, allowed purpose, and allowed field set.
4. Create a database request record in `pending_dispatch` with a random correlation ID and an idempotency key. Commit it **before** calling NIBSS.
5. Construct the request using only the NIBSS-approved schema and required authentication. Include the BVN and Retrieval Token in the server-to-provider request; never return either to the client or place them in an analytics event.
6. Call once using provider-defined idempotency semantics. Atomically mark the retrieval token used when NIBSS returns a terminal response or definitive provider acknowledgment. If NIBSS documents a status-query endpoint, use the correlation/provider transaction ID before any retry after an ambiguous network failure.
7. Validate response signature/schema and compare permitted identity attributes against the bound subject. Persist only licensed allowed attributes and a redacted result summary.
8. Resolve the screening result as `completed` only on verified, contract-valid final provider response; otherwise retain `processing`/`review` with a non-sensitive error code.

### 2.3 NIBSS error classification and retry rules

| Condition | Internal code | Result state | Retry policy | Consumer/operator message |
|---|---|---|---|---|
| No provider authorization, scope, date, network policy, or secret reference | `PROVIDER_AUTHORIZATION_OUT_OF_SCOPE` | `review` | None until authorization corrected | “This verification source is not currently authorised for this request.” |
| Missing/expired/revoked/already-used Retrieval Token | `NIBSS_CONSENT_TOKEN_INVALID` | `awaiting_consumer` | No API retry; start a new consent flow | “A new BVN consent approval is required.” |
| NIBSS `401/403` | `NIBSS_CREDENTIAL_OR_ENTITLEMENT_DENIED` | `review` | No automatic retry | “The verification provider rejected the authorised request.” |
| NIBSS documented validation error | `NIBSS_REQUEST_REJECTED` | `awaiting_consumer` or `review` | No retry until corrected | “The provider could not process the supplied verification details.” |
| `429` | `NIBSS_RATE_LIMITED` | `processing` | One delayed retry using provider `Retry-After`; no parallel duplicate | “Verification is queued with the provider.” |
| DNS/TLS/VPN/connect/timeout | `NIBSS_TRANSPORT_UNAVAILABLE` | `processing` | Do **not** replay token blindly; query status first if documented. Otherwise require provider support decision/new consent. | “The provider is temporarily unavailable; no verification conclusion was made.” |
| `5xx` | `NIBSS_UPSTREAM_UNAVAILABLE` | `processing` | Status query before retry; bounded exponential backoff only if provider documents idempotency | Same as above. |
| Malformed/unsigned/unknown schema | `NIBSS_PROTOCOL_INVALID` | `review` | No automatic retry; security/provider escalation | “Verification requires manual review.” |
| Verified mismatch | `NIBSS_IDENTITY_MISMATCH` | `review` | No retry using same token | “The provider response needs manual identity review.” |

## 3. NIMC NINAuth and NVS integration

NINAuth is NIMC’s official consent gateway. Its public developer material describes user-driven, consent-based QR-code/share-code flows designed to verify identity **without exposing the raw NIN**, and describes modern identity/security protocols. [2] NIMC also documents NVS separately as a SOAP web service with levels of access and secure VPN access. NVS onboarding requires a formal request, NDA/MOU, NVS forms, and authorized administrators/users; sandbox access is granted after written request approval. [3] [4]

**NINAuth and NVS are separate products.** BIS may not use an NINAuth approval as authority to make NVS SOAP calls unless the contract expressly authorizes both the data use and the particular fields/access level.

### 3.1 NINAuth consent-based flow

1. Register BIS as an organisation/client through NIMC’s approved process. Register exact production/staging redirect URIs, callback signing/verification parameters, allowed scope set, privacy notice version, and branding artifacts.
2. Obtain and pin the NINAuth issuer/discovery metadata through the provider-approved endpoint. Validate issuer equality, `state`, `nonce`, PKCE verifier/challenge, redirect URI, audience/client ID, expiry, and ID-token signature against current signing keys. Do not accept unpinned discovery or arbitrary issuer URLs.
3. Start the NINAuth QR/share-code/user-consent transaction using the provider’s current approved developer schema. Store opaque transaction ID, state hash, nonce hash, requested scope hash, subject/candidate binding, expiry, and status. Never log QR/share code, auth code, access token, ID token, NIN, or verifiable credential.
4. The individual approves or denies in the official NINAuth channel. On callback/poll result, verify transport integrity and all correlation values before exchanging a code/token or consuming the provider response.
5. Request only approved minimal claims. The default product expectation is assertion/verified claims rather than retention of raw NIN. Persist only allowed claim fingerprint, display-masked values, provider credential ID/reference, consent timestamp, claim scopes, and expiry.
6. Any denied, expired, callback-mismatched, audience-mismatched, or unverifiable response remains `awaiting_consumer` or `review`; it is not an identity failure conclusion.

### 3.2 NVS SOAP flow (only where separately authorized)

1. Complete formal request to NIMC DG/CEO, execute NDA/MOU, submit NVS forms, and provision authorized administrators/users. Obtain sandbox credentials and provider-issued WSDL/XSD. [3] [4]
2. Establish the required secure VPN/private connectivity. Pin the provider TLS chain as specified. Do not expose SOAP service through public mobile/PWA traffic.
3. Configure the provider-approved NVS access level. NIMC documents Level 1 through Level 5 access; BIS must use the lowest level needed for the approved purpose. [4]
4. Build SOAP envelopes from generated types produced from the provider WSDL; validate XML against XSD, disable external entity resolution, bound message sizes, and reject DTD/XXE. Use a provider correlation ID and contract-defined nonce/idempotency control.
5. Sign/authenticate requests only as specified by the NVS contract. Persist no raw SOAP request/response in application logs. Encrypt permitted result fields, store a redacted schema-valid response fingerprint and NIMC transaction reference.
6. Treat NIMC availability/network/backend dependency failure as `processing`/`review`, never as a “no record” result. NIMC identifies network and NIMS backend availability as dependencies. [3]

### 3.3 NIMC error classification and retry rules

| Condition | Internal code | Result state | Retry policy |
|---|---|---|---|
| NINAuth consent denied/expired | `NINAUTH_CONSENT_NOT_GRANTED` | `awaiting_consumer` | Start new consent transaction; do not retry authorization/code. |
| OIDC state/nonce/PKCE/audience/issuer/signature mismatch | `NINAUTH_CALLBACK_INVALID` | `review` | No retry; invalidate transaction and security-escalate. |
| NINAuth code already used/expired | `NINAUTH_AUTHORIZATION_CODE_INVALID` | `awaiting_consumer` | New consent transaction only. |
| OIDC discovery/key refresh failure | `NINAUTH_TRUST_METADATA_UNAVAILABLE` | `processing` | Retry metadata retrieval once over pinned issuer; otherwise hold and alert. |
| NVS credential/access-level/VPN refusal | `NVS_ENTITLEMENT_OR_NETWORK_DENIED` | `review` | No automatic retry; provider owner action required. |
| SOAP fault declared by XSD/contract | `NVS_PROVIDER_FAULT` | `awaiting_consumer` or `review` | Follow the published fault semantics; never infer “not found.” |
| SOAP parse/XSD/signature failure | `NVS_PROTOCOL_INVALID` | `review` | No automatic retry; quarantine metadata and security/provider escalate. |
| NIMS/network/timeout/5xx | `NVS_UPSTREAM_UNAVAILABLE` | `processing` | Bounded retry only with documented idempotency/status query. |

## 4. Minimum implementation changes in BIS

1. Remove public/default assumed provider URLs from the `ENV` production path. `BIS_VERIFY_NIMC_URL` / `BIS_VERIFY_NIBSS_URL` must not default to guessed public endpoint strings in production.
2. Replace generic `callVerifyApi()` in `server/ngScreening.ts` for NIN/BVN with two contract-versioned adapters: `NimcNinAuthClient`/`NimcNvsSoapClient` and `NibssBvnClient`. Each returns typed result variants, never `success: boolean` plus arbitrary JSON.
3. Persist provider consent transactions and one-time NIBSS retrieval-token fingerprints in PostgreSQL. Introduce a unique/locked lifecycle `created → approved → consumed|expired|revoked` and prevent token reuse.
4. Require `data_provider_authorizations` lookup before every connector call. This repository’s `0008_consumer_dispute_reinvestigation.sql` supplies the deny-by-default authorization registry; populate it only after legal/provider approval.
5. Use a durable outbox/worker for dispatch/retry/status polling. Do not execute provider verification synchronously from an interactive tRPC request as the authoritative workflow.
6. Redact sensitive data at API boundaries and metrics. Alert on `provider_transport_unavailable`, `protocol_invalid`, `consent_token_reuse_attempt`, pending verification age, and authorization expiry; no PII labels.

## References

[1]: https://nibss-plc.com.ng/bank-verification-numberbvn/updates/ "NIBSS BVN Validation Portal Updates"
[2]: https://ninauth.nimc.gov.ng/developers-guide "NINAuth Developers Guide"
[3]: https://nimc.gov.ng/nimc-verification-service "NIMC Verification Service"
[4]: https://nimc.gov.ng/nimc-verification-service-api "NIMC Verification Service API"
