// BIS Event Processor — Rust / Tokio + Axum
// High-throughput event streaming processor.
// Port: 8083

pub mod db;
pub mod insider_threat;
pub mod kafka;
pub mod otel;
pub mod traceparent;
#[cfg(test)]
mod tests;

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
use insider_threat::InsiderThreatDetector;
use serde::{Deserialize, Serialize};
use std::{
    env,
    sync::{Arc, Mutex},
    time::Instant,
};
#[allow(unused_imports)]
use otel::{init_otel, OtlpAnyValue, SpanBuilder, SpanSender};
use std::sync::OnceLock;
use tokio::sync::broadcast;
use tracing::{info, warn};
use uuid::Uuid;

// Global OTel span sender — initialised in main(), available anywhere in the process.
static OTEL_TX: OnceLock<SpanSender> = OnceLock::new();

/// Get the global OTel span sender (returns None if OTel is disabled).
pub fn otel_tx() -> Option<&'static SpanSender> {
    OTEL_TX.get()
}

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
    BiometricLivenessChecked,
    BiometricActiveLivenessChecked,
    BiometricFaceMatched,
    BiometricAntiSpoofingChecked,
    BiometricFullVerification,
    BiometricEnrolled,
    BiometricRevoked,
    // ── Insider-threat event types ────────────────────────────────────────────
    InsiderThreatAlert,
    PrivilegedAccessUsed,
    DataExfiltrationSuspected,
    AnomalousHourAccess,
    PrivilegeEscalation,
    AccessReviewRequired,
    AccessReviewCompleted,
    DeadManSwitchTriggered,
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
    pub subscriptions: Arc<DashMap<String, Subscription>>,
    pub event_tx: broadcast::Sender<BisEvent>,
    pub event_count: Arc<std::sync::atomic::AtomicU64>,
    /// Insider-threat behaviour detector (shared across all request handlers)
    pub insider_detector: Arc<InsiderThreatDetector>,
    /// Optional PostgreSQL connection pool — None in dev/test mode
    pub db_pool: Option<Arc<deadpool_postgres::Pool>>,
}

impl AppState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        Self {
            audit_log: Arc::new(Mutex::new(Vec::with_capacity(AUDIT_LOG_CAPACITY))),
            subscriptions: Arc::new(DashMap::new()),
            event_tx: tx,
            event_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            insider_detector: Arc::new(InsiderThreatDetector::with_default_config()),
            db_pool: None,
        }
    }

    pub fn with_pool(mut self, pool: deadpool_postgres::Pool) -> Self {
        self.db_pool = Some(Arc::new(pool));
        self
    }
}

async fn auth_middleware(
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let key = headers
        .get("x-bis-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
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
        "version": "1.0.0",
        "time": Utc::now().to_rfc3339()
    }))
}

async fn publish_event(
    State(state): State<AppState>,
    headers: HeaderMap,
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

    // ── W3C Trace Context extraction ────────────────────────────────────────
    // Extract traceparent / tracestate from the incoming HTTP headers so that
    // this span is linked to the upstream trace (Go gateway or Kafka producer).
    let http_headers: Vec<(String, String)> = headers
        .iter()
        .filter_map(|(k, v)| {
            v.to_str().ok().map(|val| (k.as_str().to_string(), val.to_string()))
        })
        .collect();
    let trace_ctx = traceparent::TraceContext::from_http_headers(&http_headers);

    // ── OTel span for this publish (linked to upstream trace) ───────────────
    let span_builder = trace_ctx
        .child_span("event.publish")
        .server()
        .attr_str("event.type",    format!("{:?}", req.event_type))
        .attr_str("event.subject", req.subject_ref.clone())
        .attr_str("event.source",  req.source_service.clone())
        .attr_str("event.severity",format!("{:?}", req.severity))
        .attr_str("trace.upstream", if trace_ctx.is_remote { "true" } else { "false" });

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

    // ── Feed event into insider-threat detector ───────────────────────────────
    let is_priv_change = matches!(
        event.event_type,
        EventType::PrivilegeEscalation | EventType::ApiKeyRotated | EventType::PrivilegedAccessUsed
    );
    let payload_bytes = event.payload.to_string().len() as u64;
    let ev_descriptor = insider_threat::EventDescriptor {
        id: event.id.clone(),
        subject_id: event.subject_id.clone(),
        subject_ref: event.subject_ref.clone(),
        payload_bytes,
        occurred_at: event.occurred_at,
        is_privilege_change: is_priv_change,
    };
    let insider_alerts = state.insider_detector.process(&ev_descriptor);
    if !insider_alerts.is_empty() {
        warn!(
            count = insider_alerts.len(),
            subject = %event.subject_ref,
            "insider_threat: {} alert(s) triggered for event {}",
            insider_alerts.len(),
            event.id
        );
    }

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
        log.push(audit_entry.clone());
    }
    // Persist to PostgreSQL (fire-and-forget — does not block the response)
    if let Some(pool) = state.db_pool.clone() {
        let entry_clone = audit_entry.clone();
        tokio::spawn(async move {
            db::insert_audit_entry(&pool, &entry_clone).await;
        });
    }
    state
        .event_count
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    let elapsed_ns = start.elapsed().as_nanos() as u64;

    // Finish OTel span
    if let Some(tx) = otel_tx() {
        span_builder
            .attr_int("event.fanout_count", sub_count as i64)
            .attr_int("event.processing_ns", elapsed_ns as i64)
            .attr_str("event.id", event.id.clone())
            .finish(tx, true, "");
    }

    Json(PublishResponse {
        event_id: event.id,
        audit_id,
        fanout_count: sub_count,
        processing_ns: elapsed_ns,
    })
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
    // Persist to PostgreSQL
    if let Some(pool) = state.db_pool.clone() {
        let sub_clone = sub.clone();
        tokio::spawn(async move {
            db::insert_subscription(&pool, &sub_clone).await;
        });
    }
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
        // Mark inactive in PostgreSQL
        if let Some(pool) = state.db_pool.clone() {
            let id_clone = id.clone();
            tokio::spawn(async move {
                db::deactivate_subscription(&pool, &id_clone).await;
            });
        }
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

async fn get_audit_log(State(state): State<AppState>) -> Json<Vec<AuditEntry>> {
    // Prefer DB if available (returns up to 200 most recent entries)
    if let Some(pool) = &state.db_pool {
        let entries = db::fetch_recent_audit(pool, 200).await;
        if !entries.is_empty() {
            return Json(entries);
        }
    }
    // Fallback to in-memory log
    let log = state.audit_log.lock().unwrap();
    Json(log.iter().rev().take(200).cloned().collect())
}

async fn get_stats(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "totalEventsProcessed": state.event_count.load(std::sync::atomic::Ordering::Relaxed),
        "auditLogEntries": state.audit_log.lock().unwrap().len(),
        "activeSubscriptions": state.subscriptions.len(),
        "insiderThreatAlerts": state.insider_detector.recent_alerts(1).len(),
    }))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter("bis_event_processor=info,tower_http=info")
        .init();

    // ── OpenTelemetry OTLP span exporter ─────────────────────────────────────────
    // Set OTEL_EXPORTER_OTLP_ENDPOINT to enable (e.g. http://jaeger:4318 or
    // http://grafana-tempo:4318).  When unset, spans are silently discarded.
    let (otel_sender, _otel_handle) = init_otel();
    OTEL_TX.set(otel_sender).ok();

    // ── PostgreSQL pool (optional) ───────────────────────────────────────────────────────────────────
    let db_pool = db::build_pool().await;
    if let Some(pool) = &db_pool {
        db::migrate(pool).await;
    }

    let mut state = AppState::new();
    if let Some(pool) = db_pool {
        // Load persisted subscriptions so they survive service restarts
        let subs = db::load_subscriptions(&pool).await;
        for sub in subs {
            info!(sub_id = %sub.id, "Restored subscription from DB");
            state.subscriptions.insert(sub.id.clone(), sub);
        }
        state = state.with_pool(pool);
    }

    // ── Insider-threat routes (share the detector from AppState) ─────────────────────────────
    let insider_router = Router::new()
        .route(
            "/v1/insider/process",
            post(insider_threat::handle_process_event),
        )
        .route(
            "/v1/insider/alerts",
            get(insider_threat::handle_recent_alerts),
        )
        .route(
            "/v1/insider/profile/:subject_id",
            get(insider_threat::handle_user_profile),
        )
        // Kafka bridge: receives bis.insider.events messages forwarded by the Go gateway
        .route(
            "/v1/insider/kafka-ingest",
            post(insider_threat::handle_kafka_ingest),
        )
        .with_state(state.insider_detector.clone())
        .layer(middleware::from_fn(auth_middleware));

    let protected = Router::new()
        .route("/v1/events", post(publish_event))
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
        .merge(insider_router)
        .with_state(state)
        .layer(tower_http::cors::CorsLayer::permissive());

    let addr = format!("0.0.0.0:{}", port());
    info!("BIS Event Processor starting on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
