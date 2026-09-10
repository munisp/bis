// db.rs — PostgreSQL persistence for bis-event-processor
//
// Tables (auto-created on startup if they do not exist):
//   bis_audit_log        — append-only event audit trail
//   bis_subscriptions    — webhook subscription registry
//
// The pool is optional: if DATABASE_URL is unset the service falls back to
// in-memory storage so the service can still run in development without a DB.

use crate::{AuditEntry, EventType, Severity, Subscription};
use chrono::{DateTime, Utc};
use deadpool_postgres::{ChannelBinding, Config as PoolConfig, Pool, Runtime, SslMode};
use rustls::{
    pki_types::{
        CertificateDer, PrivateKeyDer, PrivatePkcs1KeyDer, PrivatePkcs8KeyDer, PrivateSec1KeyDer,
    },
    ClientConfig, RootCertStore,
};
use serde_json;
use std::{env, fs, time::Duration};
use tokio_postgres_rustls::MakeRustlsConnect;
use tracing::{error, info, warn};

// ─── Pool bootstrap ───────────────────────────────────────────────────────────

/// Build a PostgreSQL pool with mandatory TLS, CA validation, client identity,
/// and channel binding whenever `DATABASE_URL` is configured.
///
/// A development process may omit the database only when
/// `BIS_EVENT_PROCESSOR_REQUIRE_DATABASE` is not explicitly set to `true`.
pub async fn build_pool() -> Result<Option<Pool>, String> {
    let dsn = match env::var("DATABASE_URL") {
        Ok(value) if !value.trim().is_empty() => value,
        _ if require_database() => {
            return Err(
                "DATABASE_URL must be configured when durable persistence is required".to_string(),
            )
        }
        _ => {
            warn!("DATABASE_URL not set — event-processor running without DB persistence");
            return Ok(None);
        }
    };

    let mut cfg = PoolConfig::new();
    cfg.url = Some(dsn);
    cfg.ssl_mode = Some(SslMode::Require);
    cfg.channel_binding = Some(ChannelBinding::Require);
    cfg.connect_timeout = Some(Duration::from_secs(5));

    let tls = postgres_tls_connector()?;
    cfg.create_pool(Some(Runtime::Tokio1), tls)
        .map(Some)
        .map_err(|_| "PostgreSQL TLS pool could not be initialized".to_string())
}

fn require_database() -> bool {
    matches!(
        env::var("BIS_EVENT_PROCESSOR_REQUIRE_DATABASE").as_deref(),
        Ok("true") | Ok("TRUE") | Ok("1")
    )
}

fn required_tls_path(variable: &str) -> Result<String, String> {
    match env::var(variable) {
        Ok(value) if !value.trim().is_empty() => Ok(value),
        _ => Err(format!("{variable} must be configured for PostgreSQL TLS")),
    }
}

fn postgres_tls_connector() -> Result<MakeRustlsConnect, String> {
    let ca_path = required_tls_path("BIS_EVENT_POSTGRES_TLS_CA_PEM_FILE")?;
    let cert_path = required_tls_path("BIS_EVENT_POSTGRES_TLS_CLIENT_CERT_PEM_FILE")?;
    let key_path = required_tls_path("BIS_EVENT_POSTGRES_TLS_CLIENT_KEY_PEM_FILE")?;

    let ca_pem =
        fs::read(ca_path).map_err(|_| "PostgreSQL TLS CA file could not be read".to_string())?;
    let cert_pem = fs::read(cert_path)
        .map_err(|_| "PostgreSQL TLS client certificate could not be read".to_string())?;
    let key_pem = fs::read(key_path)
        .map_err(|_| "PostgreSQL TLS client key could not be read".to_string())?;

    let mut roots = RootCertStore::empty();
    for certificate in pem_certificates(&ca_pem, "PostgreSQL TLS CA PEM")? {
        roots
            .add(certificate)
            .map_err(|_| "PostgreSQL TLS CA certificate is invalid".to_string())?;
    }
    if roots.is_empty() {
        return Err("PostgreSQL TLS CA PEM contains no certificates".to_string());
    }

    let client_certificates = pem_certificates(&cert_pem, "PostgreSQL TLS client certificate PEM")?;
    if client_certificates.is_empty() {
        return Err("PostgreSQL TLS client certificate PEM contains no certificates".to_string());
    }
    let client_key = pem_private_key(&key_pem)?;

    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_client_auth_cert(client_certificates, client_key)
        .map_err(|_| "PostgreSQL TLS client identity is invalid".to_string())?;
    Ok(MakeRustlsConnect::new(config))
}

fn pem_certificates(bytes: &[u8], label: &str) -> Result<Vec<CertificateDer<'static>>, String> {
    let certificates = pem::parse_many(bytes)
        .map_err(|_| format!("{label} is invalid"))?
        .into_iter()
        .filter(|entry| entry.tag() == "CERTIFICATE")
        .map(|entry| CertificateDer::from(entry.into_contents()))
        .collect::<Vec<_>>();
    Ok(certificates)
}

fn pem_private_key(bytes: &[u8]) -> Result<PrivateKeyDer<'static>, String> {
    let entry = pem::parse_many(bytes)
        .map_err(|_| "PostgreSQL TLS client key PEM is invalid".to_string())?
        .into_iter()
        .find(|entry| {
            matches!(
                entry.tag(),
                "PRIVATE KEY" | "RSA PRIVATE KEY" | "EC PRIVATE KEY"
            )
        })
        .ok_or_else(|| {
            "PostgreSQL TLS client key PEM contains no supported private key".to_string()
        })?;
    let tag = entry.tag().to_owned();
    let contents = entry.into_contents();
    match tag.as_str() {
        "PRIVATE KEY" => Ok(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(contents))),
        "RSA PRIVATE KEY" => Ok(PrivateKeyDer::Pkcs1(PrivatePkcs1KeyDer::from(contents))),
        "EC PRIVATE KEY" => Ok(PrivateKeyDer::Sec1(PrivateSec1KeyDer::from(contents))),
        _ => Err("PostgreSQL TLS client key PEM contains no supported private key".to_string()),
    }
}

/// Run DDL to ensure the required tables exist.
pub async fn migrate(pool: &Pool) {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            error!("DB migrate: failed to get connection: {e}");
            return;
        }
    };

    let ddl = r#"
        CREATE TABLE IF NOT EXISTS bis_audit_log (
            id              TEXT        PRIMARY KEY,
            event_id        TEXT        NOT NULL,
            event_type      TEXT        NOT NULL,
            subject_ref     TEXT        NOT NULL,
            severity        TEXT        NOT NULL,
            source_service  TEXT        NOT NULL,
            summary         TEXT        NOT NULL,
            processing_ns   BIGINT      NOT NULL DEFAULT 0,
            written_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS bis_audit_log_written_at
            ON bis_audit_log (written_at DESC);

        CREATE INDEX IF NOT EXISTS bis_audit_log_subject_ref
            ON bis_audit_log (subject_ref);

        CREATE TABLE IF NOT EXISTS bis_subscriptions (
            id              TEXT        PRIMARY KEY,
            subscriber_url  TEXT        NOT NULL,
            event_types     JSONB       NOT NULL DEFAULT '[]',
            min_severity    TEXT        NOT NULL DEFAULT 'info',
            active          BOOLEAN     NOT NULL DEFAULT TRUE,
            delivery_count  BIGINT      NOT NULL DEFAULT 0,
            failure_count   BIGINT      NOT NULL DEFAULT 0,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    "#;

    if let Err(e) = client.batch_execute(ddl).await {
        error!("DB migrate DDL failed: {e}");
    } else {
        info!("bis_audit_log and bis_subscriptions tables ready");
    }
}

// ─── Audit log ────────────────────────────────────────────────────────────────

/// Persist an audit entry to PostgreSQL.
/// Errors are logged but not propagated — the in-memory log is always updated
/// regardless of DB availability.
pub async fn insert_audit_entry(pool: &Pool, entry: &AuditEntry) {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            error!("insert_audit_entry: pool error: {e}");
            return;
        }
    };

    let event_type_str = serde_json::to_string(&entry.event_type)
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();
    let severity_str = serde_json::to_string(&entry.severity)
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();

    if let Err(e) = client
        .execute(
            r#"INSERT INTO bis_audit_log
               (id, event_id, event_type, subject_ref, severity, source_service, summary, processing_ns, written_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (id) DO NOTHING"#,
            &[
                &entry.id,
                &entry.event_id,
                &event_type_str,
                &entry.subject_ref,
                &severity_str,
                &entry.source_service,
                &entry.summary,
                &(entry.processing_ns as i64),
                &entry.written_at,
            ],
        )
        .await
    {
        error!("insert_audit_entry: {e}");
    }
}

/// Fetch the most recent N audit entries from PostgreSQL.
pub async fn fetch_recent_audit(pool: &Pool, limit: i64) -> Vec<AuditEntry> {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            error!("fetch_recent_audit: pool error: {e}");
            return vec![];
        }
    };

    let rows = match client
        .query(
            r#"SELECT id, event_id, event_type, subject_ref, severity,
                      source_service, summary, processing_ns, written_at
               FROM bis_audit_log
               ORDER BY written_at DESC
               LIMIT $1"#,
            &[&limit],
        )
        .await
    {
        Ok(r) => r,
        Err(e) => {
            error!("fetch_recent_audit: {e}");
            return vec![];
        }
    };

    rows.iter()
        .filter_map(|row| {
            let event_type_str: String = row.get("event_type");
            let severity_str: String = row.get("severity");
            let event_type: EventType =
                serde_json::from_str(&format!("\"{}\"", event_type_str)).ok()?;
            let severity: Severity = serde_json::from_str(&format!("\"{}\"", severity_str)).ok()?;
            let written_at: DateTime<Utc> = row.get("written_at");
            let processing_ns: i64 = row.get("processing_ns");
            Some(AuditEntry {
                id: row.get("id"),
                event_id: row.get("event_id"),
                event_type,
                subject_ref: row.get("subject_ref"),
                severity,
                source_service: row.get("source_service"),
                summary: row.get("summary"),
                written_at,
                processing_ns: processing_ns as u64,
            })
        })
        .collect()
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

/// Persist a new subscription to PostgreSQL.
pub async fn insert_subscription(pool: &Pool, sub: &Subscription) {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            error!("insert_subscription: pool error: {e}");
            return;
        }
    };

    let event_types_json = match serde_json::to_value(&sub.event_types) {
        Ok(v) => v,
        Err(e) => {
            error!("insert_subscription: serialize event_types: {e}");
            return;
        }
    };
    let severity_str = serde_json::to_string(&sub.min_severity)
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();

    if let Err(e) = client
        .execute(
            r#"INSERT INTO bis_subscriptions
               (id, subscriber_url, event_types, min_severity, active, delivery_count, failure_count, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (id) DO UPDATE SET
                 subscriber_url = EXCLUDED.subscriber_url,
                 event_types    = EXCLUDED.event_types,
                 min_severity   = EXCLUDED.min_severity,
                 active         = EXCLUDED.active"#,
            &[
                &sub.id,
                &sub.subscriber_url,
                &event_types_json,
                &severity_str,
                &sub.active,
                &(sub.delivery_count as i64),
                &(sub.failure_count as i64),
                &sub.created_at,
            ],
        )
        .await
    {
        error!("insert_subscription: {e}");
    }
}

/// Mark a subscription as inactive in PostgreSQL.
pub async fn deactivate_subscription(pool: &Pool, id: &str) {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            error!("deactivate_subscription: pool error: {e}");
            return;
        }
    };

    if let Err(e) = client
        .execute(
            "UPDATE bis_subscriptions SET active = FALSE WHERE id = $1",
            &[&id],
        )
        .await
    {
        error!("deactivate_subscription: {e}");
    }
}

/// Load all active subscriptions from PostgreSQL on startup.
pub async fn load_subscriptions(pool: &Pool) -> Vec<Subscription> {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            error!("load_subscriptions: pool error: {e}");
            return vec![];
        }
    };

    let rows = match client
        .query(
            r#"SELECT id, subscriber_url, event_types, min_severity,
                      active, delivery_count, failure_count, created_at
               FROM bis_subscriptions
               WHERE active = TRUE
               ORDER BY created_at ASC"#,
            &[],
        )
        .await
    {
        Ok(r) => r,
        Err(e) => {
            error!("load_subscriptions: {e}");
            return vec![];
        }
    };

    rows.iter()
        .filter_map(|row| {
            let event_types_json: serde_json::Value = row.get("event_types");
            let event_types: Vec<EventType> = serde_json::from_value(event_types_json).ok()?;
            let severity_str: String = row.get("min_severity");
            let min_severity: Severity =
                serde_json::from_str(&format!("\"{}\"", severity_str)).ok()?;
            let created_at: DateTime<Utc> = row.get("created_at");
            let delivery_count: i64 = row.get("delivery_count");
            let failure_count: i64 = row.get("failure_count");
            Some(Subscription {
                id: row.get("id"),
                subscriber_url: row.get("subscriber_url"),
                event_types,
                min_severity,
                active: row.get("active"),
                created_at,
                delivery_count: delivery_count as u64,
                failure_count: failure_count as u64,
            })
        })
        .collect()
}

/// Increment delivery or failure counter for a subscription.
pub async fn update_subscription_counters(
    pool: &Pool,
    id: &str,
    delivery_delta: i64,
    failure_delta: i64,
) {
    let client = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            error!("update_subscription_counters: pool error: {e}");
            return;
        }
    };

    if let Err(e) = client
        .execute(
            r#"UPDATE bis_subscriptions
               SET delivery_count = delivery_count + $1,
                   failure_count  = failure_count  + $2
               WHERE id = $3"#,
            &[&delivery_delta, &failure_delta, &id],
        )
        .await
    {
        error!("update_subscription_counters: {e}");
    }
}
