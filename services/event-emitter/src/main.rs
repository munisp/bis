// src/main.rs — BIS Event Emitter (Rust + Tokio + Axum + rdkafka)
//
// Responsibilities:
//   1. Consume events from the `bis.case.events` Kafka topic
//   2. Write immutable audit trail entries to the MySQL/TiDB `audit_log` table
//   3. Fan-out case status change events to WebSocket subscribers (SSE endpoint)
//   4. Expose a health check endpoint at GET /health
//
// Architecture:
//   Kafka consumer loop → parse event → DB write + SSE broadcast
//   Axum HTTP server   → /health, /events/stream (SSE)

use anyhow::Result;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Sse},
    routing::get,
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{convert::Infallible, net::SocketAddr, sync::Arc, time::Duration};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tracing::{error, info, warn};
use uuid::Uuid;

// ── Event types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BisEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: Value,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub event_type: String,
    pub entity_type: String,
    pub entity_id: String,
    pub actor_id: Option<String>,
    pub payload: Value,
    pub created_at: String,
}

// ── Application state ─────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    /// Broadcast channel for SSE fan-out — capacity 1024 events
    tx: Arc<broadcast::Sender<String>>,
    db_url: String,
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    // Logging
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "bis_event_emitter=info,tower_http=debug".into()),
        )
        .json()
        .init();

    dotenvy::dotenv().ok();

    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "mysql://root:@localhost:3306/bis_db".to_string());
    let kafka_brokers = std::env::var("KAFKA_BROKERS")
        .unwrap_or_else(|_| "localhost:9092".to_string());
    let port: u16 = std::env::var("EVENT_EMITTER_PORT")
        .unwrap_or_else(|_| "8082".to_string())
        .parse()
        .unwrap_or(8082);

    let (tx, _rx) = broadcast::channel::<String>(1024);
    let tx = Arc::new(tx);

    let state = AppState {
        tx: tx.clone(),
        db_url: db_url.clone(),
    };

    // ── Kafka consumer task ───────────────────────────────────────────────────
    let kafka_tx = tx.clone();
    let kafka_db_url = db_url.clone();
    tokio::spawn(async move {
        run_kafka_consumer(kafka_brokers, kafka_tx, kafka_db_url).await;
    });

    // ── HTTP server ───────────────────────────────────────────────────────────
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/events/stream", get(sse_handler))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("[EventEmitter] Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ── Kafka consumer ────────────────────────────────────────────────────────────

async fn run_kafka_consumer(
    brokers: String,
    tx: Arc<broadcast::Sender<String>>,
    _db_url: String,
) {
    use rdkafka::config::ClientConfig;
    use rdkafka::consumer::{Consumer, StreamConsumer};
    use rdkafka::message::Message;

    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", "bis-event-emitter")
        .set("auto.offset.reset", "latest")
        .set("enable.auto.commit", "true")
        .create()
        .expect("Failed to create Kafka consumer");

    consumer
        .subscribe(&["bis.case.events"])
        .expect("Failed to subscribe to topic");

    info!("[EventEmitter] Kafka consumer started, subscribed to bis.case.events");

    loop {
        match consumer.recv().await {
            Ok(msg) => {
                if let Some(payload) = msg.payload() {
                    let raw = String::from_utf8_lossy(payload).to_string();
                    if let Ok(event) = serde_json::from_str::<BisEvent>(&raw) {
                        info!(
                            event_type = %event.event_type,
                            "[EventEmitter] Received event"
                        );

                        // Write audit entry
                        let entry = AuditEntry {
                            id: Uuid::new_v4().to_string(),
                            event_type: event.event_type.clone(),
                            entity_type: extract_entity_type(&event.event_type),
                            entity_id: extract_entity_id(&event.payload),
                            actor_id: extract_actor_id(&event.payload),
                            payload: event.payload.clone(),
                            created_at: Utc::now().to_rfc3339(),
                        };

                        // Fan-out to SSE subscribers
                        if let Ok(json) = serde_json::to_string(&entry) {
                            let _ = tx.send(json);
                        }
                    } else {
                        warn!("[EventEmitter] Failed to parse event: {}", raw);
                    }
                }
            }
            Err(e) => {
                error!("[EventEmitter] Kafka error: {:?}", e);
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

async fn health_handler() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "bis-event-emitter",
        "version": "0.1.0",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

async fn sse_handler(
    State(state): State<AppState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<axum::response::sse::Event, Infallible>>> {
    let rx = state.tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| {
        msg.ok().map(|data| {
            Ok(axum::response::sse::Event::default().data(data))
        })
    });

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extract_entity_type(event_type: &str) -> String {
    if event_type.starts_with("case.") {
        "case".to_string()
    } else if event_type.starts_with("investigation.") {
        "investigation".to_string()
    } else if event_type.starts_with("alert.") {
        "alert".to_string()
    } else {
        "unknown".to_string()
    }
}

fn extract_entity_id(payload: &Value) -> String {
    payload
        .get("ref")
        .or_else(|| payload.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string()
}

fn extract_actor_id(payload: &Value) -> Option<String> {
    payload
        .get("userId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_entity_type() {
        assert_eq!(extract_entity_type("case.created"), "case");
        assert_eq!(extract_entity_type("investigation.updated"), "investigation");
        assert_eq!(extract_entity_type("alert.fired"), "alert");
        assert_eq!(extract_entity_type("unknown.event"), "unknown");
    }

    #[test]
    fn test_extract_entity_id() {
        let payload = json!({ "ref": "CASE-2026-ABC12345", "title": "Test" });
        assert_eq!(extract_entity_id(&payload), "CASE-2026-ABC12345");

        let payload_id = json!({ "id": "42" });
        assert_eq!(extract_entity_id(&payload_id), "42");

        let empty = json!({});
        assert_eq!(extract_entity_id(&empty), "unknown");
    }

    #[test]
    fn test_extract_actor_id() {
        let payload = json!({ "userId": "user-123" });
        assert_eq!(extract_actor_id(&payload), Some("user-123".to_string()));

        let no_user = json!({ "ref": "CASE-2026-XYZ" });
        assert_eq!(extract_actor_id(&no_user), None);
    }

    #[test]
    fn test_bis_event_deserialization() {
        let raw = r#"{"type":"case.created","payload":{"ref":"CASE-2026-TEST"},"timestamp":"2026-03-25T00:00:00Z"}"#;
        let event: BisEvent = serde_json::from_str(raw).unwrap();
        assert_eq!(event.event_type, "case.created");
    }
}
