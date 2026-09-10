use reqwest::{
    redirect::Policy, Certificate, Client, ClientBuilder, Identity, RequestBuilder, Response, Url,
};
use serde::Serialize;
use std::{collections::HashSet, fs, time::Duration};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TransportPolicyError {
    #[error("{name} must be configured")]
    MissingConfiguration { name: String },
    #[error("{name} must be an absolute HTTPS URL")]
    InvalidUrl { name: String },
    #[error("{name} must use HTTPS")]
    InsecureScheme { name: String },
    #[error("{name} must not include credentials, query parameters, or fragments")]
    UnsafeUrlComponent { name: String },
    #[error("{name} host is not allow-listed")]
    HostNotAllowed { name: String },
    #[error("endpoint cannot accept path segments")]
    CannotJoinPath,
    #[error("request path contains an unsafe segment")]
    UnsafePathSegment,
    #[error("required TLS material could not be read")]
    TlsMaterialUnreadable,
    #[error("TLS material is invalid")]
    TlsMaterialInvalid,
    #[error("HTTP client setup failed")]
    ClientBuild,
    #[error("trusted HTTPS request failed")]
    RequestFailed,
}

#[derive(Clone, Debug)]
pub struct TrustedEndpoint(Url);

impl TrustedEndpoint {
    pub fn parse(
        name: impl Into<String>,
        raw: &str,
        allowed_hosts: &HashSet<String>,
    ) -> Result<Self, TransportPolicyError> {
        let name = name.into();
        if raw.trim().is_empty() {
            return Err(TransportPolicyError::MissingConfiguration { name });
        }
        let mut url = Url::parse(raw.trim())
            .map_err(|_| TransportPolicyError::InvalidUrl { name: name.clone() })?;
        if url.scheme() != "https" {
            return Err(TransportPolicyError::InsecureScheme { name });
        }
        if !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(TransportPolicyError::UnsafeUrlComponent { name });
        }
        let host = url
            .host_str()
            .map(str::to_ascii_lowercase)
            .ok_or_else(|| TransportPolicyError::InvalidUrl { name: name.clone() })?;
        if !allowed_hosts.contains(&host) {
            return Err(TransportPolicyError::HostNotAllowed { name });
        }
        let normalized_path = url.path().trim_end_matches('/').to_owned();
        url.set_path(&normalized_path);
        Ok(Self(url))
    }

    pub fn with_path_segments(&self, segments: &[&str]) -> Result<Url, TransportPolicyError> {
        let mut url = self.0.clone();
        let mut path = url
            .path_segments_mut()
            .map_err(|_| TransportPolicyError::CannotJoinPath)?;
        path.pop_if_empty();
        for segment in segments {
            validate_path_segment(segment)?;
            path.push(segment);
        }
        drop(path);
        Ok(url)
    }

    pub fn as_url(&self) -> &Url {
        &self.0
    }
}

/// Permit only one opaque path component at a time. URL path delimiters,
/// traversal components, and control bytes are rejected before construction.
/// This prevents callers from changing the trusted endpoint's authority, query,
/// fragment, or path semantics through a later request segment.
fn validate_path_segment(segment: &str) -> Result<(), TransportPolicyError> {
    if segment.is_empty()
        || matches!(segment, "." | "..")
        || segment.bytes().any(|byte| {
            byte.is_ascii_control() || matches!(byte, b'/' | b'\\' | b'?' | b'#' | b'@')
        })
    {
        return Err(TransportPolicyError::UnsafePathSegment);
    }
    Ok(())
}

pub fn required_allowed_hosts(variable: &str) -> Result<HashSet<String>, TransportPolicyError> {
    let raw = std::env::var(variable).map_err(|_| TransportPolicyError::MissingConfiguration {
        name: variable.to_owned(),
    })?;
    let hosts = raw
        .split(',')
        .map(str::trim)
        .filter(|host| !host.is_empty())
        .map(str::to_ascii_lowercase)
        .collect::<HashSet<_>>();
    if hosts.is_empty() {
        return Err(TransportPolicyError::MissingConfiguration {
            name: variable.to_owned(),
        });
    }
    Ok(hosts)
}

#[derive(Clone)]
pub struct TrustedHttpsClient {
    endpoint: TrustedEndpoint,
    client: Client,
}

impl TrustedHttpsClient {
    pub fn new(
        endpoint: TrustedEndpoint,
        timeout: Duration,
        connect_timeout: Duration,
    ) -> Result<Self, TransportPolicyError> {
        Ok(Self {
            endpoint,
            client: https_client(timeout, connect_timeout)?,
        })
    }

    pub fn get(&self, segments: &[&str]) -> Result<RequestBuilder, TransportPolicyError> {
        Ok(self.client.get(self.endpoint.with_path_segments(segments)?))
    }

    pub fn post(&self, segments: &[&str]) -> Result<RequestBuilder, TransportPolicyError> {
        Ok(self
            .client
            .post(self.endpoint.with_path_segments(segments)?))
    }
}

#[derive(Clone)]
pub struct MtlsTrustedHttpsClient {
    endpoint: TrustedEndpoint,
    client: Client,
}

impl MtlsTrustedHttpsClient {
    pub fn new(
        endpoint: TrustedEndpoint,
        timeout: Duration,
        connect_timeout: Duration,
        ca_pem_path: &str,
        identity_pem_path: &str,
    ) -> Result<Self, TransportPolicyError> {
        Ok(Self {
            endpoint,
            client: mtls_https_client(timeout, connect_timeout, ca_pem_path, identity_pem_path)?,
        })
    }

    pub async fn get(&self, segments: &[&str]) -> Result<Response, TransportPolicyError> {
        self.client
            .get(self.endpoint.with_path_segments(segments)?)
            .send()
            .await
            .map_err(|_| TransportPolicyError::RequestFailed)
    }

    pub async fn post_json<T: Serialize + ?Sized>(
        &self,
        segments: &[&str],
        body: &T,
    ) -> Result<Response, TransportPolicyError> {
        self.client
            .post(self.endpoint.with_path_segments(segments)?)
            .json(body)
            .send()
            .await
            .map_err(|_| TransportPolicyError::RequestFailed)
    }
}

pub fn https_client(
    timeout: Duration,
    connect_timeout: Duration,
) -> Result<Client, TransportPolicyError> {
    Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .timeout(timeout)
        .connect_timeout(connect_timeout)
        .build()
        .map_err(|_| TransportPolicyError::ClientBuild)
}

pub fn mtls_https_client(
    timeout: Duration,
    connect_timeout: Duration,
    ca_pem_path: &str,
    identity_pem_path: &str,
) -> Result<Client, TransportPolicyError> {
    let ca_pem = fs::read(ca_pem_path).map_err(|_| TransportPolicyError::TlsMaterialUnreadable)?;
    let identity_pem =
        fs::read(identity_pem_path).map_err(|_| TransportPolicyError::TlsMaterialUnreadable)?;
    let ca =
        Certificate::from_pem(&ca_pem).map_err(|_| TransportPolicyError::TlsMaterialInvalid)?;
    let identity =
        Identity::from_pem(&identity_pem).map_err(|_| TransportPolicyError::TlsMaterialInvalid)?;
    secure_client_builder(timeout, connect_timeout)
        .add_root_certificate(ca)
        .identity(identity)
        .build()
        .map_err(|_| TransportPolicyError::ClientBuild)
}

fn secure_client_builder(timeout: Duration, connect_timeout: Duration) -> ClientBuilder {
    Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .timeout(timeout)
        .connect_timeout(connect_timeout)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hosts() -> HashSet<String> {
        HashSet::from(["ledger.internal".to_owned()])
    }

    #[test]
    fn endpoint_requires_allowlisted_https_without_userinfo_or_query() {
        assert!(TrustedEndpoint::parse("TEST", "https://ledger.internal/base/", &hosts()).is_ok());
        assert!(TrustedEndpoint::parse("TEST", "http://ledger.internal", &hosts()).is_err());
        assert!(
            TrustedEndpoint::parse("TEST", "https://user:pass@ledger.internal", &hosts()).is_err()
        );
        assert!(TrustedEndpoint::parse(
            "TEST",
            "https://ledger.internal?next=https://metadata.google.internal",
            &hosts()
        )
        .is_err());
        assert!(
            TrustedEndpoint::parse("TEST", "https://metadata.google.internal", &hosts()).is_err()
        );
    }

    #[test]
    fn endpoint_joins_escaped_path_segments() {
        let endpoint = TrustedEndpoint::parse("TEST", "https://ledger.internal/base", &hosts())
            .expect("endpoint accepted");
        assert_eq!(
            endpoint
                .with_path_segments(&["v1", "webhooks", "created"])
                .expect("path accepted")
                .as_str(),
            "https://ledger.internal/base/v1/webhooks/created"
        );
    }

    #[test]
    fn endpoint_rejects_delimiter_and_traversal_path_segments() {
        let endpoint = TrustedEndpoint::parse("TEST", "https://ledger.internal/base", &hosts())
            .expect("endpoint accepted");

        for unsafe_segment in [
            "",
            ".",
            "..",
            "//metadata.google.internal",
            "https://metadata.google.internal",
            "a/b",
            "next?target=https://metadata.google.internal",
            "fragment#internal",
            "user@internal",
            "line\nbreak",
        ] {
            assert!(endpoint.with_path_segments(&[unsafe_segment]).is_err());
        }
    }
}
