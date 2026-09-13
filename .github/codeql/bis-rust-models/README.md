# BIS Rust CodeQL transport-security model pack

This model pack teaches CodeQL Rust analyses about two narrow, reviewed boundaries:
a successful `TrustedEndpoint::parse` result is a validated endpoint, and a
`BoundedGatewayPayload::into_bytes` result is a fixed-capacity HTTP body. The
endpoint parser enforces an absolute HTTPS URL, an exact configured host allow-list,
and rejects userinfo, query strings, and fragments.

## Security scope

The model contains exactly two narrow barriers:

```text
<bis_transport_policy::TrustedEndpoint>::parse
  -> ReturnValue.Field[core::result::Result::Ok(0)]
  -> request-forgery

<fluvio_velocity::BoundedGatewayPayload>::into_bytes
  -> ReturnValue
  -> resource-exhaustion
```

It does **not** model `with_path_segments` or the gateway payload encoder as a
barrier. Any future request-derived path segment or unbounded serialization path
therefore remains visible to CodeQL. Do not add a broader barrier or neutral model
without a security review and a negative test.

## Publishing

1. Review the model against the current canonical Rust path in the CodeQL
   database and bump `version` in `qlpack.yml` for any semantic change.
2. Run the manual-only **Publish BIS CodeQL Rust Model Pack** workflow.
3. Confirm the immutable `munisp/bis-rust-models@<version>` package exists in
   the organization GitHub Container Registry.
4. Enable `.github/codeql/codeql-config.published-model-pack.yml` for the
   Rust-specific CodeQL initialization, pinning the exact published version.
5. Verify the next CodeQL comparison resolves only the intended trusted-endpoint
   SSRF flows and fixed-capacity payload conversion, while still reporting a
   deliberately unsafe path-segment or unbounded-serialization regression.

## Rollback

Revert the CodeQL configuration reference to the prior known-good model-pack
version. Do not delete a published immutable package version or dismiss a
security alert merely because analysis configuration changed.
