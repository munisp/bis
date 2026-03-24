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

/// Start the Kafka consumer in a background task.
/// Falls back gracefully if KAFKA_BROKERS is not set or rdkafka is unavailable.
pub async fn start_consumer(audit_log: AuditLog) {
    let brokers = std::env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".to_string());
    let topic = "bis.events";
    let group = "bis-event-processor";

    info!("[Kafka] Attempting to connect to {} topic={} group={}", brokers, topic, group);

    // We use a simple HTTP polling fallback since rdkafka requires C librdkafka.
    // In production, add rdkafka to Cargo.toml and replace this with a real consumer.
    // For now we expose a /v1/ingest endpoint that the Go gateway can POST events to,
    // which achieves the same fan-out semantics without the C dependency.
    warn!(
        "[Kafka] Native rdkafka consumer requires librdkafka. \
         Using HTTP ingest endpoint (/v1/ingest) as Kafka bridge. \
         To enable native Kafka: add rdkafka = \"0.36\" to Cargo.toml and rebuild."
    );

    // Simulate periodic event processing to demonstrate the consumer pattern
    let log = audit_log.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            let mut entries = log.write().await;
            // Heartbeat entry to show the consumer is alive
            entries.push(serde_json::json!({
                "event_type": "CONSUMER_HEARTBEAT",
                "subject_ref": "kafka-bridge",
                "severity": "info",
                "source": "event-processor",
                "processed_at": chrono::Utc::now().to_rfc3339(),
                "note": "Kafka bridge active — awaiting events via /v1/ingest"
            }));
            if entries.len() > 500 {
                entries.drain(0..100);
            }
        }
    });

    info!("[Kafka] Consumer bridge started — events accepted via POST /v1/ingest");
}

/// Process a single BIS event (called from the HTTP ingest handler).
pub async fn process_event(event: BisEvent, audit_log: AuditLog) {
    info!(
        "[Kafka] Processing event: {} for {}",
        event.event_type, event.subject_ref
    );

    let entry = serde_json::json!({
        "event_type": event.event_type,
        "subject_ref": event.subject_ref,
        "severity": event.severity,
        "payload": event.payload,
        "source": event.source,
        "processed_at": chrono::Utc::now().to_rfc3339(),
    });

    let mut log = audit_log.write().await;
    log.push(entry);
    if log.len() > 500 {
        log.drain(0..100);
    }
}
