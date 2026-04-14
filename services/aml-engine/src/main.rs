use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tracing::info;

use aml_engine::{
    score_transaction, verify_evidence_chain,
    TransactionScreenRequest, EvidenceItem,
};

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

#[derive(Deserialize)]
struct VerifyChainRequest {
    items: Vec<EvidenceItem>,
}

async fn health() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok",
        service: "bis-aml-engine",
        version: "1.0.0",
    })
}

async fn screen_transaction(
    Json(req): Json<TransactionScreenRequest>,
) -> impl IntoResponse {
    let result = score_transaction(&req);
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

    let app = Router::new()
        .route("/health", get(health))
        .route("/screen", post(screen_transaction))
        .route("/evidence/verify-chain", post(verify_chain))
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("BIS AML Engine listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
