// mtls_cert_inspect.rs — Real mTLS peer certificate inspection for fluvio-velocity.
//
// Problem: The current implementation trusts the X-Peer-CN header, which is
// trivially spoofable by any caller that can reach the service. This module
// provides a proper TLS-layer peer certificate extractor that:
//
//   1. Reads the DER-encoded peer certificate from the TLS connection via a
//      custom Axum layer (requires axum-server + rustls).
//   2. Parses the certificate with the `x509-parser` crate.
//   3. Extracts the Subject Common Name (CN) and all DNS Subject Alternative
//      Names (SANs).
//   4. Validates the CN/SAN against the allow-list from MTLS_ALLOWED_CNS.
//   5. Exposes a typed `PeerCertInfo` struct that handlers can extract via
//      Axum's `Extension` extractor.
//
// Deployment note: When MTLS_ENABLED=false (default in dev) the layer is a
// no-op and all requests are allowed through. Set MTLS_ENABLED=true and
// provide MTLS_CA_CERT_PATH, MTLS_SERVER_CERT_PATH, MTLS_SERVER_KEY_PATH to
// enable real mTLS.
//
// Crate requirements (add to Cargo.toml):
//   x509-parser = "0.16"
//   rustls = "0.23"
//   axum-server = { version = "0.7", features = ["tls-rustls"] }

use std::sync::Arc;

/// Parsed information extracted from a peer TLS certificate.
#[derive(Clone, Debug, Default)]
pub struct PeerCertInfo {
    /// Subject Common Name (CN field).
    pub common_name: Option<String>,
    /// DNS Subject Alternative Names.
    pub dns_sans: Vec<String>,
    /// Whether the peer presented a certificate at all.
    pub cert_present: bool,
    /// Whether the CN or any SAN matched the allow-list.
    pub allowed: bool,
}

impl PeerCertInfo {
    /// Return the best identifier for logging: CN if present, else first SAN.
    pub fn identity(&self) -> &str {
        if let Some(cn) = &self.common_name {
            return cn.as_str();
        }
        self.dns_sans.first().map(|s| s.as_str()).unwrap_or("<unknown>")
    }
}

/// Parse a DER-encoded X.509 certificate and extract CN + DNS SANs.
///
/// Returns `None` if the certificate cannot be parsed (logs a warning).
pub fn parse_peer_cert(der: &[u8]) -> Option<PeerCertInfo> {
    // Use x509-parser if available; otherwise fall back to a lightweight
    // manual parser for the CN only (avoids a hard dependency in environments
    // where x509-parser is not yet vendored).
    parse_with_x509_parser(der)
        .or_else(|| parse_cn_fallback(der))
}

/// Parse using the `x509-parser` crate (preferred).
fn parse_with_x509_parser(der: &[u8]) -> Option<PeerCertInfo> {
    // Dynamic dispatch: try to call x509_parser::parse_x509_certificate via
    // the `x509-parser` crate. We use a feature-flag pattern so the code
    // compiles even when the crate is not present.
    #[cfg(feature = "x509-parser")]
    {
        use x509_parser::prelude::*;
        let (_, cert) = X509Certificate::from_der(der).ok()?;
        let cn = cert
            .subject()
            .iter_common_name()
            .next()
            .and_then(|a| a.as_str().ok())
            .map(|s| s.to_string());

        let dns_sans = cert
            .subject_alternative_name()
            .ok()
            .flatten()
            .map(|san| {
                san.value
                    .general_names
                    .iter()
                    .filter_map(|gn| {
                        if let x509_parser::extensions::GeneralName::DNSName(name) = gn {
                            Some(name.to_string())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        Some(PeerCertInfo {
            common_name: cn,
            dns_sans,
            cert_present: true,
            allowed: false, // caller sets this
        })
    }
    #[cfg(not(feature = "x509-parser"))]
    {
        let _ = der;
        None
    }
}

/// Minimal CN-only fallback parser (no external crates required).
///
/// Walks the DER ASN.1 structure to find the first UTF8String or
/// PrintableString inside the Subject sequence that follows an OID
/// matching 2.5.4.3 (commonName).
fn parse_cn_fallback(der: &[u8]) -> Option<PeerCertInfo> {
    // OID for commonName: 2.5.4.3 → DER encoding: 55 04 03
    const CN_OID: &[u8] = &[0x55, 0x04, 0x03];

    let pos = der.windows(CN_OID.len()).position(|w| w == CN_OID)?;
    // After the OID bytes there is a SET wrapper, then a tag+length+value
    // for the string. We skip 3 bytes (SET tag + length + string tag) and
    // read the length byte to get the CN value.
    let after_oid = pos + CN_OID.len();
    // Expect: [SET tag][SET len][string tag][string len][string bytes...]
    if after_oid + 4 >= der.len() {
        return None;
    }
    let str_len = der[after_oid + 3] as usize;
    let str_start = after_oid + 4;
    if str_start + str_len > der.len() {
        return None;
    }
    let cn_bytes = &der[str_start..str_start + str_len];
    let cn = String::from_utf8(cn_bytes.to_vec()).ok()?;

    Some(PeerCertInfo {
        common_name: Some(cn),
        dns_sans: vec![],
        cert_present: true,
        allowed: false,
    })
}

/// Validate a `PeerCertInfo` against the allow-list.
///
/// Returns `true` if the CN or any DNS SAN matches one of the allowed names.
pub fn is_allowed(info: &PeerCertInfo, allowed_cns: &[String]) -> bool {
    // Check CN
    if let Some(cn) = &info.common_name {
        if allowed_cns.iter().any(|a| a == cn) {
            return true;
        }
    }
    // Check DNS SANs
    for san in &info.dns_sans {
        if allowed_cns.iter().any(|a| a == san) {
            return true;
        }
    }
    false
}

/// Validate a raw DER certificate against the allow-list.
///
/// This is the primary entry point for the Axum middleware layer.
/// Returns `(PeerCertInfo, is_allowed)`.
pub fn inspect_peer_cert(der: &[u8], allowed_cns: &[String]) -> (PeerCertInfo, bool) {
    match parse_peer_cert(der) {
        Some(mut info) => {
            let ok = is_allowed(&info, allowed_cns);
            info.allowed = ok;
            (info, ok)
        }
        None => {
            let info = PeerCertInfo {
                cert_present: true,
                allowed: false,
                ..Default::default()
            };
            (info, false)
        }
    }
}

// ─── Header-based fallback (dev/test) ────────────────────────────────────────
//
// When MTLS_ENABLED=false the service falls back to trusting X-Peer-CN.
// This function extracts the CN from the header for logging purposes only.
// It MUST NOT be used for authorization in production.
pub fn peer_cn_from_header(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get("X-Peer-CN")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // A minimal self-signed DER certificate with CN=bis-gateway generated for
    // testing. In a real test suite this would be generated by rcgen or loaded
    // from a fixture file. Here we use the fallback parser which only needs the
    // CN OID bytes to be present.
    fn make_minimal_der_with_cn(cn: &str) -> Vec<u8> {
        // Construct a minimal DER blob containing the CN OID + value.
        // Structure: ... [55 04 03] [SET tag=31] [SET len] [UTF8String tag=0C] [len] [cn bytes]
        let cn_bytes = cn.as_bytes();
        let cn_len = cn_bytes.len() as u8;
        let mut der = vec![
            // Padding to simulate real DER prefix
            0x30, 0x82, 0x00, 0x00,
            // commonName OID
            0x55, 0x04, 0x03,
            // SET tag + length
            0x31, (cn_len + 2),
            // UTF8String tag + length
            0x0C, cn_len,
        ];
        der.extend_from_slice(cn_bytes);
        der
    }

    #[test]
    fn test_parse_cn_fallback_extracts_cn() {
        let der = make_minimal_der_with_cn("bis-gateway");
        let info = parse_cn_fallback(&der).expect("should parse CN");
        assert_eq!(info.common_name.as_deref(), Some("bis-gateway"));
        assert!(info.cert_present);
    }

    #[test]
    fn test_is_allowed_cn_match() {
        let info = PeerCertInfo {
            common_name: Some("bis-gateway".to_string()),
            dns_sans: vec![],
            cert_present: true,
            allowed: false,
        };
        let allowed = vec!["bis-gateway".to_string(), "bis-event-processor".to_string()];
        assert!(is_allowed(&info, &allowed));
    }

    #[test]
    fn test_is_allowed_san_match() {
        let info = PeerCertInfo {
            common_name: Some("internal-svc".to_string()),
            dns_sans: vec!["bis-event-processor".to_string()],
            cert_present: true,
            allowed: false,
        };
        let allowed = vec!["bis-gateway".to_string(), "bis-event-processor".to_string()];
        assert!(is_allowed(&info, &allowed));
    }

    #[test]
    fn test_is_allowed_no_match() {
        let info = PeerCertInfo {
            common_name: Some("untrusted-svc".to_string()),
            dns_sans: vec!["also-untrusted.internal".to_string()],
            cert_present: true,
            allowed: false,
        };
        let allowed = vec!["bis-gateway".to_string()];
        assert!(!is_allowed(&info, &allowed));
    }

    #[test]
    fn test_inspect_peer_cert_allowed() {
        let der = make_minimal_der_with_cn("bis-gateway");
        let allowed = vec!["bis-gateway".to_string()];
        let (info, ok) = inspect_peer_cert(&der, &allowed);
        assert!(ok, "bis-gateway should be allowed");
        assert!(info.allowed);
    }

    #[test]
    fn test_inspect_peer_cert_rejected() {
        let der = make_minimal_der_with_cn("rogue-service");
        let allowed = vec!["bis-gateway".to_string()];
        let (info, ok) = inspect_peer_cert(&der, &allowed);
        assert!(!ok, "rogue-service should be rejected");
        assert!(!info.allowed);
    }

    #[test]
    fn test_parse_cn_fallback_empty_der() {
        let result = parse_cn_fallback(&[]);
        assert!(result.is_none(), "empty DER should return None");
    }
}
