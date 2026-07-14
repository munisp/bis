/// BIS Risk Stream Processor — Main
///
/// Kafka consumer that reads from all BIS domain event topics,
/// enriches events via the ML Enrichment service, and publishes
/// enriched results back to Dapr pub/sub.
use axum::{routing::get, Json, Router};
use rdkafka::{
    consumer::{Consumer, StreamConsumer},
    ClientConfig, Message,
};
use reqwest::Client as HttpClient;
use risk_stream::{
    enriched_topic, extract_subject_ref, topic_to_domain,
    EnrichmentRequest, EnrichmentResponse, ProcessorError, RiskEvent,
};
use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};
use tracing::{error, info, warn};
use uuid::Uuid;

// ─── Prometheus counters ──────────────────────────────────────────────────────
static EVENTS_CONSUMED: AtomicU64 = AtomicU64::new(0);
static EVENTS_ENRICHED: AtomicU64 = AtomicU64::new(0);
static EVENTS_PUBLISHED: AtomicU64 = AtomicU64::new(0);
static EVENTS_FAILED: AtomicU64 = AtomicU64::new(0);

fn metrics_text() -> String {
    format!(
        "# HELP risk_stream_events_consumed_total Total events consumed from Kafka\n\
         # TYPE risk_stream_events_consumed_total counter\n\
         risk_stream_events_consumed_total {}\n\
         # HELP risk_stream_events_enriched_total Events successfully enriched by ML service\n\
         # TYPE risk_stream_events_enriched_total counter\n\
         risk_stream_events_enriched_total {}\n\
         # HELP risk_stream_events_published_total Enriched events published to Dapr\n\
         # TYPE risk_stream_events_published_total counter\n\
         risk_stream_events_published_total {}\n\
         # HELP risk_stream_events_failed_total Events that failed processing\n\
         # TYPE risk_stream_events_failed_total counter\n\
         risk_stream_events_failed_total {}\n",
        EVENTS_CONSUMED.load(Ordering::Relaxed),
        EVENTS_ENRICHED.load(Ordering::Relaxed),
        EVENTS_PUBLISHED.load(Ordering::Relaxed),
        EVENTS_FAILED.load(Ordering::Relaxed),
    )
}

// ─── App State ────────────────────────────────────────────────────────────────
#[derive(Clone)]
struct AppState {
    ml_url: Arc<String>,
    dapr_url: Arc<String>,
    dapr_pubsub: Arc<String>,
    http: HttpClient,
}

// ─── ML Enrichment ────────────────────────────────────────────────────────────
async fn enrich_event(
    state: &AppState,
    event: &RiskEvent,
) -> Result<EnrichmentResponse, ProcessorError> {
    let req = EnrichmentRequest {
        subject_ref: event.subject_ref.clone(),
        subject_name: event.subject_name.clone(),
        domain: format!("{:?}", event.domain).to_lowercase(),
        event_type: event.event_type.clone(),
        risk_score: event.risk_score,
        tenant_id: event.tenant_id,
        context: event.payload.clone(),
    };
    let resp = state.http
        .post(format!("{}/risk/score", state.ml_url))
        .json(&req)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| ProcessorError::EnrichmentError(e.to_string()))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(ProcessorError::EnrichmentError(format!("ML service {} — {}", status, body)));
    }
    resp.json::<EnrichmentResponse>().await
        .map_err(|e| ProcessorError::EnrichmentError(e.to_string()))
}

// ─── Dapr Publish ─────────────────────────────────────────────────────────────
async fn publish_to_dapr(
    state: &AppState,
    topic: &str,
    data: serde_json::Value,
) -> Result<(), ProcessorError> {
    let url = format!(
        "{}/v1.0/publish/{}/{}",
        state.dapr_url, state.dapr_pubsub, topic
    );
    let resp = state.http
        .post(&url)
        .json(&data)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| ProcessorError::DaprError(e.to_string()))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(ProcessorError::DaprError(format!("Dapr {} — {}", status, body)));
    }
    Ok(())
}

// ─── Event Processing ─────────────────────────────────────────────────────────
async fn process_message(
    state: &AppState,
    topic: &str,
    payload_bytes: &[u8],
) {
    let start = Instant::now();
    EVENTS_CONSUMED.fetch_add(1, Ordering::Relaxed);

    // Parse the raw JSON payload
    let raw: serde_json::Value = match serde_json::from_slice(payload_bytes) {
        Ok(v) => v,
        Err(e) => {
            warn!("[RiskStream] Failed to parse message from {}: {}", topic, e);
            EVENTS_FAILED.fetch_add(1, Ordering::Relaxed);
            return;
        }
    };

    // Determine domain from topic
    let domain = match topic_to_domain(topic) {
        Some(d) => d,
        None => {
            warn!("[RiskStream] Unknown topic: {}", topic);
            return;
        }
    };

    let subject_ref = extract_subject_ref(&domain, &raw);
    let event_type = raw.get("eventType")
        .or_else(|| raw.get("event_type"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let risk_score = raw.get("riskScore")
        .or_else(|| raw.get("risk_score"))
        .and_then(|v| v.as_f64());
    let tenant_id = raw.get("tenantId")
        .or_else(|| raw.get("tenant_id"))
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);

    let event = RiskEvent {
        event_id: Uuid::new_v4().to_string(),
        domain: domain.clone(),
        event_type: event_type.clone(),
        subject_ref: subject_ref.clone(),
        subject_name: raw.get("subjectName").or_else(|| raw.get("subject_name")).and_then(|v| v.as_str()).map(String::from),
        risk_score,
        risk_tier: raw.get("riskTier").or_else(|| raw.get("risk_tier")).and_then(|v| v.as_str()).map(String::from),
        tenant_id,
        payload: raw.clone(),
        published_at: chrono::Utc::now().to_rfc3339(),
        source_topic: topic.to_string(),
    };

    // Enrich via ML service
    let enrichment = match enrich_event(state, &event).await {
        Ok(e) => {
            EVENTS_ENRICHED.fetch_add(1, Ordering::Relaxed);
            Some(e)
        }
        Err(e) => {
            warn!("[RiskStream] ML enrichment failed for {}: {}", subject_ref, e);
            None
        }
    };

    // Build enriched event payload
    let mut enriched_payload = raw.clone();
    if let Some(ref enr) = enrichment {
        enriched_payload["compositeRiskScore"] = serde_json::json!(enr.composite_risk_score);
        enriched_payload["riskTier"] = serde_json::json!(enr.risk_tier);
        enriched_payload["mlFlags"] = serde_json::json!(enr.flags);
        enriched_payload["adverseMediaHits"] = serde_json::json!(enr.adverse_media_hits);
        enriched_payload["pepMatch"] = serde_json::json!(enr.pep_match);
        enriched_payload["sanctionsMatch"] = serde_json::json!(enr.sanctions_match);
        enriched_payload["modelVersion"] = serde_json::json!(enr.model_version);
        enriched_payload["enrichedAt"] = serde_json::json!(enr.enriched_at);
    }
    enriched_payload["processingMs"] = serde_json::json!(start.elapsed().as_millis());
    enriched_payload["streamProcessorVersion"] = serde_json::json!("1.0.0");

    // Publish enriched event to Dapr
    let out_topic = enriched_topic(&domain);
    match publish_to_dapr(state, out_topic, enriched_payload).await {
        Ok(_) => {
            EVENTS_PUBLISHED.fetch_add(1, Ordering::Relaxed);
            info!("[RiskStream] {} → {} enriched in {}ms", subject_ref, out_topic, start.elapsed().as_millis());
        }
        Err(e) => {
            warn!("[RiskStream] Dapr publish failed for {}: {}", subject_ref, e);
            EVENTS_FAILED.fetch_add(1, Ordering::Relaxed);
        }
    }
}

// ─── Kafka Consumer ───────────────────────────────────────────────────────────
async fn run_consumer(state: AppState, brokers: String, group_id: String) {
    let topics = vec![
        "bis.aml.alerts", "bis.aml.events", "bis.transaction.events",
        "bis.kyc.events", "bis.investigation.events", "bis.case.events",
        "bis.screening.events", "bis.criminal_records.events",
        "bis.sar.events", "bis.goaml.events", "bis.risk_profile.events",
        "bis.insider.events", "bis.biometric.events", "bis.field_visit.events",
        "bis.lex.events", "bis.payment.events", "bis.stablecoin.events",
        "bis.mojaloop.events",
    ];

    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", &group_id)
        .set("auto.offset.reset", "latest")
        .set("enable.auto.commit", "true")
        .set("auto.commit.interval.ms", "5000")
        .set("session.timeout.ms", "30000")
        .create()
        .expect("Failed to create Kafka consumer");

    let topic_refs: Vec<&str> = topics.iter().map(|s| *s).collect();
    consumer.subscribe(&topic_refs).expect("Failed to subscribe to topics");
    info!("[RiskStream] Subscribed to {} topics on {}", topics.len(), brokers);

    loop {
        match consumer.recv().await {
            Ok(msg) => {
                let topic = msg.topic().to_string();
                if let Some(payload) = msg.payload() {
                    let payload_owned = payload.to_vec();
                    let state_clone = state.clone();
                    tokio::spawn(async move {
                        process_message(&state_clone, &topic, &payload_owned).await;
                    });
                }
            }
            Err(e) => {
                error!("[RiskStream] Kafka consumer error: {}", e);
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        }
    }
}

// ─── HTTP Server (health + metrics) ──────────────────────────────────────────
async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "bis-risk-stream-processor",
        "version": "1.0.0",
        "events_consumed": EVENTS_CONSUMED.load(Ordering::Relaxed),
        "events_enriched": EVENTS_ENRICHED.load(Ordering::Relaxed),
        "events_published": EVENTS_PUBLISHED.load(Ordering::Relaxed),
        "events_failed": EVENTS_FAILED.load(Ordering::Relaxed),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

async fn metrics_handler() -> String {
    metrics_text()
}

// ─── Main ─────────────────────────────────────────────────────────────────────
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()))
        .json()
        .init();

    let kafka_brokers = std::env::var("KAFKA_BROKERS")
        .unwrap_or_else(|_| "localhost:9092".to_string());
    let group_id = std::env::var("KAFKA_GROUP_ID")
        .unwrap_or_else(|_| "bis-risk-stream-processor".to_string());
    let ml_url = std::env::var("ML_ENRICHMENT_URL")
        .unwrap_or_else(|_| "http://localhost:8086".to_string());
    let dapr_port = std::env::var("DAPR_HTTP_PORT")
        .unwrap_or_else(|_| "3500".to_string());
    let dapr_url = format!("http://localhost:{}", dapr_port);
    let dapr_pubsub = std::env::var("DAPR_PUBSUB_NAME")
        .unwrap_or_else(|_| "bis-pubsub".to_string());
    let port: u16 = std::env::var("RISK_STREAM_PORT")
        .unwrap_or_else(|_| "8098".to_string())
        .parse()
        .expect("RISK_STREAM_PORT must be a valid port");

    let state = AppState {
        ml_url: Arc::new(ml_url.clone()),
        dapr_url: Arc::new(dapr_url),
        dapr_pubsub: Arc::new(dapr_pubsub),
        http: HttpClient::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("Failed to build HTTP client"),
    };

    info!("[RiskStream] ML Enrichment URL: {}", ml_url);
    info!("[RiskStream] Kafka brokers: {}", kafka_brokers);

    // Spawn Kafka consumer
    let consumer_state = state.clone();
    tokio::spawn(async move {
        run_consumer(consumer_state, kafka_brokers, group_id).await;
    });

    // Start HTTP server
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("[RiskStream] HTTP server on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.expect("Failed to bind");
    axum::serve(listener, app).await.expect("HTTP server failed");
}
