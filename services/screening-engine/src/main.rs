/*!
 * BIS Nigerian Screening Engine (Rust)
 * ─────────────────────────────────────
 * Handles computationally-intensive screening tasks:
 *   - NIN trace & address history (NIMC)
 *   - Criminal record checks (EFCC, ICPC, court records)
 *   - CAC directorship lookup
 *   - WAEC/NECO education verification
 *   - NYSC discharge verification
 *   - Professional licence checks (COREN, NBA, MDCN, ICAN, CIBN, ICAN, ACCA)
 *   - Adverse media scan
 *   - PEP/sanctions/watchlist screening
 *   - Continuous monitoring subscriptions
 *
 * Architecture:
 *   HTTP POST /screen        → run a single screening check
 *   HTTP POST /batch         → run multiple checks concurrently
 *   HTTP GET  /health        → liveness probe
 *   HTTP GET  /metrics       → Prometheus metrics
 *   Kafka consumer           → bis.screening.requests topic
 *   Kafka producer           → bis.screening.results topic
 */

pub mod db;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use chrono::Utc;
use deadpool_postgres::Pool;
use rdkafka::{
    consumer::{Consumer, StreamConsumer},
    producer::{FutureProducer, FutureRecord},
    ClientConfig, Message,
};
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tracing::{error, info, warn};
use uuid::Uuid;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreeningType {
    NinTrace,
    CriminalEfcc,
    CriminalIcpc,
    CourtRecord,
    CacDirectorship,
    EducationWaec,
    EducationNeco,
    EducationUniversity,
    NyscDischarge,
    EmploymentVerification,
    ProfessionalLicenceCoren,
    ProfessionalLicenceNba,
    ProfessionalLicenceMdcn,
    ProfessionalLicenceIcan,
    ProfessionalLicenceCibn,
    AdverseMedia,
    PepSanctions,
    Watchlist,
    WorkPermit,
    ContinuousMonitor,
    AddressVerification,
    BvnVerification,
    CreditCheck,
    DrugTest,
    SexOffenderRegistry,
    TerrorismWatchlist,
    InterpolNotice,
    SocialMedia,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreeningRequest {
    pub request_id: String,
    pub order_ref: String,
    pub result_id: i64,
    pub candidate_id: i64,
    pub tenant_id: i64,
    pub screening_type: ScreeningType,
    pub subject: SubjectInfo,
    pub options: HashMap<String, serde_json::Value>,
    pub callback_url: Option<String>,
    pub created_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubjectInfo {
    pub full_name: String,
    pub nin: Option<String>,
    pub bvn: Option<String>,
    pub dob: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub state: Option<String>,
    pub cac_rc: Option<String>,
    pub waec_number: Option<String>,
    pub nysc_number: Option<String>,
    pub licence_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreeningOutcome {
    Clear,
    Consider,
    Adverse,
    Unverified,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreeningResult {
    pub request_id: String,
    pub order_ref: String,
    pub result_id: i64,
    pub screening_type: ScreeningType,
    pub outcome: ScreeningOutcome,
    pub summary: String,
    pub details: serde_json::Value,
    pub risk_score: f64,
    pub sources: Vec<String>,
    pub completed_at: chrono::DateTime<Utc>,
    pub error: Option<String>,
}

// ─── App State ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub redis: ConnectionManager,
    pub producer: FutureProducer,
    pub config: Arc<EngineConfig>,
    pub metrics: Arc<Metrics>,
    /// Optional PostgreSQL connection pool — None in dev/test mode
    pub db_pool: Option<Arc<Pool>>,
}

pub struct EngineConfig {
    pub nimc_url: String,
    pub nimc_key: String,
    pub nibss_url: String,
    pub nibss_key: String,
    pub efcc_url: String,
    pub efcc_key: String,
    pub icpc_url: String,
    pub icpc_key: String,
    pub cac_url: String,
    pub cac_key: String,
    pub waec_url: String,
    pub waec_key: String,
    pub aggregator_url: String,
    pub aggregator_key: String,
}

pub struct Metrics {
    pub screenings_total: prometheus::CounterVec,
    pub screening_duration: prometheus::HistogramVec,
    pub errors_total: prometheus::CounterVec,
}

impl Metrics {
    pub fn new() -> Self {
        let screenings_total = prometheus::register_counter_vec!(
            "bis_screening_total",
            "Total number of screenings processed",
            &["screening_type", "outcome"]
        )
        .unwrap();
        let screening_duration = prometheus::register_histogram_vec!(
            "bis_screening_duration_seconds",
            "Screening processing duration",
            &["screening_type"]
        )
        .unwrap();
        let errors_total = prometheus::register_counter_vec!(
            "bis_screening_errors_total",
            "Total screening errors",
            &["screening_type", "error_kind"]
        )
        .unwrap();
        Self {
            screenings_total,
            screening_duration,
            errors_total,
        }
    }
}

// ─── Service authentication ────────────────────────────────────────────────────

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        difference |= a ^ b;
    }
    difference == 0
}

async fn service_auth(headers: HeaderMap, request: axum::extract::Request, next: Next) -> Response {
    let expected = std::env::var("BIS_SCREENING_ENGINE_KEY").unwrap_or_default();
    let supplied = headers
        .get("x-bis-key")
        .and_then(|value| value.to_str().ok())
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
        })
        .unwrap_or("");
    if expected.is_empty() || !constant_time_eq(supplied.as_bytes(), expected.as_bytes()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    next.run(request).await
}

// ─── Screening Handlers ───────────────────────────────────────────────────────

/// Dispatch a screening request to the appropriate handler.
pub async fn run_screening(
    req: &ScreeningRequest,
    config: &EngineConfig,
    redis: &mut ConnectionManager,
) -> ScreeningResult {
    // Check Redis cache first (TTL 24h for stable checks)
    let cache_key = format!(
        "bis:screening:cache:{}:{}",
        serde_json::to_string(&req.screening_type).unwrap_or_default(),
        req.subject
            .nin
            .as_deref()
            .or(req.subject.bvn.as_deref())
            .unwrap_or("unknown")
    );

    if let Ok(cached) = redis::cmd("GET")
        .arg(&cache_key)
        .query_async::<Option<String>>(redis)
        .await
    {
        if let Some(json) = cached {
            if let Ok(mut result) = serde_json::from_str::<ScreeningResult>(&json) {
                result.request_id = req.request_id.clone();
                result.result_id = req.result_id;
                return result;
            }
        }
    }

    let result = match req.screening_type {
        ScreeningType::NinTrace => screen_nin_trace(req, config).await,
        ScreeningType::BvnVerification => screen_bvn(req, config).await,
        ScreeningType::CriminalEfcc => screen_efcc(req, config).await,
        ScreeningType::CriminalIcpc => screen_icpc(req, config).await,
        ScreeningType::CourtRecord
        | ScreeningType::EducationNeco
        | ScreeningType::EducationUniversity
        | ScreeningType::NyscDischarge
        | ScreeningType::EmploymentVerification
        | ScreeningType::ProfessionalLicenceCoren
        | ScreeningType::ProfessionalLicenceNba
        | ScreeningType::ProfessionalLicenceMdcn
        | ScreeningType::ProfessionalLicenceIcan
        | ScreeningType::ProfessionalLicenceCibn
        | ScreeningType::AdverseMedia
        | ScreeningType::PepSanctions
        | ScreeningType::Watchlist
        | ScreeningType::TerrorismWatchlist
        | ScreeningType::InterpolNotice
        | ScreeningType::SexOffenderRegistry
        | ScreeningType::AddressVerification
        | ScreeningType::WorkPermit
        | ScreeningType::CreditCheck
        | ScreeningType::DrugTest
        | ScreeningType::SocialMedia
        | ScreeningType::ContinuousMonitor => screen_aggregator(req, config).await,
        ScreeningType::CacDirectorship | ScreeningType::EducationWaec => {
            screen_aggregator(req, config).await
        }
    };

    // Cache stable results for 24h
    if matches!(
        result.outcome,
        ScreeningOutcome::Clear | ScreeningOutcome::Consider | ScreeningOutcome::Adverse
    ) {
        if let Ok(json) = serde_json::to_string(&result) {
            let _: Result<(), _> = redis::cmd("SETEX")
                .arg(&cache_key)
                .arg(86400u64)
                .arg(&json)
                .query_async(redis)
                .await;
        }
    }

    result
}

// ─── Individual Screening Implementations ────────────────────────────────────

async fn screen_nin_trace(req: &ScreeningRequest, config: &EngineConfig) -> ScreeningResult {
    // Real NIMC API call
    let client = reqwest::Client::new();
    let nin = req.subject.nin.as_deref().unwrap_or("");
    match client
        .post(format!("{}/v1/nin/verify", config.nimc_url))
        .header("Authorization", format!("Bearer {}", config.nimc_key))
        .json(&serde_json::json!({ "nin": nin, "name": req.subject.full_name }))
        .timeout(Duration::from_secs(30))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            let matched = data["data"]["matchScore"].as_f64().unwrap_or(0.0);
            let outcome = if matched >= 0.8 {
                ScreeningOutcome::Clear
            } else {
                ScreeningOutcome::Consider
            };
            make_result(
                req,
                outcome,
                &format!("NIN match score: {:.0}%", matched * 100.0),
                data,
                1.0 - matched,
                vec!["NIMC".into()],
            )
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            make_result(
                req,
                ScreeningOutcome::Unverified,
                &format!("NIMC API returned {status}"),
                serde_json::Value::Null,
                0.5,
                vec!["NIMC".into()],
            )
        }
        Err(e) => error_result(req, &e.to_string()),
    }
}

async fn screen_bvn(req: &ScreeningRequest, config: &EngineConfig) -> ScreeningResult {
    let client = reqwest::Client::new();
    let bvn = req.subject.bvn.as_deref().unwrap_or("");
    match client
        .post(format!("{}/v2/bvn/verify", config.nibss_url))
        .header("Authorization", format!("Bearer {}", config.nibss_key))
        .json(&serde_json::json!({ "bvn": bvn }))
        .timeout(Duration::from_secs(30))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            let verified = data["data"]["verified"].as_bool().unwrap_or(false);
            let outcome = if verified {
                ScreeningOutcome::Clear
            } else {
                ScreeningOutcome::Consider
            };
            make_result(
                req,
                outcome,
                if verified {
                    "BVN verified"
                } else {
                    "BVN mismatch"
                },
                data,
                if verified { 0.02 } else { 0.6 },
                vec!["NIBSS".into()],
            )
        }
        Ok(resp) => make_result(
            req,
            ScreeningOutcome::Unverified,
            &format!("NIBSS returned {}", resp.status()),
            serde_json::Value::Null,
            0.5,
            vec!["NIBSS".into()],
        ),
        Err(e) => error_result(req, &e.to_string()),
    }
}

async fn screen_efcc(req: &ScreeningRequest, config: &EngineConfig) -> ScreeningResult {
    let client = reqwest::Client::new();
    match client
        .post(format!("{}/v1/search", config.efcc_url))
        .header("x-api-key", &config.efcc_key)
        .json(&serde_json::json!({ "name": req.subject.full_name, "nin": req.subject.nin }))
        .timeout(Duration::from_secs(45))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            let hits = data["data"]["totalHits"].as_i64().unwrap_or(0);
            let outcome = if hits == 0 {
                ScreeningOutcome::Clear
            } else {
                ScreeningOutcome::Adverse
            };
            make_result(
                req,
                outcome,
                &format!("EFCC records: {hits}"),
                data,
                if hits == 0 { 0.01 } else { 0.95 },
                vec!["EFCC".into()],
            )
        }
        Ok(resp) => make_result(
            req,
            ScreeningOutcome::Unverified,
            &format!("EFCC API returned {}", resp.status()),
            serde_json::Value::Null,
            0.5,
            vec!["EFCC".into()],
        ),
        Err(e) => error_result(req, &e.to_string()),
    }
}

async fn screen_icpc(req: &ScreeningRequest, config: &EngineConfig) -> ScreeningResult {
    let client = reqwest::Client::new();
    match client
        .post(format!("{}/v1/search", config.icpc_url))
        .header("x-api-key", &config.icpc_key)
        .json(&serde_json::json!({ "name": req.subject.full_name }))
        .timeout(Duration::from_secs(45))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            let hits = data["data"]["totalHits"].as_i64().unwrap_or(0);
            let outcome = if hits == 0 {
                ScreeningOutcome::Clear
            } else {
                ScreeningOutcome::Adverse
            };
            make_result(
                req,
                outcome,
                &format!("ICPC records: {hits}"),
                data,
                if hits == 0 { 0.01 } else { 0.95 },
                vec!["ICPC".into()],
            )
        }
        Ok(resp) => make_result(
            req,
            ScreeningOutcome::Unverified,
            &format!("ICPC API returned {}", resp.status()),
            serde_json::Value::Null,
            0.5,
            vec!["ICPC".into()],
        ),
        Err(e) => error_result(req, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct AggregatorScreeningResponse {
    outcome: ScreeningOutcome,
    summary: String,
    #[serde(default)]
    details: serde_json::Value,
    risk_score: f64,
    source: String,
}

// screen_aggregator delegates specialist checks to the configured accredited
// screening provider using the platform's normalized request and response contract.
async fn screen_aggregator(req: &ScreeningRequest, config: &EngineConfig) -> ScreeningResult {
    if config.aggregator_url.trim().is_empty() || config.aggregator_key.trim().is_empty() {
        return error_result(req, "screening aggregator credentials are not configured");
    }
    let screening_type = serde_json::to_value(&req.screening_type)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".to_owned());
    let endpoint = format!(
        "{}/v1/screenings/{}",
        config.aggregator_url.trim_end_matches('/'),
        screening_type
    );
    let response = reqwest::Client::new()
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", config.aggregator_key))
        .header("Idempotency-Key", &req.request_id)
        .json(req)
        .timeout(Duration::from_secs(60))
        .send()
        .await;

    match response {
        Ok(response) if response.status().is_success() => {
            match response.json::<AggregatorScreeningResponse>().await {
                Ok(provider) if provider.source.trim().is_empty() => {
                    error_result(req, "screening aggregator response has no source")
                }
                Ok(provider) if !(0.0..=1.0).contains(&provider.risk_score) => {
                    error_result(req, "screening aggregator returned an invalid risk score")
                }
                Ok(provider) => make_result(
                    req,
                    provider.outcome,
                    &provider.summary,
                    provider.details,
                    provider.risk_score,
                    vec![provider.source],
                ),
                Err(error) => error_result(
                    req,
                    &format!("parse screening aggregator response: {error}"),
                ),
            }
        }
        Ok(response) => error_result(
            req,
            &format!("screening aggregator returned HTTP {}", response.status()),
        ),
        Err(error) => error_result(req, &format!("call screening aggregator: {error}")),
    }
}

// ─── Result Helpers ───────────────────────────────────────────────────────────

fn make_result(
    req: &ScreeningRequest,
    outcome: ScreeningOutcome,
    summary: &str,
    details: serde_json::Value,
    risk_score: f64,
    sources: Vec<String>,
) -> ScreeningResult {
    ScreeningResult {
        request_id: req.request_id.clone(),
        order_ref: req.order_ref.clone(),
        result_id: req.result_id,
        screening_type: req.screening_type.clone(),
        outcome,
        summary: summary.to_string(),
        details,
        risk_score,
        sources,
        completed_at: Utc::now(),
        error: None,
    }
}

fn error_result(req: &ScreeningRequest, err: &str) -> ScreeningResult {
    ScreeningResult {
        request_id: req.request_id.clone(),
        order_ref: req.order_ref.clone(),
        result_id: req.result_id,
        screening_type: req.screening_type.clone(),
        outcome: ScreeningOutcome::Error,
        summary: format!("Screening error: {err}"),
        details: serde_json::json!({ "error": err }),
        risk_score: 0.5,
        sources: vec![],
        completed_at: Utc::now(),
        error: Some(err.to_string()),
    }
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

async fn handle_screen(
    State(state): State<AppState>,
    Json(req): Json<ScreeningRequest>,
) -> Result<Json<ScreeningResult>, StatusCode> {
    let timer = state
        .metrics
        .screening_duration
        .with_label_values(&[&format!("{:?}", req.screening_type)])
        .start_timer();

    let mut redis = state.redis.clone();
    let result = run_screening(&req, &state.config, &mut redis).await;

    timer.observe_duration();
    state
        .metrics
        .screenings_total
        .with_label_values(&[
            &format!("{:?}", result.screening_type),
            &format!("{:?}", result.outcome),
        ])
        .inc();

    // Persist result to PostgreSQL (fire-and-forget)
    if let Some(pool) = state.db_pool.clone() {
        let result_clone = result.clone();
        tokio::spawn(async move {
            db::persist_result(&pool, &result_clone).await;
        });
    }

    // Publish result to Kafka
    if let Ok(json) = serde_json::to_string(&result) {
        let record = FutureRecord::to("bis.screening.results")
            .key(&result.order_ref)
            .payload(&json);
        let _ = state.producer.send(record, Duration::from_secs(5)).await;
    }

    Ok(Json(result))
}

#[derive(Deserialize)]
struct BatchRequest {
    requests: Vec<ScreeningRequest>,
}

async fn handle_batch(
    State(state): State<AppState>,
    Json(batch): Json<BatchRequest>,
) -> Result<Json<Vec<ScreeningResult>>, StatusCode> {
    let mut redis = state.redis.clone();
    let mut results = Vec::new();
    for req in &batch.requests {
        let result = run_screening(req, &state.config, &mut redis).await;
        results.push(result);
    }
    Ok(Json(results))
}

async fn handle_health() -> Json<serde_json::Value> {
    Json(
        serde_json::json!({ "status": "ok", "service": "screening-engine", "version": env!("CARGO_PKG_VERSION") }),
    )
}

async fn handle_metrics() -> String {
    use prometheus::Encoder;
    let encoder = prometheus::TextEncoder::new();
    let mut buf = Vec::new();
    encoder
        .encode(&prometheus::gather(), &mut buf)
        .unwrap_or_default();
    String::from_utf8(buf).unwrap_or_default()
}

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

async fn start_kafka_consumer(state: AppState) {
    let kafka_url = std::env::var("KAFKA_URL").unwrap_or_else(|_| "localhost:9092".into());
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &kafka_url)
        .set("group.id", "bis-screening-engine")
        .set("auto.offset.reset", "earliest")
        .set("enable.auto.commit", "true")
        .create()
        .expect("Failed to create Kafka consumer");

    consumer
        .subscribe(&["bis.screening.requests"])
        .expect("Failed to subscribe");
    info!("Kafka consumer started on bis.screening.requests");

    loop {
        match consumer.recv().await {
            Ok(msg) => {
                if let Some(payload) = msg.payload() {
                    match serde_json::from_slice::<ScreeningRequest>(payload) {
                        Ok(req) => {
                            let state_clone = state.clone();
                            tokio::spawn(async move {
                                let mut redis = state_clone.redis.clone();
                                let result =
                                    run_screening(&req, &state_clone.config, &mut redis).await;
                                // Persist to PostgreSQL
                                if let Some(pool) = &state_clone.db_pool {
                                    db::persist_result(pool, &result).await;
                                }
                                // Publish to Kafka
                                if let Ok(json) = serde_json::to_string(&result) {
                                    let record = FutureRecord::to("bis.screening.results")
                                        .key(&result.order_ref)
                                        .payload(&json);
                                    let _ = state_clone
                                        .producer
                                        .send(record, Duration::from_secs(5))
                                        .await;
                                }
                            });
                        }
                        Err(e) => warn!("Failed to parse screening request: {e}"),
                    }
                }
            }
            Err(e) => error!("Kafka consumer error: {e}"),
        }
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".into());
    let kafka_url = std::env::var("KAFKA_URL").unwrap_or_else(|_| "localhost:9092".into());

    let redis_client = redis::Client::open(redis_url)?;
    let redis_mgr = ConnectionManager::new(redis_client).await?;

    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &kafka_url)
        .set("message.timeout.ms", "5000")
        .create()?;

    let config = Arc::new(EngineConfig {
        nimc_url: std::env::var("NIMC_URL").unwrap_or_else(|_| "https://api.nimc.gov.ng".into()),
        nimc_key: std::env::var("NIMC_API_KEY").unwrap_or_default(),
        nibss_url: std::env::var("NIBSS_URL")
            .unwrap_or_else(|_| "https://api.nibss-plc.com.ng".into()),
        nibss_key: std::env::var("NIBSS_API_KEY").unwrap_or_default(),
        efcc_url: std::env::var("EFCC_URL").unwrap_or_else(|_| "https://api.efcc.gov.ng".into()),
        efcc_key: std::env::var("EFCC_API_KEY").unwrap_or_default(),
        icpc_url: std::env::var("ICPC_URL").unwrap_or_else(|_| "https://api.icpc.gov.ng".into()),
        icpc_key: std::env::var("ICPC_API_KEY").unwrap_or_default(),
        cac_url: std::env::var("CAC_URL").unwrap_or_else(|_| "https://efts.cac.gov.ng".into()),
        cac_key: std::env::var("CAC_API_KEY").unwrap_or_default(),
        waec_url: std::env::var("WAEC_URL")
            .unwrap_or_else(|_| "https://api.waecnigeria.org".into()),
        waec_key: std::env::var("WAEC_API_KEY").unwrap_or_default(),
        aggregator_url: std::env::var("SCREENING_AGGREGATOR_URL").unwrap_or_default(),
        aggregator_key: std::env::var("SCREENING_AGGREGATOR_API_KEY").unwrap_or_default(),
    });

    if std::env::var("BIS_SCREENING_ENGINE_KEY")
        .unwrap_or_default()
        .is_empty()
    {
        anyhow::bail!("BIS_SCREENING_ENGINE_KEY must be configured");
    }
    if config.aggregator_url.trim().is_empty() || config.aggregator_key.trim().is_empty() {
        anyhow::bail!(
            "SCREENING_AGGREGATOR_URL and SCREENING_AGGREGATOR_API_KEY must be configured"
        );
    }
    if std::env::var("DATABASE_URL").unwrap_or_default().is_empty() {
        anyhow::bail!("DATABASE_URL must be configured for durable screening results");
    }
    let metrics = Arc::new(Metrics::new());

    // A screening decision may not be served without durable PostgreSQL persistence.
    let db_pool = db::build_pool().await.map(Arc::new);
    if db_pool.is_none() {
        anyhow::bail!("screening-engine could not create the required PostgreSQL pool");
    }

    let state = AppState {
        redis: redis_mgr,
        producer,
        config,
        metrics,
        db_pool,
    };

    // Start Kafka consumer in background
    let state_clone = state.clone();
    tokio::spawn(async move { start_kafka_consumer(state_clone).await });

    let protected = Router::new()
        .route("/screen", post(handle_screen))
        .route("/batch", post(handle_batch))
        .route("/metrics", get(handle_metrics))
        .layer(middleware::from_fn(service_auth));
    let app = Router::new()
        .route("/health", get(handle_health))
        .merge(protected)
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8085".into());
    let addr = format!("0.0.0.0:{port}");
    info!("BIS Screening Engine listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_req(screening_type: ScreeningType) -> ScreeningRequest {
        ScreeningRequest {
            request_id: Uuid::new_v4().to_string(),
            order_ref: "ORD-2025-TEST".into(),
            result_id: 1,
            candidate_id: 1,
            tenant_id: 1,
            screening_type,
            subject: SubjectInfo {
                full_name: "Adebayo Okafor".into(),
                nin: Some("12345678901".into()),
                bvn: Some("22345678901".into()),
                dob: Some("1990-01-15".into()),
                phone: Some("+2348012345678".into()),
                email: Some("adebayo@example.com".into()),
                address: Some("14 Broad Street, Lagos Island, Lagos".into()),
                state: Some("Lagos".into()),
                cac_rc: None,
                waec_number: Some("WEC/2008/123456".into()),
                nysc_number: Some("NYSC/2013/A/123456".into()),
                licence_number: None,
            },
            options: HashMap::new(),
            callback_url: None,
            created_at: Utc::now(),
        }
    }

    fn test_config() -> EngineConfig {
        EngineConfig {
            nimc_url: "".into(),
            nimc_key: "".into(),
            nibss_url: "".into(),
            nibss_key: "".into(),
            efcc_url: "".into(),
            efcc_key: "".into(),
            icpc_url: "".into(),
            icpc_key: "".into(),
            cac_url: "".into(),
            cac_key: "".into(),
            waec_url: "".into(),
            waec_key: "".into(),
            aggregator_url: "".into(),
            aggregator_key: "".into(),
        }
    }

    #[tokio::test]
    async fn test_nin_trace_provider_unavailable() {
        let req = make_req(ScreeningType::NinTrace);
        let config = test_config();
        let result = screen_nin_trace(&req, &config).await;
        assert!(matches!(result.outcome, ScreeningOutcome::Error));
        assert!(result.risk_score >= 0.0);
    }

    #[tokio::test]
    async fn test_efcc_provider_unavailable() {
        let req = make_req(ScreeningType::CriminalEfcc);
        let config = test_config();
        let result = screen_efcc(&req, &config).await;
        assert!(matches!(result.outcome, ScreeningOutcome::Error));
    }

    #[tokio::test]
    async fn test_waec_provider_unavailable() {
        let req = make_req(ScreeningType::EducationWaec);
        let config = test_config();
        let result = screen_aggregator(&req, &config).await;
        assert!(matches!(result.outcome, ScreeningOutcome::Error));
    }

    #[tokio::test]
    async fn test_aggregator_requires_configuration() {
        let req = make_req(ScreeningType::PepSanctions);
        let config = test_config();
        let result = screen_aggregator(&req, &config).await;
        assert!(matches!(result.outcome, ScreeningOutcome::Error));
        assert!(result.risk_score >= 0.0);
    }

    #[tokio::test]
    async fn test_all_screening_types_require_credentialed_provider() {
        let types = vec![
            ScreeningType::NinTrace,
            ScreeningType::BvnVerification,
            ScreeningType::CriminalEfcc,
            ScreeningType::CriminalIcpc,
            ScreeningType::CourtRecord,
            ScreeningType::CacDirectorship,
            ScreeningType::EducationWaec,
            ScreeningType::NyscDischarge,
            ScreeningType::PepSanctions,
            ScreeningType::Watchlist,
            ScreeningType::AdverseMedia,
            ScreeningType::AddressVerification,
        ];
        let config = test_config();
        for st in types {
            let req = make_req(st);
            let result = screen_aggregator(&req, &config).await;
            assert!(matches!(result.outcome, ScreeningOutcome::Error));
        }
    }

    #[tokio::test]
    async fn test_aggregator_accepts_valid_provider_contract() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let provider = Router::new().route(
            "/v1/screenings/pep_sanctions",
            post(
                |headers: axum::http::HeaderMap,
                 axum::Json(request): axum::Json<ScreeningRequest>| async move {
                    assert_eq!(
                        headers
                            .get("authorization")
                            .and_then(|value| value.to_str().ok()),
                        Some("Bearer integration-test-key")
                    );
                    assert_eq!(
                        headers
                            .get("idempotency-key")
                            .and_then(|value| value.to_str().ok()),
                        Some(request.request_id.as_str())
                    );
                    (
                        axum::http::StatusCode::OK,
                        axum::Json(serde_json::json!({
                            "outcome": "clear",
                            "summary": "Accredited provider completed PEP screening",
                            "details": {"match": false},
                            "risk_score": 0.02,
                            "source": "accredited-provider"
                        })),
                    )
                },
            ),
        );
        tokio::spawn(async move { axum::serve(listener, provider).await.unwrap() });

        let mut config = test_config();
        config.aggregator_url = format!("http://{address}");
        config.aggregator_key = "integration-test-key".into();
        let request = make_req(ScreeningType::PepSanctions);
        let result = screen_aggregator(&request, &config).await;
        assert!(matches!(result.outcome, ScreeningOutcome::Clear));
        assert_eq!(
            result.summary,
            "Accredited provider completed PEP screening"
        );
        assert_eq!(result.sources, vec!["accredited-provider"]);
    }
}
