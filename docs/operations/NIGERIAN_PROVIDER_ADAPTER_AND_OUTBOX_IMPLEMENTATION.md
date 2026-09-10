# Nigerian Provider Adapters and Consumer-Dispute Outbox

**Status:** The consumer-dispute delivery outbox and its encrypted, fail-closed processor are implemented. **NIBSS BVN and NIMC NINAuth/NVS network adapters are intentionally not installed** until BIS holds the corresponding signed agreement, versioned provider interface package, sandbox approval, and certification results. This document is the exact implementation and acceptance contract for adding them; it is not permission to infer an interface from public web material.

## 1. Implemented durable workflow

A caseworker creates a source task only after an active provider-authorization record is in the correct environment, time window, jurisdiction, use case, source, and tenant scope. The same PostgreSQL transaction writes an AES-256-GCM encrypted `consumer_dispute_provider_outbox` record. The outbox payload is intentionally minimal: case reference, source-task reference, authorization reference, and data-source identifier. It contains neither NIN, BVN, Retrieval Token, QR/share code, OAuth token, nor provider response.

The `bis-consumer-dispute-provider-outbox` job leases pending rows using `FOR UPDATE SKIP LOCKED`, returns stale leases after five minutes, authenticates and decrypts the payload, rechecks the live authorization, and then calls the contract adapter boundary. A missing adapter or authorization moves the row to `dead_letter`, marks the source task failed, and writes an immutable `provider_outbox_failed` event. Transient failures use bounded exponential retry (maximum 12 attempts); a processor crash cannot strand a leased row permanently.

| State | Owner | Permitted transition | Invariant |
|---|---|---|---|
| `pending` | Router/worker | `leased`, `cancelled`, `dead_letter` | Encrypted payload, digest, active authorization required before lease. |
| `leased` | One worker lease | `delivered`, `pending`, `dead_letter` | Lease automatically recovers after five minutes. |
| `delivered` | Contract adapter | terminal | Provider correlation ID and an immutable event are mandatory. |
| `dead_letter` | Supervisor/provider owner | terminal pending controlled replay | No automatic provider retry is permitted until the cause is resolved and a new approved event is created. |

## 2. Required provider-supplied integration package

BIS must obtain this package separately for **each** NIBSS BVN, NIMC NINAuth, and—where separately approved—NIMC NVS product/environment pair. Public product pages establish consent and onboarding concepts, but they do not authorize BIS to use undocumented endpoints or fields. NIBSS publicly requires MFA and one valid, unique, limited-life Retrieval Token for every BVN validation. [1] NINAuth is described by NIMC as consent/user-driven identity verification without exposing a raw NIN; NVS is a distinct SOAP service that uses controlled access and a VPN. [2] [3]

| Artifact | NIBSS BVN | NIMC NINAuth | NIMC NVS | Gate before adapter installation |
|---|---|---|---|---|
| Signed agreement, permitted purpose, field list, retention rules, DPA/MOU | Required | Required | Required | Legal, DPO, and provider owner approval. |
| Sandbox and production entitlement | Required | Required | Required | A separate `data_provider_authorizations` row per environment. |
| Versioned OpenAPI/JSON schema, OAuth/mTLS guide, or WSDL/XSD | Provider-issued | Provider-issued | Provider-issued SOAP WSDL/XSD | SHA-256 fingerprint accepted by security review and stored with `contract_version`. |
| Exact endpoint/issuer, client ID, scopes, mTLS/VPN/IP policy, timeouts/rate limits, correlation and idempotency semantics | Required | Required | Required | Typed configuration validates every non-secret value; secret manager supplies credentials/certificates. |
| Test fixtures and certification exit criteria | Required | Required | Required | Contract fixtures pass in isolated CI; provider certification is documented. |
| Callback/status-query security details | If offered | If offered | If offered | Signed webhook/mTLS/JWS or documented polling integrity verified. |

## 3. Adapter modules to add after approval

The contract package must add modules below. They must be reviewed as a single provider change and must carry an exact immutable `contractVersion` matching the approved `data_provider_authorizations.contract_version` value.

| Module | Required responsibility | Prohibited behavior |
|---|---|---|
| `server/providers/contracts.ts` | Typed configuration and contract fingerprint registry; validates secret-reference, issuer/base URL, interface version, scopes, egress/mTLS policy, and timeouts. | Default URL, public scraped schema, optional production credentials, raw secret return. |
| `server/providers/nibssBvnClient.ts` | Locks the one-time consent token, builds the provider-issued request, validates exact response schema/signature, and reports typed terminal/retryable outcomes. | Client-side BVN/Retrieval Token, token retry after ambiguous failure, “no match” from a transport error. |
| `server/providers/nimcNinAuthClient.ts` | Generates state/nonce/PKCE, validates pinned issuer, callback correlation, audience/signature/expiry, and returns minimal approved claims only. | Raw NIN default storage, arbitrary issuer discovery, redirect wildcard, accepting a callback with mismatched state. |
| `server/providers/nimcNvsSoapClient.ts` | Generated SOAP types from provider WSDL, XXE/DTD disabled, XSD/signature validation, bounded payload, provider-required mTLS/VPN. | Hand-built XML string interpolation, DTD/external entity parsing, public internet SOAP route, unvalidated fault as “not found.” |
| `server/providers/providerResult.ts` | Discriminated result union: `verified`, `consumer_action_required`, `retryable_failure`, `terminal_provider_failure`, `protocol_failure`. | Boolean `success` plus arbitrary response JSON. |
| `server/consumerDisputeProviderOutboxWorker.ts` | Registers only reviewed contract adapters, updates delivery/task state from typed result, and records a redacted immutable event. | Logging request/response body, token, NIN, BVN, or credential; bypassing authorization recheck. |

### Contract adapter result union

```ts
export type ProviderDispatchResult =
  | { kind: "verified"; providerTransactionRef: string; receivedAt: string; permittedResult: Record<string, unknown> }
  | { kind: "consumer_action_required"; code: string; providerTransactionRef?: string }
  | { kind: "retryable_failure"; code: string; retryAfterSeconds?: number; providerTransactionRef?: string }
  | { kind: "terminal_provider_failure"; code: string; providerTransactionRef?: string }
  | { kind: "protocol_failure"; code: "PROVIDER_PROTOCOL_INVALID"; evidenceFingerprint: string };
```

`permittedResult` is not raw provider JSON. The adapter first validates the provider response against the signed interface package and reduces it to an allow-listed, encrypted storage projection.

## 4. Dispatch sequence and error policy

1. The worker decrypts the opaque outbox payload and verifies its SHA-256 fingerprint.
2. It rechecks the authorization’s active status, tenant/global scope, provider environment, effective/expiry interval, and data source.
3. It loads the contract adapter only when its code artifact is matched to the authorization’s exact contract version and approved interface fingerprint.
4. The adapter resolves credentials only in the worker process and only through the approved secret-management identity. It uses the provider’s approved private route/mTLS/certificate policy.
5. For NIBSS, the adapter locks the one-time Retrieval Token lifecycle before dispatch and uses a provider status query before any ambiguous retry when the contract supports one. [1]
6. For NINAuth, the adapter validates issuer, callback correlation, nonce, PKCE, audience, signature, and expiry before persisting a minimal verified assertion. [2]
7. For NVS, the adapter uses generated types, disables XXE/DTD, applies the provider’s least-privilege access level and VPN route, and validates all SOAP fault/success structures. [3]
8. Only a schema-valid terminal result may update a screening result. Every other condition leaves the case in `processing` or `review`; none becomes a clear/no-record/adverse result.

| Error class | Outbox transition | Case/task state | Retry |
|---|---|---|---|
| Missing authorization, expired scope, adapter absent, bad contract fingerprint | `dead_letter` | Task `failed`, case `review` | None; provider/compliance owner must create a newly authorized event. |
| Consent denied/expired, used Retrieval Token, invalid callback state | `dead_letter` | `awaiting_consumer` or `review` | New consent flow only. |
| Provider `429`, documented temporary fault, temporary DNS/VPN/TLS timeout | `pending` with bounded delay | `processing` | Only when provider contract documents safe idempotency/status-query semantics. |
| Ambiguous response after Retrieval Token submission | `pending` only after provider status query support is confirmed | `processing` | Never replay a one-time token blindly. |
| Schema/signature/XSD/issuer mismatch | `dead_letter` | `review` | None; quarantine metadata and security escalation. |
| Valid final verification | `delivered` | Task response and case workflow advance | None. |

## 5. Automated test suite and acceptance gates

Tests must use provider-supplied certification fixtures or the clearly labeled BIS synthetic data package. No test may make a live NIBSS/NIMC call without a separate approved staging run and synthetic/consented subject.

| Test layer | Required tests | Pass condition |
|---|---|---|
| Unit: contract config | Missing/blank version, secret ref, scope, route, certificate policy, contract fingerprint, or valid expiry. | Adapter construction fails before network I/O. |
| Unit: NIBSS consent | Expired, used, revoked, cross-subject, and concurrent Retrieval Token consumption. | Exactly one atomic transition; no outbound call for invalid token. |
| Unit: NINAuth callback | Wrong state/nonce/PKCE/audience/issuer/JWS key/expiry. | `protocol_failure` or consumer action; no claims persisted. |
| Unit: NVS XML | DTD/XXE, over-size body, invalid XSD, invalid signature, documented SOAP fault. | Parser rejects safely; response body absent from logs/events. |
| Unit: outbox crypto | Ciphertext modification, nonce modification, AAD/idempotency mismatch, missing/expired key. | Authentication/decryption fails closed. |
| Integration: PostgreSQL | Source task and outbox written atomically; worker crash recovers stale lease; duplicate idempotency key has one provider request. | Zero orphan tasks/events and at-most-once provider dispatch under documented idempotency. |
| Integration: evidence | Correct SSE-KMS, object version, content type/length, metadata, and `x-amz-checksum-sha256`; substituted bytes with copied metadata. | Completion accepts only exact object checksum and rejects/quarantines substituted or checksum-less bytes. |
| Staging certification | Provider sandbox fixture, mTLS/VPN route, consent flow, status query/callback, audit/metrics redaction, incident drill. | Provider and security owners sign evidence; authorization becomes active only in staging. |

## References

[1]: https://nibss-plc.com.ng/bank-verification-numberbvn/updates/ "NIBSS — BVN Validation Portal Updates"
[2]: https://ninauth.nimc.gov.ng/developers-guide "NIMC — NINAuth Developers Guide"
[3]: https://nimc.gov.ng/nimc-verification-service-api "NIMC — Verification Service API"
