use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing::{info, warn};

use aml_engine::{
    score_transaction, verify_evidence_chain,
    TransactionScreenRequest, EvidenceItem,
};
use aml_engine::sdn_sync::{
    new_cache, seed_static_lists, get_status, name_hits_sdn,
    SharedSdnCache, REFRESH_INTERVAL,
};

// ─── App State ────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    sdn_cache: SharedSdnCache,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
    sdn_entry_count: usize,
    sdn_stale: bool,
}

#[derive(Deserialize)]
struct VerifyChainRequest {
    items: Vec<EvidenceItem>,
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let cache = state.sdn_cache.read().unwrap();
    let status = get_status(&cache);
    Json(HealthResponse {
        status: "ok",
        service: "bis-aml-engine",
        version: "2.0.0",
        sdn_entry_count: status.entry_count,
        sdn_stale: status.is_stale,
    })
}

async fn screen_transaction(
    State(state): State<AppState>,
    Json(req): Json<TransactionScreenRequest>,
) -> impl IntoResponse {
    let mut result = score_transaction(&req);

    // Augment with live SDN name-match check
    let cache = state.sdn_cache.read().unwrap();
    if name_hits_sdn(&req.originator_name, &cache) || name_hits_sdn(&req.beneficiary_name, &cache) {
        result.risk_score = 100;
        result.blocked = true;
        result.flags.push("sdn_name_match".to_string());
        result.rule_hits.push(aml_engine::RuleHit {
            rule_id: "AML-SDN-001".to_string(),
            rule_name: "SDN Name Match".to_string(),
            score_contribution: 100,
            description: format!(
                "Originator '{}' or beneficiary '{}' matches OFAC/UN SDN list",
                req.originator_name, req.beneficiary_name
            ),
        });
    }

    // Check BIC against live cache
    let bics = [req.originator_bic.as_deref(), req.beneficiary_bic.as_deref()];
    for bic in bics.iter().flatten() {
        if cache.bic_prefixes.iter().any(|prefix| bic.starts_with(prefix.as_str())) {
            result.risk_score = 100;
            result.blocked = true;
            if !result.flags.contains(&"sanctioned_bic".to_string()) {
                result.flags.push("sanctioned_bic_live".to_string());
                result.rule_hits.push(aml_engine::RuleHit {
                    rule_id: "AML-SDN-002".to_string(),
                    rule_name: "Sanctioned Institution BIC (Live Cache)".to_string(),
                    score_contribution: 100,
                    description: format!("BIC {} matches live SDN sanctioned institution cache", bic),
                });
            }
        }
    }

    // Check country against live sanctioned countries
    if cache.sanctioned_countries.contains(req.originator_country.as_str())
        || cache.sanctioned_countries.contains(req.beneficiary_country.as_str())
    {
        if !result.flags.contains(&"high_risk_originator_country".to_string())
            && !result.flags.contains(&"high_risk_beneficiary_country".to_string())
        {
            result.risk_score = (result.risk_score + 35).min(100);
            result.flags.push("sanctioned_country_live".to_string());
        }
    }

    drop(cache);
    (StatusCode::OK, Json(result))
}

async fn verify_chain(
    Json(req): Json<VerifyChainRequest>,
) -> impl IntoResponse {
    let result = verify_evidence_chain(&req.items);
    let status = if result.is_valid {
        StatusCode::OK
    } else {
        StatusCode::CONFLICT
    };
    (status, Json(result))
}

async fn sanctions_status(State(state): State<AppState>) -> impl IntoResponse {
    let cache = state.sdn_cache.read().unwrap();
    let status = get_status(&cache);
    Json(status)
}

// ─── Background SDN Refresh Task ─────────────────────────────────────────────

/// Spawns a background task that refreshes the SDN cache every REFRESH_INTERVAL.
/// In environments without internet access the refresh is skipped silently.
fn spawn_sdn_refresh(cache: SharedSdnCache) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(REFRESH_INTERVAL).await;
            info!("[SDN] Starting scheduled refresh...");
            match fetch_and_update_cache(&cache).await {
                Ok(count) => info!("[SDN] Refresh complete: {} entries loaded", count),
                Err(e) => warn!("[SDN] Refresh failed (will retry next cycle): {}", e),
            }
        }
    });
}

/// Attempt to fetch the OFAC SDN feed and update the cache.
/// Returns the number of entries loaded on success.
async fn fetch_and_update_cache(cache: &SharedSdnCache) -> Result<usize, String> {
    // Use reqwest if available; otherwise return an error so the static seed remains.
    // This is a best-effort refresh — the engine works without it.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("BIS-AML-Engine/2.0 (compliance@bis.ng)")
        .build()
        .map_err(|e| format!("HTTP client build failed: {e}"))?;

    let url = aml_engine::sdn_sync::OFAC_SDN_URL;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("HTTP GET {url} failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), url));
    }

    let body = resp.text().await.map_err(|e| format!("Body read failed: {e}"))?;

    // Parse the SDN XML — extract <lastName> and <firstName> elements.
    // This is a simplified parser; a production system would use a proper XML library.
    let name_tokens = extract_name_tokens_from_xml(&body);
    let count = name_tokens.len();

    {
        let mut guard = cache.write().unwrap();
        for token in name_tokens {
            guard.name_tokens.insert(token);
        }
        guard.last_refreshed = Some(std::time::Instant::now());
        guard.entry_count = count;
    }

    Ok(count)
}

/// Extract normalised name tokens from OFAC SDN XML.
fn extract_name_tokens_from_xml(xml: &str) -> Vec<String> {
    use aml_engine::sdn_sync::normalise_name;
    let mut tokens = Vec::new();
    // Simple regex-free extraction: find text between <lastName> and </lastName>,
    // <firstName> and </firstName>, and <aka> <lastName> tags.
    for tag in &["lastName", "firstName", "wholeName"] {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        let mut pos = 0;
        while let Some(start) = xml[pos..].find(&open) {
            let abs_start = pos + start + open.len();
            if let Some(end) = xml[abs_start..].find(&close) {
                let name = &xml[abs_start..abs_start + end];
                for token in normalise_name(name) {
                    tokens.push(token);
                }
                pos = abs_start + end + close.len();
            } else {
                break;
            }
        }
    }
    tokens.sort();
    tokens.dedup();
    tokens
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()),
        )
        .init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8085".to_string())
        .parse()
        .unwrap_or(8085);

    // Initialise SDN cache with static seed lists so screening works immediately.
    let sdn_cache = new_cache();
    {
        let mut guard = sdn_cache.write().unwrap();
        seed_static_lists(&mut guard);
        info!("[SDN] Static seed loaded: {} entries", guard.entry_count);
    }

    // Spawn background refresh task.
    spawn_sdn_refresh(Arc::clone(&sdn_cache));

    let state = AppState { sdn_cache };

    let app = Router::new()
        .route("/health", get(health))
        .route("/screen", post(screen_transaction))
        .route("/evidence/verify-chain", post(verify_chain))
        .route("/sanctions/status", get(sanctions_status))
        .with_state(state)
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("BIS AML Engine v2.0 listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
