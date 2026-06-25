mod mtls_cert_inspect;
use mtls_cert_inspect::{inspect_peer_cert, peer_cn_from_header};

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time;
use tracing::{error, info, warn};
use velocity_lib::{default_rules, VelocityBreach, VelocityEngine, PaymentEvent as LibPaymentEvent};
use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::Deserialize;

// ─── Prometheus counters ──────────────────────────────────────────────────────

static EVENTS_TOTAL: AtomicU64 = AtomicU64::new(0);
static BREACHES_TOTAL: AtomicU64 = AtomicU64::new(0);
static DISPATCH_ERRORS_TOTAL: AtomicU64 = AtomicU64::new(0);
static DISPATCH_SUCCESS_TOTAL: AtomicU64 = AtomicU64::new(0);
static CIRCUIT_OPEN_TOTAL: AtomicU64 = AtomicU64::new(0);

fn render_metrics() -> String {
    format!(
        "# HELP velocity_events_total Total payment events ingested\n\
         # TYPE velocity_events_total counter\n\
         velocity_events_total {}\n\
         # HELP velocity_breaches_total Total velocity breaches detected\n\
         # TYPE velocity_breaches_total counter\n\
         velocity_breaches_total {}\n\
         # HELP velocity_dispatch_success_total Successful breach dispatches\n\
         # TYPE velocity_dispatch_success_total counter\n\
         velocity_dispatch_success_total {}\n\
         # HELP velocity_dispatch_errors_total Failed breach dispatches\n\
         # TYPE velocity_dispatch_errors_total counter\n\
         velocity_dispatch_errors_total {}\n\
         # HELP velocity_circuit_open_total Times the Redis circuit breaker opened\n\
         # TYPE velocity_circuit_open_total counter\n\
         velocity_circuit_open_total {}\n",
        EVENTS_TOTAL.load(Ordering::Relaxed),
        BREACHES_TOTAL.load(Ordering::Relaxed),
        DISPATCH_SUCCESS_TOTAL.load(Ordering::Relaxed),
        DISPATCH_ERRORS_TOTAL.load(Ordering::Relaxed),
        CIRCUIT_OPEN_TOTAL.load(Ordering::Relaxed),
    )
}

// ─── Config ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Config {
    gateway_url: String,
    gateway_key: String,
    webhook_port: u16,
    gc_interval_secs: u64,
    redis_url: String,
    mtls_enabled: bool,
    mtls_allowed_cns: Vec<String>,
}

impl Config {
    fn from_env() -> Self {
        let mtls_cns = std::env::var("MTLS_ALLOWED_CNS")
            .unwrap_or_else(|_| "bis-gateway,bis-event-processor".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();
        Self {
            gateway_url: std::env::var("GATEWAY_URL")
                .unwrap_or_else(|_| "http://localhost:8080".to_string()),
            gateway_key: std::env::var("BIS_GATEWAY_KEY")
                .unwrap_or_else(|_| "dev-gateway-key-change-in-prod".to_string()),
            webhook_port: std::env::var("WEBHOOK_PORT")
                .ok().and_then(|v| v.parse().ok()).unwrap_or(9090),
            gc_interval_secs: std::env::var("GC_INTERVAL_SECS")
                .ok().and_then(|v| v.parse().ok()).unwrap_or(300),
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            mtls_enabled: std::env::var("MTLS_ENABLED")
                .map(|v| v.to_lowercase() == "true").unwrap_or(false),
            mtls_allowed_cns: mtls_cns,
        }
    }
}

// ─── Redis circuit breaker (raw TCP, no redis crate) ─────────────────────────

fn redis_addr(url: &str) -> Option<String> {
    let s = url.strip_prefix("redis://").unwrap_or(url);
    let s = if let Some(at) = s.rfind('@') { &s[at+1..] } else { s };
    if s.contains(':') { Some(s.to_string()) } else { Some(format!("{}:6379", s)) }
}

async fn redis_set_ex(url: &str, key: &str, value: &str, ex: u64) {
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpStream;
    let Some(addr) = redis_addr(url) else { return };
    let Ok(mut s) = TcpStream::connect(&addr).await else { return };
    let cmd = format!("*5\r\n$3\r\nSET\r\n${}\r\n{}\r\n${}\r\n{}\r\n$2\r\nEX\r\n${}\r\n{}\r\n",
        key.len(), key, value.len(), value, ex.to_string().len(), ex);
    let _ = s.write_all(cmd.as_bytes()).await;
}

async fn redis_del(url: &str, key: &str) {
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpStream;
    let Some(addr) = redis_addr(url) else { return };
    let Ok(mut s) = TcpStream::connect(&addr).await else { return };
    let cmd = format!("*2\r\n$3\r\nDEL\r\n${}\r\n{}\r\n", key.len(), key);
    let _ = s.write_all(cmd.as_bytes()).await;
}

async fn redis_get(url: &str, key: &str) -> Option<String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;
    let addr = redis_addr(url)?;
    let mut s = TcpStream::connect(&addr).await.ok()?;
    let cmd = format!("*2\r\n$3\r\nGET\r\n${}\r\n{}\r\n", key.len(), key);
    s.write_all(cmd.as_bytes()).await.ok()?;
    let mut buf = [0u8; 256];
    let n = s.read(&mut buf).await.ok()?;
    let resp = std::str::from_utf8(&buf[..n]).ok()?;
    if resp.starts_with('$') {
        resp.splitn(3, "\r\n").nth(1).map(|s| s.to_string())
    } else { None }
}

async fn is_circuit_open(redis_url: &str) -> bool {
    redis_get(redis_url, "bis:velocity:circuit_breaker").await
        .map(|v| v == "open").unwrap_or(false)
}

async fn open_circuit(redis_url: &str) {
    CIRCUIT_OPEN_TOTAL.fetch_add(1, Ordering::Relaxed);
    redis_set_ex(redis_url, "bis:velocity:circuit_breaker", "open", 30).await;
}

async fn close_circuit(redis_url: &str) {
    redis_del(redis_url, "bis:velocity:circuit_breaker").await;
}

// ─── Gateway dispatch ─────────────────────────────────────────────────────────

async fn dispatch_breach(client: &reqwest::Client, config: &Config, breach: &VelocityBreach) {
    if is_circuit_open(&config.redis_url).await {
        warn!(alert_id = %breach.alert_id, "Circuit breaker OPEN — skipping dispatch");
        DISPATCH_ERRORS_TOTAL.fetch_add(1, Ordering::Relaxed);
        return;
    }
    let url = format!("{}/v1/velocity/alert", config.gateway_url);
    match client.post(&url)
        .header("X-Gateway-Key", &config.gateway_key)
        .json(breach)
        .timeout(Duration::from_secs(10))
        .send().await
    {
        Ok(r) if r.status().is_success() => {
            DISPATCH_SUCCESS_TOTAL.fetch_add(1, Ordering::Relaxed);
            close_circuit(&config.redis_url).await;
            info!(alert_id = %breach.alert_id, rule = %breach.rule_name, "Breach dispatched");
        }
        Ok(r) => {
            warn!(status = %r.status(), "Gateway rejected breach");
            DISPATCH_ERRORS_TOTAL.fetch_add(1, Ordering::Relaxed);
            open_circuit(&config.redis_url).await;
        }
        Err(e) => {
            error!(error = %e, "Dispatch failed");
            DISPATCH_ERRORS_TOTAL.fetch_add(1, Ordering::Relaxed);
            open_circuit(&config.redis_url).await;
        }
    }
}

// ─── GC task ─────────────────────────────────────────────────────────────────

async fn run_gc(engine: Arc<Mutex<VelocityEngine>>, interval_secs: u64) {
    let mut interval = time::interval(Duration::from_secs(interval_secs));
    loop {
        interval.tick().await;
        let mut eng = engine.lock().await;
        let before = eng.active_windows();
        eng.gc();
        let after = eng.active_windows();
        info!("GC complete: {} -> {} active windows", before, after);
    }
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    engine: Arc<Mutex<VelocityEngine>>,
    client: Arc<reqwest::Client>,
    config: Arc<Config>,
}

#[derive(Deserialize)]
struct PaymentEventReq {
    event_type: Option<String>,
    tx_ref: Option<String>,
    account_id: String,
    amount_kobo: Option<i64>,
    amount: Option<f64>,
    currency: String,
    rail: Option<String>,
    is_cross_border: Option<bool>,
    tenant_id: Option<String>,
    peer_cn: Option<String>,
}

async fn handle_health() -> impl IntoResponse {
    (StatusCode::OK, Json(serde_json::json!({
        "status": "ok",
        "service": "fluvio-velocity",
        "events_total": EVENTS_TOTAL.load(Ordering::Relaxed),
        "breaches_total": BREACHES_TOTAL.load(Ordering::Relaxed),
    })))
}

async fn handle_metrics() -> impl IntoResponse {
    (StatusCode::OK,
     [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")],
     render_metrics())
}

async fn handle_event(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(req): Json<PaymentEventReq>,
) -> impl IntoResponse {
    // mTLS peer certificate inspection.
    // Production: reads X-Peer-Cert-DER (base64 DER) injected by TLS terminator,
    // parses the real certificate CN/SANs, and validates against the allow-list.
    // Dev/test fallback: trusts X-Peer-CN header when X-Peer-Cert-DER is absent.
    if state.config.mtls_enabled {
        let allowed = if let Some(der_b64) = headers.get("X-Peer-Cert-DER")
            .and_then(|v| v.to_str().ok())
        {
            use base64::Engine as _;
            match base64::engine::general_purpose::STANDARD.decode(der_b64) {
                Ok(der) => {
                    let (info, ok) = inspect_peer_cert(&der, &state.config.mtls_allowed_cns);
                    if ok {
                        info!(identity = %info.identity(), "mTLS peer cert accepted");
                    } else {
                        warn!(identity = %info.identity(), "mTLS peer cert rejected");
                    }
                    ok
                }
                Err(_) => {
                    warn!("X-Peer-Cert-DER header present but not valid base64 — rejecting");
                    false
                }
            }
        } else {
            // Header-based fallback (dev/test only — not for production)
            let cn = peer_cn_from_header(&headers).unwrap_or_default();
            let ok = state.config.mtls_allowed_cns.iter().any(|a| a.as_str() == cn.as_str());
            if !ok {
                warn!(peer_cn = %cn, "mTLS peer CN (header fallback) not allowed");
            }
            ok
        };
        if !allowed {
            return (StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "peer certificate not allowed"})));
        }
    }
    EVENTS_TOTAL.fetch_add(1, Ordering::Relaxed);
    let amount_kobo = req.amount_kobo
        .unwrap_or_else(|| (req.amount.unwrap_or(0.0) * 100.0) as i64);
    let event = LibPaymentEvent {
        event_type: req.event_type.unwrap_or_else(|| "payment".to_string()),
        tx_ref: req.tx_ref.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        account_id: req.account_id.clone(),
        amount_kobo,
        currency: req.currency,
        rail: req.rail.unwrap_or_else(|| "NIP".to_string()),
        is_cross_border: req.is_cross_border,
        tenant_id: req.tenant_id.unwrap_or_else(|| "default".to_string()),
        timestamp: chrono::Utc::now(),
    };
    let mut eng = state.engine.lock().await;
    let breaches = eng.process(&event);
    drop(eng);
    if !breaches.is_empty() {
        BREACHES_TOTAL.fetch_add(breaches.len() as u64, Ordering::Relaxed);
        for breach in &breaches {
            dispatch_breach(&state.client, &state.config, breach).await;
        }
    }
    (StatusCode::OK, Json(serde_json::json!({
        "breaches": breaches,
        "events_total": EVENTS_TOTAL.load(Ordering::Relaxed),
    })))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    let log_level = std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(&log_level)),
        ).init();
    let config = Arc::new(Config::from_env());
    let engine = Arc::new(Mutex::new(VelocityEngine::new(default_rules())));
    let client = Arc::new(reqwest::Client::new());
    info!("BIS Fluvio Velocity Processor starting...");
    info!("Gateway URL: {}", config.gateway_url);
    info!("mTLS enabled: {}", config.mtls_enabled);
    info!("Redis circuit breaker: {}", config.redis_url);
    let gc_engine = engine.clone();
    let gc_interval = config.gc_interval_secs;
    tokio::spawn(async move { run_gc(gc_engine, gc_interval).await; });
    let state = AppState { engine, client, config: config.clone() };
    let app = Router::new()
        .route("/health", get(handle_health))
        .route("/metrics", get(handle_metrics))
        .route("/event", post(handle_event))
        .with_state(state);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], config.webhook_port));
    info!("Listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
