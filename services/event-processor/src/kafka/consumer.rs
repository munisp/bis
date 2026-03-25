use rdkafka::config::ClientConfig;
use rdkafka::consumer::{CommitMode, Consumer, StreamConsumer};
use rdkafka::message::Message;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
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

/// Start the native rdkafka Kafka consumer in a background task.
/// Falls back gracefully if KAFKA_BROKERS is not set or the broker is unreachable.
pub async fn start_consumer(audit_log: AuditLog, cancel: CancellationToken) {
    let brokers = std::env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".to_string());
    let topic = "bis.events";
    let group = "bis-event-processor";

    info!(
        "[Kafka] Connecting to {} topic={} group={}",
        brokers, topic, group
    );

    // Build the rdkafka StreamConsumer
    let consumer: StreamConsumer = match ClientConfig::new()
        .set("group.id", group)
        .set("bootstrap.servers", &brokers)
        .set("enable.auto.commit", "false")
        .set("auto.offset.reset", "earliest")
        .set("session.timeout.ms", "6000")
        .set("max.poll.interval.ms", "300000")
        .set("socket.timeout.ms", "5000")
        .set("socket.connection.setup.timeout.ms", "5000")
        .create()
    {
        Ok(c) => c,
        Err(e) => {
            warn!(
                "[Kafka] Failed to create consumer ({}). \
                 Falling back to HTTP ingest endpoint (/v1/ingest).",
                e
            );
            // Start heartbeat fallback so the audit log is still populated
            start_heartbeat_fallback(audit_log).await;
            return;
        }
    };

    // Subscribe to the topic
    if let Err(e) = consumer.subscribe(&[topic]) {
        warn!(
            "[Kafka] Failed to subscribe to {} ({}). Falling back to HTTP ingest.",
            topic, e
        );
        start_heartbeat_fallback(audit_log).await;
        return;
    }

    info!("[Kafka] Native StreamConsumer started on topic={}", topic);

    // Consume loop — runs until CancellationToken is triggered
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                info!("[Kafka] Consumer shutdown requested — stopping.");
                break;
            }
            msg_result = consumer.recv() => {
                match msg_result {
                    Err(e) => {
                        error!("[Kafka] Consumer error: {}", e);
                        // Brief back-off before retrying
                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    }
                    Ok(msg) => {
                        if let Some(payload) = msg.payload() {
                            match serde_json::from_slice::<BisEvent>(payload) {
                                Ok(event) => {
                                    process_event(event, audit_log.clone()).await;
                                }
                                Err(e) => {
                                    warn!(
                                        "[Kafka] Failed to deserialize event: {} — raw: {:?}",
                                        e,
                                        std::str::from_utf8(payload).unwrap_or("<binary>")
                                    );
                                }
                            }
                        }
                        // Commit offset after processing
                        if let Err(e) = consumer.commit_message(&msg, CommitMode::Async) {
                            warn!("[Kafka] Commit failed: {}", e);
                        }
                    }
                }
            }
        }
    }
}

/// Heartbeat fallback — used when rdkafka cannot connect to the broker.
/// The HTTP /v1/ingest endpoint remains the primary ingestion path in this mode.
async fn start_heartbeat_fallback(audit_log: AuditLog) {
    warn!(
        "[Kafka] Running in HTTP-bridge mode. \
         Events accepted via POST /v1/ingest. \
         Ensure KAFKA_BROKERS is set and the broker is reachable to enable native consumption."
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
                "note": "HTTP-bridge mode active — awaiting events via POST /v1/ingest"
            }));
            if entries.len() > 500 {
                entries.drain(0..100);
            }
        }
    });
}

/// Process a single BIS event — called from both the native consumer and the HTTP ingest handler.
pub async fn process_event(event: BisEvent, audit_log: AuditLog) {
    info!(
        "[Kafka] Processing event: type={} subject={} severity={}",
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

    let mut log = audit_log.write().await;
    log.push(entry);
    if log.len() > 500 {
        log.drain(0..100);
    }
}
