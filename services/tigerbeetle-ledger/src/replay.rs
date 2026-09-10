use deadpool_postgres::{ChannelBinding, Config as PoolConfig, Pool, Runtime, SslMode};
use rustls::{
    pki_types::{
        CertificateDer, PrivateKeyDer, PrivatePkcs1KeyDer, PrivatePkcs8KeyDer, PrivateSec1KeyDer,
    },
    ClientConfig, RootCertStore,
};
use std::{env, fs, time::Duration};
use tokio_postgres_rustls::MakeRustlsConnect;

#[derive(Clone)]
pub struct ReplayStore {
    backend: ReplayBackend,
}

#[derive(Clone)]
enum ReplayBackend {
    Postgres(Pool),
    #[cfg(test)]
    Memory(std::sync::Arc<std::sync::Mutex<std::collections::HashSet<Vec<u8>>>>),
}

#[derive(Debug)]
pub struct ReplayReservation<'a> {
    pub key_id: &'a str,
    pub nonce_hash: &'a [u8; 32],
    pub tenant_id: i32,
    pub actor_id: i32,
    pub method: &'a str,
    pub canonical_path: &'a str,
    pub body_sha256: &'a [u8; 32],
}

#[derive(Debug)]
pub enum ReplayError {
    Unavailable,
    Replayed,
}

impl ReplayStore {
    /// Builds a durable, TLS-authenticated PostgreSQL nonce store. The ledger must
    /// not start when this dependency is unavailable: accepting requests without
    /// replay protection would make money-moving operations unsafe.
    pub async fn connect_required() -> Result<Self, String> {
        let dsn = required_env("BIS_LEDGER_REPLAY_DATABASE_URL")?;
        let mut config = PoolConfig::new();
        config.url = Some(dsn);
        config.ssl_mode = Some(SslMode::Require);
        config.channel_binding = Some(ChannelBinding::Require);
        config.connect_timeout = Some(Duration::from_secs(5));
        let pool = config
            .create_pool(Some(Runtime::Tokio1), postgres_tls_connector()?)
            .map_err(|_| "ledger replay PostgreSQL pool could not be initialized".to_string())?;

        let client = pool
            .get()
            .await
            .map_err(|_| "ledger replay PostgreSQL connection unavailable".to_string())?;
        client
            .batch_execute(
                "
                CREATE TABLE IF NOT EXISTS ledger_request_nonces (
                    key_id          TEXT        NOT NULL,
                    nonce_hash      BYTEA       NOT NULL,
                    tenant_id       INTEGER     NOT NULL CHECK (tenant_id > 0),
                    actor_id        INTEGER     NOT NULL CHECK (actor_id > 0),
                    method          TEXT        NOT NULL CHECK (method IN ('POST', 'GET')),
                    canonical_path  TEXT        NOT NULL,
                    body_sha256     BYTEA       NOT NULL,
                    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
                    expires_at      TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY (key_id, nonce_hash)
                );
                CREATE INDEX IF NOT EXISTS ledger_request_nonces_expiry_idx
                    ON ledger_request_nonces (expires_at);
                ",
            )
            .await
            .map_err(|_| "ledger replay PostgreSQL schema unavailable".to_string())?;
        Ok(Self {
            backend: ReplayBackend::Postgres(pool),
        })
    }

    #[cfg(test)]
    pub fn in_memory() -> Self {
        Self {
            backend: ReplayBackend::Memory(std::sync::Arc::new(std::sync::Mutex::new(
                std::collections::HashSet::new(),
            ))),
        }
    }

    /// Atomically reserves a request nonce before a protected ledger handler is
    /// executed. A duplicate is never dispatched to TigerBeetle.
    pub async fn reserve(&self, reservation: ReplayReservation<'_>) -> Result<(), ReplayError> {
        match &self.backend {
            ReplayBackend::Postgres(pool) => {
                let client = pool.get().await.map_err(|_| ReplayError::Unavailable)?;
                let inserted = client
                    .query_opt(
                        "
                        INSERT INTO ledger_request_nonces
                            (key_id, nonce_hash, tenant_id, actor_id, method, canonical_path, body_sha256, expires_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '15 minutes')
                        ON CONFLICT (key_id, nonce_hash) DO NOTHING
                        RETURNING 1
                        ",
                        &[
                            &reservation.key_id,
                            &reservation.nonce_hash.as_slice(),
                            &reservation.tenant_id,
                            &reservation.actor_id,
                            &reservation.method,
                            &reservation.canonical_path,
                            &reservation.body_sha256.as_slice(),
                        ],
                    )
                    .await
                    .map_err(|_| ReplayError::Unavailable)?;
                if inserted.is_some() {
                    Ok(())
                } else {
                    Err(ReplayError::Replayed)
                }
            }
            #[cfg(test)]
            ReplayBackend::Memory(used) => {
                let mut key = reservation.key_id.as_bytes().to_vec();
                key.extend_from_slice(reservation.nonce_hash);
                let mut guard = used.lock().map_err(|_| ReplayError::Unavailable)?;
                if guard.insert(key) {
                    Ok(())
                } else {
                    Err(ReplayError::Replayed)
                }
            }
        }
    }
}

fn required_env(name: &str) -> Result<String, String> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{name} must be configured"))
}

fn postgres_tls_connector() -> Result<MakeRustlsConnect, String> {
    let ca_pem = fs::read(required_env("BIS_LEDGER_POSTGRES_TLS_CA_PEM_FILE")?)
        .map_err(|_| "ledger replay PostgreSQL TLS CA file cannot be read".to_string())?;
    let cert_pem = fs::read(required_env(
        "BIS_LEDGER_POSTGRES_TLS_CLIENT_CERT_PEM_FILE",
    )?)
    .map_err(|_| "ledger replay PostgreSQL TLS client certificate cannot be read".to_string())?;
    let key_pem = fs::read(required_env("BIS_LEDGER_POSTGRES_TLS_CLIENT_KEY_PEM_FILE")?)
        .map_err(|_| "ledger replay PostgreSQL TLS client key cannot be read".to_string())?;

    let mut roots = RootCertStore::empty();
    for certificate in pem_certificates(&ca_pem, "ledger replay PostgreSQL TLS CA PEM")? {
        roots
            .add(certificate)
            .map_err(|_| "ledger replay PostgreSQL TLS CA is invalid".to_string())?;
    }
    if roots.is_empty() {
        return Err("ledger replay PostgreSQL TLS CA has no certificates".to_string());
    }
    let certificates =
        pem_certificates(&cert_pem, "ledger replay PostgreSQL client certificate PEM")?;
    if certificates.is_empty() {
        return Err("ledger replay PostgreSQL client certificate has no certificates".to_string());
    }
    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_client_auth_cert(certificates, pem_private_key(&key_pem)?)
        .map_err(|_| "ledger replay PostgreSQL client identity is invalid".to_string())?;
    Ok(MakeRustlsConnect::new(config))
}

fn pem_certificates(bytes: &[u8], label: &str) -> Result<Vec<CertificateDer<'static>>, String> {
    Ok(pem::parse_many(bytes)
        .map_err(|_| format!("{label} is invalid"))?
        .into_iter()
        .filter(|entry| entry.tag() == "CERTIFICATE")
        .map(|entry| CertificateDer::from(entry.into_contents()))
        .collect())
}

fn pem_private_key(bytes: &[u8]) -> Result<PrivateKeyDer<'static>, String> {
    let entry = pem::parse_many(bytes)
        .map_err(|_| "ledger replay PostgreSQL private key is invalid".to_string())?
        .into_iter()
        .find(|entry| {
            matches!(
                entry.tag(),
                "PRIVATE KEY" | "RSA PRIVATE KEY" | "EC PRIVATE KEY"
            )
        })
        .ok_or_else(|| "ledger replay PostgreSQL private key is missing".to_string())?;
    let tag = entry.tag().to_owned();
    let contents = entry.into_contents();
    match tag.as_str() {
        "PRIVATE KEY" => Ok(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(contents))),
        "RSA PRIVATE KEY" => Ok(PrivateKeyDer::Pkcs1(PrivatePkcs1KeyDer::from(contents))),
        "EC PRIVATE KEY" => Ok(PrivateKeyDer::Sec1(PrivateSec1KeyDer::from(contents))),
        _ => Err("ledger replay PostgreSQL private key type is unsupported".to_string()),
    }
}
