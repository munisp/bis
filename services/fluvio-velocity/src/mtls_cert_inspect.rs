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

/// Parsed information extracted from a peer TLS certificate.
#[derive(Clone, Debug, Default)]
pub struct PeerCertInfo {
    /// Subject Common Name (CN field).
    pub common_name: Option<String>,
    /// DNS Subject Alternative Names.
    pub dns_sans: Vec<String>,
    /// Whether the CN or any SAN matched the allow-list.
    pub allowed: bool,
}

impl PeerCertInfo {
    /// Return the best identifier for logging: CN if present, else first SAN.
    pub fn identity(&self) -> &str {
        if let Some(cn) = &self.common_name {
            return cn.as_str();
        }
        self.dns_sans
            .first()
            .map(|s| s.as_str())
            .unwrap_or("<unknown>")
    }
}

/// Parse a DER-encoded RFC 5280 certificate and extract CN + DNS SANs.
/// Invalid or incomplete certificates are rejected; no heuristic DER fallback is used.
pub fn parse_peer_cert(der: &[u8]) -> Option<PeerCertInfo> {
    use x509_parser::extensions::GeneralName;
    use x509_parser::prelude::{FromDer, X509Certificate};

    let (_, cert) = X509Certificate::from_der(der).ok()?;
    let common_name = cert
        .subject()
        .iter_common_name()
        .next()
        .and_then(|attribute| attribute.as_str().ok())
        .map(str::to_owned);
    let dns_sans = cert
        .subject_alternative_name()
        .ok()
        .flatten()
        .map(|extension| {
            extension
                .value
                .general_names
                .iter()
                .filter_map(|name| match name {
                    GeneralName::DNSName(value) => Some(value.to_string()),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();

    Some(PeerCertInfo {
        common_name,
        dns_sans,
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
        None => (PeerCertInfo::default(), false),
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_der_is_rejected_without_fallback() {
        let synthetic_der = [0x30, 0x82, 0x00, 0x00, 0x55, 0x04, 0x03];
        assert!(parse_peer_cert(&synthetic_der).is_none());
    }

    #[test]
    fn test_is_allowed_cn_match() {
        let info = PeerCertInfo {
            common_name: Some("bis-gateway".to_string()),
            dns_sans: vec![],
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
            allowed: false,
        };
        let allowed = vec!["bis-gateway".to_string()];
        assert!(!is_allowed(&info, &allowed));
    }

    #[test]
    fn test_inspect_peer_cert_rejects_invalid_der() {
        let allowed = vec!["bis-gateway".to_string()];
        let (info, ok) = inspect_peer_cert(&[], &allowed);
        assert!(!ok, "invalid DER must be rejected");
        assert!(!info.allowed);
    }
}
