/*!
 * kafka/consumer.rs — BIS Event Processor Kafka consumer
 *
 * Two modes of operation:
 *
 * 1. **Native rdkafka** (feature = "kafka-native"):
 *    Uses the rdkafka crate (backed by librdkafka) for a real Kafka consumer.
 *    Requires `librdkafka-dev` and `cmake` in the Docker build image.
 *    Enable with: `cargo build --features kafka-native`
 *
 * 2. **HTTP ingest bridge** (default, no C dependency):
 *    The Go gateway POSTs events to `/v1/ingest`.
 *    Achieves the same fan-out semantics without the C build dependency.
 *    This is the default mode for development and CI.
 *
 * Topics consumed:
 *   bis.events              — General BIS event bus
 *   bis.payment.events      — Payment rail events
 *   bis.aml.alerts          — AML alert events
 *   bis.ml.ueba-alerts      — UEBA anomaly alerts
 *   bis.velocity.breaches   — Velocity check breaches
 */

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

/// BIS event envelope matching the Go producer schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BisEvent {
    pub event_type: String,
    pub subject_ref: String,
    pub severity: String,
    pub payload: serde_json::Value,
    pub source: Option<String>,
    pub published_at: Option<String>,
}

/// Shared audit log that the consumer appends to.
pub type AuditLog = Arc<RwLock<Vec<serde_json::Value>>>;

// ─── Kafka topics ─────────────────────────────────────────────────────────────────────────────────

const TOPICS: &[&str] = &[
    "bis.events",
    "bis.payment.events",
    "bis.aml.alerts",
    "bis.ml.ueba-alerts",
    "bis.velocity.breaches",
];

const CONSUMER_GROUP: &str = "bis-event-processor";

// ─── Native rdkafka consumer (feature-gated) ──────────────────────────────────────────────────

#[cfg(feature = "kafka-native")]
pub async fn start_consumer(audit_log: AuditLog) {
    use rdkafka::config::ClientConfig;
    use rdkafka::consumer::{Consumer, StreamConsumer};
    use rdkafka::message::Message;

    let brokers = std::env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".to_string());
    let security = std::env::var("KAFKA_SECURITY_PROTOCOL").unwrap_or_else(|_| "PLAINTEXT".to_string());

    info!("[Kafka] Native rdkafka consumer starting — brokers={} topics={:?}", brokers, TOPICS);

    let mut config = ClientConfig::new();
    config
        .set("bootstrap.servers", &brokers)
        .set("group.id", CONSUMER_GROUP)
        .set("enable.auto.commit", "true")
        .set("auto.commit.interval.ms", "5000")
        .set("auto.offset.reset", "latest")
        .set("session.timeout.ms", "30000")
        .set("heartbeat.interval.ms", "10000")
        .set("security.protocol", &security);

    if let Ok(mechanism) = std::env::var("KAFKA_SASL_MECHANISM") {
        config.set("sasl.mechanism", &mechanism);
    }
    if let Ok(username) = std::env::var("KAFKA_SASL_USERNAME") {
        config.set("sasl.username", &username);
    }
    if let Ok(password) = std::env::var("KAFKA_SASL_PASSWORD") {
        config.set("sasl.password", &password);
    }

    let consumer: StreamConsumer = match config.create() {
        Ok(c) => c,
        Err(e) => {
            error!("[Kafka] Failed to create consumer: {}", e);
            return;
        }
    };

    let topic_list: Vec<&str> = TOPICS.to_vec();
    if let Err(e) = consumer.subscribe(&topic_list) {
        error!("[Kafka] Failed to subscribe to topics: {}", e);
        return;
    }

    info!("[Kafka] Native consumer subscribed to {:?}", TOPICS);

    let log = audit_log.clone();
    tokio::spawn(async move {
        use futures::StreamExt;
        let mut stream = consumer.stream();
        loop {
            match stream.next().await {
                Some(Ok(msg)) => {
                    let payload = msg.payload().unwrap_or_default();
                    match serde_json::from_slice::<BisEvent>(payload) {
                        Ok(event) => {
                            process_event(event, log.clone()).await;
                        }
                        Err(e) => {
                            warn!("[Kafka] Failed to deserialize event: {} — raw: {:?}", e,
                                  String::from_utf8_lossy(payload));
                        }
                    }
                }
                Some(Err(e)) => {
                    error!("[Kafka] Consumer error: {}", e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                }
                None => {
                    warn!("[Kafka] Consumer stream ended — reconnecting in 5s");
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                }
            }
        }
    });
}

// ─── HTTP ingest bridge (default — no C dependency) ────────────────────────────────────────

#[cfg(not(feature = "kafka-native"))]
pub async fn start_consumer(audit_log: AuditLog) {
    let brokers = std::env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".to_string());

    warn!(
        "[Kafka] Running in HTTP-bridge mode (kafka-native feature not enabled). \
         Events are accepted via POST /v1/ingest. \
         To enable native Kafka: cargo build --features kafka-native \
         (requires librdkafka-dev + cmake in Docker). \
         Configured brokers: {}",
        brokers
    );

    let log = audit_log.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            let mut entries = log.write().await;
            entries.push(serde_json::json!({
                "event_type": "CONSUMER_HEARTBEAT",
                "subject_ref": "kafka-bridge",
                "severity": "info",
                "source": "event-processor",
                "processed_at": chrono::Utc::now().to_rfc3339(),
                "note": "HTTP bridge active — events accepted via POST /v1/ingest"
            }));
            if entries.len() > 500 {
                entries.drain(0..100);
            }
        }
    });

    info!("[Kafka] HTTP bridge consumer started — POST events to /v1/ingest");
}

// ─── Event processing (shared between both modes) ─────────────────────────────────────────────

/// Process a single BIS event: persist to audit log, publish to Redis pub/sub,
/// and fan-out high-severity events to the BFF webhook.
pub async fn process_event(event: BisEvent, audit_log: AuditLog) {
    info!(
        "[EventProcessor] Processing: type={} subject={} severity={}",
        event.event_type, event.subject_ref, event.severity
    );

    let entry = serde_json::json!({
        "event_type": event.event_type,
        "subject_ref": event.subject_ref,
        "severity": event.severity,
        "payload": event.payload,
        "source": event.source,
        "processed_at": chrono::Utc::now().to_rfc3339(),
    });

    // Persist to in-memory audit log
    {
        let mut log = audit_log.write().await;
        log.push(entry.clone());
        if log.len() > 500 {
            log.drain(0..100);
        }
    }

    // Dispatch to domain-specific handler (criminal, corporate, field visit, thin-file, mojaloop)
    super::handlers::dispatch_domain_event(&event, audit_log.clone()).await;

    // Fan-out: forward high-severity events to BFF webhook
    let severity = event.severity.clone();
    if matches!(severity.as_str(), "high" | "critical") {
        let entry_clone = entry.clone();
        tokio::spawn(async move {
            forward_to_bff(entry_clone).await;
        });
    }
}

// ─── BFF webhook fan-out ───────────────────────────────────────────────────────────────────────────────

async fn forward_to_bff(entry: serde_json::Value) {
    let bff_url = std::env::var("BFF_WEBHOOK_URL")
        .unwrap_or_else(|_| "http://localhost:8080/api/internal/events".to_string());
    let gateway_key = std::env::var("BIS_GATEWAY_KEY")
        .unwrap_or_else(|_| "dev-gateway-key-change-in-prod".to_string());

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build() {
        Ok(c) => c,
        Err(e) => {
            warn!("[BFF] Failed to build HTTP client: {}", e);
            return;
        }
    };

    match client
        .post(&bff_url)
        .header("X-BIS-Key", &gateway_key)
        .header("Content-Type", "application/json")
        .json(&entry)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            tracing::debug!("[BFF] Event forwarded successfully");
        }
        Ok(resp) => {
            warn!("[BFF] Webhook returned HTTP {}", resp.status());
        }
        Err(e) => {
            warn!("[BFF] Webhook forward failed: {}", e);
        }
    }
}
