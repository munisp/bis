// BIS Event Processor — Rust / Tokio + Axum
// High-throughput event streaming processor with native rdkafka consumer.
// Port: 8083

pub mod kafka;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::{
    env,
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::sync::{broadcast, RwLock};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use uuid::Uuid;

const AUDIT_LOG_CAPACITY: usize = 10_000;
const BROADCAST_CAPACITY: usize = 256;

fn gateway_key() -> String {
    env::var("BIS_GATEWAY_KEY").unwrap_or_else(|_| "dev-gateway-key-change-in-prod".to_string())
}

fn port() -> String {
    env::var("EVENT_PROCESSOR_PORT").unwrap_or_else(|_| "8083".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventType {
    InvestigationCreated,
    InvestigationFlagged,
    InvestigationCompleted,
    KycCompleted,
    KycFailed,
    AlertTriggered,
    AlertAcknowledged,
    SanctionsHit,
    PepDetected,
    FieldTaskDispatched,
    FieldTaskCompleted,
    ReportGenerated,
    UserLogin,
    ApiKeyRotated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, PartialOrd)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BisEvent {
    pub id: String,
    pub event_type: EventType,
    pub subject_id: String,
    pub subject_ref: String,
    pub severity: Severity,
    pub payload: serde_json::Value,
    pub source_service: String,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub event_id: String,
    pub event_type: EventType,
    pub subject_ref: String,
    pub severity: Severity,
    pub source_service: String,
    pub summary: String,
    pub written_at: DateTime<Utc>,
    pub processing_ns: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub id: String,
    pub subscriber_url: String,
    pub event_types: Vec<EventType>,
    pub min_severity: Severity,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub delivery_count: u64,
    pub failure_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PublishRequest {
    pub event_type: EventType,
    pub subject_id: String,
    pub subject_ref: String,
    pub severity: Severity,
    pub payload: serde_json::Value,
    pub source_service: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubscribeRequest {
    pub subscriber_url: String,
    pub event_types: Vec<EventType>,
    pub min_severity: Severity,
}

/// Ingest request — used by the HTTP bridge endpoint (/v1/ingest)
/// and as a fallback when the Kafka broker is unreachable.
#[derive(Debug, Serialize, Deserialize)]
pub struct IngestRequest {
    pub event_type: String,
    pub subject_ref: String,
    pub severity: String,
    pub payload: serde_json::Value,
    pub source: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PublishResponse {
    pub event_id: String,
    pub audit_id: String,
    pub fanout_count: usize,
    pub processing_ns: u64,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub code: String,
    pub message: String,
}

#[derive(Clone)]
pub struct AppState {
    pub audit_log: Arc<Mutex<Vec<AuditEntry>>>,
    /// Shared Kafka consumer audit log (JSON entries from native consumer)
    pub kafka_log: kafka::consumer::AuditLog,
    pub subscriptions: Arc<DashMap<String, Subscription>>,
    pub event_tx: broadcast::Sender<BisEvent>,
    pub event_count: Arc<std::sync::atomic::AtomicU64>,
}

impl AppState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        Self {
            audit_log: Arc::new(Mutex::new(Vec::with_capacity(AUDIT_LOG_CAPACITY))),
            kafka_log: Arc::new(RwLock::new(Vec::new())),
            subscriptions: Arc::new(DashMap::new()),
            event_tx: tx,
            event_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }
}

async fn auth_middleware(headers: HeaderMap, request: axum::extract::Request, next: Next) -> Response {
    let key = headers.get("x-bis-key").and_then(|v| v.to_str().ok()).unwrap_or("");
    if key != gateway_key() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                code: "UNAUTHORIZED".to_string(),
                message: "Invalid or missing API key".to_string(),
            }),
        )
            .into_response();
    }
    next.run(request).await
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "bis-event-processor",
        "version": "2.0.0",
        "kafka": "native-rdkafka",
        "time": Utc::now().to_rfc3339()
    }))
}

async fn publish_event(
    State(state): State<AppState>,
    Json(req): Json<PublishRequest>,
) -> Json<PublishResponse> {
    let start = Instant::now();
    let event = BisEvent {
        id: Uuid::new_v4().to_string(),
        event_type: req.event_type.clone(),
        subject_id: req.subject_id.clone(),
        subject_ref: req.subject_ref.clone(),
        severity: req.severity.clone(),
        payload: req.payload.clone(),
        source_service: req.source_service.clone(),
        occurred_at: Utc::now(),
    };
    info!(event_id = %event.id, "Publishing event {:?}", event.event_type);
    let _ = state.event_tx.send(event.clone());
    let sub_count = state
        .subscriptions
        .iter()
        .filter(|s| {
            s.active
                && s.event_types.contains(&event.event_type)
                && s.min_severity <= event.severity
        })
        .count();
    let summary = format!(
        "{:?} for {} from {}",
        event.event_type, event.subject_ref, event.source_service
    );
    let audit_entry = AuditEntry {
        id: Uuid::new_v4().to_string(),
        event_id: event.id.clone(),
        event_type: event.event_type.clone(),
        subject_ref: event.subject_ref.clone(),
        severity: event.severity.clone(),
        source_service: event.source_service.clone(),
        summary,
        written_at: Utc::now(),
        processing_ns: start.elapsed().as_nanos() as u64,
    };
    let audit_id = audit_entry.id.clone();
    {
        let mut log = state.audit_log.lock().unwrap();
        if log.len() >= AUDIT_LOG_CAPACITY {
            log.drain(0..100);
            warn!("Audit log evicted 100 entries");
        }
        log.push(audit_entry);
    }
    state
        .event_count
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    Json(PublishResponse {
        event_id: event.id,
        audit_id,
        fanout_count: sub_count,
        processing_ns: start.elapsed().as_nanos() as u64,
    })
}

/// HTTP ingest endpoint — secondary path used when the Kafka broker is unreachable
/// or when callers prefer direct HTTP over Kafka.
async fn ingest_event(
    State(state): State<AppState>,
    Json(req): Json<IngestRequest>,
) -> Json<serde_json::Value> {
    let entry = serde_json::json!({
        "event_type": req.event_type,
        "subject_ref": req.subject_ref,
        "severity": req.severity,
        "payload": req.payload,
        "source": req.source,
        "processed_at": Utc::now().to_rfc3339(),
        "ingestion_path": "http"
    });
    let mut log = state.kafka_log.write().await;
    log.push(entry);
    if log.len() > 500 {
        log.drain(0..100);
    }
    state
        .event_count
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    Json(serde_json::json!({ "status": "accepted", "ingestion_path": "http" }))
}

async fn subscribe(
    State(state): State<AppState>,
    Json(req): Json<SubscribeRequest>,
) -> Json<Subscription> {
    let sub = Subscription {
        id: Uuid::new_v4().to_string(),
        subscriber_url: req.subscriber_url,
        event_types: req.event_types,
        min_severity: req.min_severity,
        active: true,
        created_at: Utc::now(),
        delivery_count: 0,
        failure_count: 0,
    };
    info!(sub_id = %sub.id, "New subscription registered");
    state.subscriptions.insert(sub.id.clone(), sub.clone());
    Json(sub)
}

async fn list_subscriptions(State(state): State<AppState>) -> Json<Vec<Subscription>> {
    Json(
        state
            .subscriptions
            .iter()
            .map(|e| e.value().clone())
            .collect(),
    )
}

async fn delete_subscription(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> StatusCode {
    if state.subscriptions.remove(&id).is_some() {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

async fn get_audit_log(State(state): State<AppState>) -> Json<serde_json::Value> {
    let http_log: Vec<AuditEntry> = {
        let log = state.audit_log.lock().unwrap();
        log.iter().rev().take(100).cloned().collect()
    };
    let kafka_log: Vec<serde_json::Value> = {
        let log = state.kafka_log.read().await;
        log.iter().rev().take(100).cloned().collect()
    };
    Json(serde_json::json!({
        "http_events": http_log,
        "kafka_events": kafka_log,
        "total_http": http_log.len(),
        "total_kafka": kafka_log.len()
    }))
}

async fn get_stats(State(state): State<AppState>) -> Json<serde_json::Value> {
    let kafka_entries = state.kafka_log.read().await.len();
    Json(serde_json::json!({
        "totalEventsProcessed": state.event_count.load(std::sync::atomic::Ordering::Relaxed),
        "auditLogEntries": state.audit_log.lock().unwrap().len(),
        "kafkaConsumerEntries": kafka_entries,
        "activeSubscriptions": state.subscriptions.len(),
        "kafkaMode": "native-rdkafka"
    }))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter("bis_event_processor=info,tower_http=info")
        .init();

    let state = AppState::new();

    // Start the native rdkafka consumer in a background task
    let kafka_log = state.kafka_log.clone();
    let cancel = CancellationToken::new();
    let cancel_clone = cancel.clone();
    tokio::spawn(async move {
        kafka::consumer::start_consumer(kafka_log, cancel_clone).await;
    });

    let protected = Router::new()
        .route("/v1/events", post(publish_event))
        .route("/v1/ingest", post(ingest_event))
        .route(
            "/v1/subscriptions",
            post(subscribe).get(list_subscriptions),
        )
        .route(
            "/v1/subscriptions/:id",
            axum::routing::delete(delete_subscription),
        )
        .route("/v1/audit", get(get_audit_log))
        .route("/v1/stats", get(get_stats))
        .layer(middleware::from_fn(auth_middleware));

    let app = Router::new()
        .route("/health", get(health))
        .merge(protected)
        .with_state(state)
        .layer(tower_http::cors::CorsLayer::permissive());

    let addr = format!("0.0.0.0:{}", port());
    info!("BIS Event Processor v2.0 (native rdkafka) starting on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();

    // Graceful shutdown on SIGTERM/SIGINT
    let shutdown = async move {
        tokio::signal::ctrl_c().await.ok();
        info!("Shutdown signal received — cancelling Kafka consumer...");
        cancel.cancel();
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .unwrap();
}
