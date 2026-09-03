/// BIS TigerBeetle Ledger Service — HTTP Server
///
/// Exposes a REST API over the TigerBeetle double-entry ledger.
/// All monetary operations in BIS flow through this service.
///
/// Endpoints:
///   POST /ledger/topup           — credit a tenant account (deposit)
///   POST /ledger/debit           — debit a tenant account (investigation consumption)
///   GET  /ledger/balance/:tenant — get tenant account balance
///   POST /ledger/mojaloop        — record a Mojaloop inter-bank transfer
///   POST /ledger/stablecoin      — record a stablecoin transfer
///   POST /ledger/refund          — reverse a debit (compliance hold release)
///   GET  /ledger/transfers/:id   — get transfer by ID
///   GET  /metrics                — Prometheus metrics
///   GET  /health                 — liveness probe
///
/// Port: 8097
use axum::{
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::{
    net::SocketAddr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tigerbeetle_ledger::{
    accounts, execute_debit, execute_topup, tier, BalanceResponse, CreateTransferRequest,
    DebitRequest, LedgerError, MojaloopTransferRequest, StablecoinTransferRequest, TbClient,
    TopupRequest,
};
use tracing::{error, info};
use uuid::Uuid;

// ─── App State ────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    tb: Arc<TbClient>,
}

#[derive(Clone, Copy)]
struct ServiceIdentity {
    tenant_id: i32,
    actor_id: i32,
}

// ─── Error Response ───────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct ErrorResponse {
    error: String,
    code: String,
}

fn ledger_err_response(err: LedgerError) -> (StatusCode, Json<ErrorResponse>) {
    let (status, code) = match &err {
        LedgerError::InsufficientBalance { .. } => {
            (StatusCode::PAYMENT_REQUIRED, "INSUFFICIENT_BALANCE")
        }
        LedgerError::AccountNotFound(_) => (StatusCode::NOT_FOUND, "ACCOUNT_NOT_FOUND"),
        LedgerError::DuplicateTransfer(_) => (StatusCode::CONFLICT, "DUPLICATE_TRANSFER"),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, "LEDGER_ERROR"),
    };
    error!("[TigerBeetle] {}", err);
    (
        status,
        Json(ErrorResponse {
            error: err.to_string(),
            code: code.to_string(),
        }),
    )
}

// ─── Service authentication ────────────────────────────────────────────────────

type HmacSha256 = Hmac<Sha256>;

async fn service_auth(mut request: axum::extract::Request, next: Next) -> Response {
    let headers: &HeaderMap = request.headers();
    let service_key = std::env::var("BIS_LEDGER_KEY").unwrap_or_default();
    let supplied_key = headers
        .get("x-bis-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let tenant_id = headers
        .get("x-bis-tenant-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i32>().ok());
    let actor_id = headers
        .get("x-bis-actor-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i32>().ok());
    let timestamp = headers
        .get("x-bis-timestamp")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok());
    let signature = headers
        .get("x-bis-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_secs() as i64)
        .unwrap_or_default();
    let valid_time = timestamp
        .map(|value| (now - value).abs() <= 300)
        .unwrap_or(false);
    let identity = match (tenant_id, actor_id) {
        (Some(tenant), Some(actor)) if tenant > 0 && actor > 0 => ServiceIdentity {
            tenant_id: tenant,
            actor_id: actor,
        },
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "invalid service identity"})),
            )
                .into_response()
        }
    };
    let mut mac = match HmacSha256::new_from_slice(service_key.as_bytes()) {
        Ok(value) if !service_key.is_empty() => value,
        _ => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({"error": "ledger credential is not configured"})),
            )
                .into_response()
        }
    };
    mac.update(
        format!(
            "{}:{}:{}",
            identity.tenant_id,
            identity.actor_id,
            timestamp.unwrap_or_default()
        )
        .as_bytes(),
    );
    let signature_bytes = match hex::decode(signature) {
        Ok(value) => value,
        Err(_) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "invalid service signature"})),
            )
                .into_response()
        }
    };
    if !valid_time
        || !constant_time_key_match(supplied_key, &service_key)
        || mac.verify_slice(&signature_bytes).is_err()
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    request.extensions_mut().insert(identity);
    next.run(request).await
}

fn constant_time_key_match(provided: &str, expected: &str) -> bool {
    if provided.len() != expected.len() {
        return false;
    }
    let mut difference = 0u8;
    for (left, right) in provided.as_bytes().iter().zip(expected.as_bytes()) {
        difference |= left ^ right;
    }
    difference == 0
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn handle_topup(
    State(state): State<AppState>,
    Extension(identity): Extension<ServiceIdentity>,
    Json(mut req): Json<TopupRequest>,
) -> impl IntoResponse {
    if req.tenant_id != identity.tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error":"tenant mismatch"})),
        )
            .into_response();
    }
    req.initiated_by = identity.actor_id;
    info!(
        "[Ledger] topup tenant={} amount={} ref={}",
        req.tenant_id, req.amount_kobo, req.reference
    );
    match execute_topup(&state.tb, &req).await {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err(e) => {
            let (status, body) = ledger_err_response(e);
            (status, Json(serde_json::to_value(body.0).unwrap())).into_response()
        }
    }
}

async fn handle_debit(
    State(state): State<AppState>,
    Extension(identity): Extension<ServiceIdentity>,
    Json(mut req): Json<DebitRequest>,
) -> impl IntoResponse {
    if req.tenant_id != identity.tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error":"tenant mismatch"})),
        )
            .into_response();
    }
    req.initiated_by = identity.actor_id;
    info!(
        "[Ledger] debit tenant={} amount={} ref={}",
        req.tenant_id, req.amount_kobo, req.investigation_ref
    );
    match execute_debit(&state.tb, &req).await {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err(e) => {
            let (status, body) = ledger_err_response(e);
            (status, Json(serde_json::to_value(body.0).unwrap())).into_response()
        }
    }
}

async fn handle_balance(
    State(state): State<AppState>,
    Extension(identity): Extension<ServiceIdentity>,
    Path(tenant_id): Path<i32>,
) -> impl IntoResponse {
    if tenant_id != identity.tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error":"tenant mismatch"})),
        )
            .into_response();
    }
    let account_id = TbClient::tenant_account_id(tenant_id);
    match state.tb.get_account(&account_id).await {
        Ok(account) => {
            let resp = BalanceResponse {
                tenant_id,
                account_id: account.id.clone(),
                available_balance_kobo: account.available_balance(),
                credits_posted: account.credits_posted,
                debits_posted: account.debits_posted,
                debits_pending: account.debits_pending,
                currency: "NGN".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            };
            (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
        }
        Err(e) => {
            let (status, body) = ledger_err_response(e);
            (status, Json(serde_json::to_value(body.0).unwrap())).into_response()
        }
    }
}

async fn handle_mojaloop(
    State(state): State<AppState>,
    Extension(identity): Extension<ServiceIdentity>,
    Json(mut req): Json<MojaloopTransferRequest>,
) -> impl IntoResponse {
    if req.tenant_id != identity.tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error":"tenant mismatch"})),
        )
            .into_response();
    }
    req.initiated_by = identity.actor_id;
    info!(
        "[Ledger] mojaloop transfer tenant={} amount={} ref={}",
        req.tenant_id, req.amount_kobo, req.transfer_ref
    );
    let ledger_code = TbClient::ledger_for_currency(&req.currency);
    let tenant_account_id = TbClient::tenant_account_id(req.tenant_id);
    let transfer_id = Uuid::new_v4().to_string();
    let transfer = CreateTransferRequest {
        id: transfer_id.clone(),
        debit_account_id: tenant_account_id.clone(),
        credit_account_id: accounts::FLOAT.to_string(),
        amount: req.amount_kobo,
        user_data_128: req.transfer_ref.clone(),
        user_data_64: req.initiated_by as u64,
        user_data_32: req.tenant_id as u32,
        ledger: ledger_code,
        code: tier::MOJALOOP as u16,
        flags: 0,
        timeout: 0,
    };
    match state.tb.create_transfer(&transfer).await {
        Ok(id) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "transfer_id": id,
                "tenant_account_id": tenant_account_id,
                "amount_kobo": req.amount_kobo,
                "transfer_ref": req.transfer_ref,
                "timestamp": chrono::Utc::now().to_rfc3339(),
            })),
        )
            .into_response(),
        Err(e) => {
            let (status, body) = ledger_err_response(e);
            (status, Json(serde_json::to_value(body.0).unwrap())).into_response()
        }
    }
}

async fn handle_stablecoin(
    State(state): State<AppState>,
    Extension(identity): Extension<ServiceIdentity>,
    Json(mut req): Json<StablecoinTransferRequest>,
) -> impl IntoResponse {
    if req.tenant_id != identity.tenant_id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error":"tenant mismatch"})),
        )
            .into_response();
    }
    req.initiated_by = identity.actor_id;
    info!(
        "[Ledger] stablecoin transfer tenant={} amount={} currency={} ref={}",
        req.tenant_id, req.amount, req.currency, req.transfer_ref
    );
    let ledger_code = TbClient::ledger_for_currency(&req.currency);
    let tenant_account_id = TbClient::tenant_account_id(req.tenant_id);
    let transfer_id = Uuid::new_v4().to_string();
    let transfer = CreateTransferRequest {
        id: transfer_id.clone(),
        debit_account_id: tenant_account_id.clone(),
        credit_account_id: accounts::FLOAT.to_string(),
        amount: req.amount,
        user_data_128: req.transfer_ref.clone(),
        user_data_64: req.initiated_by as u64,
        user_data_32: req.tenant_id as u32,
        ledger: ledger_code,
        code: tier::STABLECOIN as u16,
        flags: 0,
        timeout: 0,
    };
    match state.tb.create_transfer(&transfer).await {
        Ok(id) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "transfer_id": id,
                "tenant_account_id": tenant_account_id,
                "amount": req.amount,
                "currency": req.currency,
                "transfer_ref": req.transfer_ref,
                "network": req.network,
                "timestamp": chrono::Utc::now().to_rfc3339(),
            })),
        )
            .into_response(),
        Err(e) => {
            let (status, body) = ledger_err_response(e);
            (status, Json(serde_json::to_value(body.0).unwrap())).into_response()
        }
    }
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "bis-tigerbeetle-ledger",
        "version": "1.0.0",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()))
        .json()
        .init();

    let tb_url = match std::env::var("TIGERBEETLE_HTTP_URL") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            error!("TIGERBEETLE_HTTP_URL must be configured");
            return;
        }
    };
    if std::env::var("BIS_LEDGER_KEY")
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
    {
        error!("BIS_LEDGER_KEY must be configured");
        return;
    }
    let port: u16 = std::env::var("LEDGER_PORT")
        .unwrap_or_else(|_| "8097".to_string())
        .parse()
        .expect("LEDGER_PORT must be a valid port number");

    let tb = match TbClient::new(&tb_url) {
        Ok(client) => Arc::new(client),
        Err(err) => {
            error!("TigerBeetle client initialization failed: {}", err);
            return;
        }
    };
    info!("[TigerBeetle] Configured HTTP proxy at {}", tb_url);

    let state = AppState { tb };
    let protected = Router::new()
        .route("/ledger/topup", post(handle_topup))
        .route("/ledger/debit", post(handle_debit))
        .route("/ledger/balance/:tenant_id", get(handle_balance))
        .route("/ledger/mojaloop", post(handle_mojaloop))
        .route("/ledger/stablecoin", post(handle_stablecoin))
        .layer(middleware::from_fn(service_auth));
    let app = Router::new()
        .route("/health", get(health))
        .merge(protected)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("[TigerBeetle Ledger] Listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind");
    axum::serve(listener, app).await.expect("Server failed");
}

#[cfg(test)]
mod service_auth_tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::get,
        Router,
    };
    use tower::ServiceExt;

    const KEY: &str = "ledger-test-service-key";

    fn signed_headers(
        tenant_id: i32,
        actor_id: i32,
        timestamp: i64,
        signing_tenant: i32,
        signing_actor: i32,
    ) -> Vec<(&'static str, String)> {
        let mut mac = HmacSha256::new_from_slice(KEY.as_bytes()).expect("test HMAC key");
        mac.update(format!("{signing_tenant}:{signing_actor}:{timestamp}").as_bytes());
        vec![
            ("x-bis-key", KEY.to_string()),
            ("x-bis-tenant-id", tenant_id.to_string()),
            ("x-bis-actor-id", actor_id.to_string()),
            ("x-bis-timestamp", timestamp.to_string()),
            ("x-bis-signature", hex::encode(mac.finalize().into_bytes())),
        ]
    }

    fn protected_router() -> Router {
        Router::new()
            .route("/protected", get(|| async { StatusCode::OK }))
            .layer(middleware::from_fn(service_auth))
    }

    async fn call(headers: Vec<(&'static str, String)>) -> StatusCode {
        let mut builder = Request::builder().uri("/protected").method("GET");
        for (name, value) in headers {
            builder = builder.header(name, value);
        }
        protected_router()
            .oneshot(builder.body(Body::empty()).expect("request"))
            .await
            .expect("router response")
            .status()
    }

    #[tokio::test(flavor = "current_thread")]
    async fn signed_ledger_identity_rejects_negative_authorization_scenarios() {
        std::env::set_var("BIS_LEDGER_KEY", KEY);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_secs() as i64;

        assert_eq!(
            call(vec![]).await,
            StatusCode::UNAUTHORIZED,
            "missing identity headers"
        );

        let mut bad_key = signed_headers(101, 202, now, 101, 202);
        bad_key[0].1 = "incorrect-key".to_string();
        assert_eq!(
            call(bad_key).await,
            StatusCode::UNAUTHORIZED,
            "invalid service key"
        );

        let mut missing_tenant = signed_headers(101, 202, now, 101, 202);
        missing_tenant.retain(|(name, _)| *name != "x-bis-tenant-id");
        assert_eq!(
            call(missing_tenant).await,
            StatusCode::UNAUTHORIZED,
            "missing tenant identity"
        );

        assert_eq!(
            call(signed_headers(101, 202, now - 301, 101, 202)).await,
            StatusCode::UNAUTHORIZED,
            "stale timestamp",
        );

        let mut bad_signature = signed_headers(101, 202, now, 101, 202);
        bad_signature[4].1 = "00".repeat(32);
        assert_eq!(
            call(bad_signature).await,
            StatusCode::UNAUTHORIZED,
            "invalid signature"
        );

        assert_eq!(
            call(signed_headers(102, 202, now, 101, 202)).await,
            StatusCode::UNAUTHORIZED,
            "tenant tampering invalidates signed identity",
        );

        assert_eq!(
            call(signed_headers(101, 202, now, 101, 202)).await,
            StatusCode::OK,
            "valid signed service identity",
        );
        std::env::remove_var("BIS_LEDGER_KEY");
    }
}
