use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tokio::time;
use tracing::{error, info, warn};
use velocity_lib::{default_rules, VelocityBreach, VelocityEngine};

struct Config {
    gateway_url: String,
    gateway_key: String,
    webhook_port: u16,
    gc_interval_secs: u64,
}

impl Config {
    fn from_env() -> Self {
        Self {
            gateway_url: std::env::var("GATEWAY_URL")
                .unwrap_or_else(|_| "http://localhost:8080".to_string()),
            gateway_key: std::env::var("BIS_GATEWAY_KEY")
                .unwrap_or_else(|_| "dev-gateway-key-change-in-prod".to_string()),
            webhook_port: std::env::var("WEBHOOK_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(9090),
            gc_interval_secs: std::env::var("GC_INTERVAL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(300),
        }
    }
}

async fn dispatch_breach(
    client: &reqwest::Client,
    config: &Config,
    breach: &VelocityBreach,
) -> Result<(), reqwest::Error> {
    let url = format!("{}/v1/velocity/alert", config.gateway_url);
    let resp = client
        .post(&url)
        .header("X-Gateway-Key", &config.gateway_key)
        .json(breach)
        .timeout(Duration::from_secs(10))
        .send()
        .await?;

    if resp.status().is_success() {
        info!(
            alert_id = %breach.alert_id,
            rule = %breach.rule_name,
            account = %breach.account_id,
            "Velocity breach dispatched"
        );
    } else {
        warn!(
            status = %resp.status(),
            alert_id = %breach.alert_id,
            "Gateway rejected velocity breach"
        );
    }
    Ok(())
}

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

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    let log_level = std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(&log_level)),
        )
        .init();

    let config = Arc::new(Config::from_env());
    let engine = Arc::new(Mutex::new(VelocityEngine::new(default_rules())));
    let _client = Arc::new(reqwest::Client::new());

    info!("BIS Fluvio Velocity Processor starting...");
    info!("Gateway URL: {}", config.gateway_url);
    info!("Webhook fallback port: {}", config.webhook_port);

    let gc_engine = engine.clone();
    let gc_interval = config.gc_interval_secs;
    tokio::spawn(async move {
        run_gc(gc_engine, gc_interval).await;
    });

    // In production: replace with fluvio::consumer loop on bis.payment.events topic
    info!("Listening for payment events on 0.0.0.0:{}", config.webhook_port);
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}
