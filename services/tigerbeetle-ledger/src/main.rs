/// BIS TigerBeetle Ledger Service
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
mod replay;

use axum::{
    body::{to_bytes, Body},
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use hmac::{Hmac, Mac};
use replay::{ReplayError, ReplayReservation, ReplayStore};
use sha2::{Digest, Sha256};
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
use tracing::error;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    tb: Arc<TbClient>,
}

#[derive(Clone)]
struct AuthState {
    replay: ReplayStore,
}

#[derive(Clone, Copy)]
struct ServiceIdentity {
    tenant_id: i32,
    actor_id: i32,
}

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

type HmacSha256 = Hmac<Sha256>;
const MAX_SIGNED_LEDGER_BODY_BYTES: usize = 256 * 1024;
const MAX_LEDGER_CLOCK_SKEW_SECONDS: i64 = 120;

async fn service_auth(
    State(state): State<AuthState>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();
    let body = match to_bytes(body, MAX_SIGNED_LEDGER_BODY_BYTES).await {
        Ok(value) => value,
        Err(_) => {
            return ledger_auth_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "signed request body rejected",
            )
        }
    };
    let headers: &HeaderMap = &parts.headers;
    let service_key = std::env::var("BIS_LEDGER_KEY").unwrap_or_default();
    let expected_key_id = std::env::var("BIS_LEDGER_KEY_ID").unwrap_or_default();
    if service_key.is_empty() || expected_key_id.is_empty() {
        return ledger_auth_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "ledger credentials are not configured",
        );
    }
    let key_id = match required_header(headers, "x-bis-key-id", 96) {
        Some(value) if constant_time_key_match(&value, &expected_key_id) => value,
        _ => return ledger_auth_response(StatusCode::UNAUTHORIZED, "invalid ledger key id"),
    };
    let nonce = match required_header(headers, "x-bis-nonce", 128) {
        Some(value) if value.len() >= 22 => value,
        _ => return ledger_auth_response(StatusCode::UNAUTHORIZED, "invalid ledger nonce"),
    };
    let identity = match (
        positive_i32_header(headers, "x-bis-tenant-id"),
        positive_i32_header(headers, "x-bis-actor-id"),
    ) {
        (Some(tenant_id), Some(actor_id)) => ServiceIdentity {
            tenant_id,
            actor_id,
        },
        _ => return ledger_auth_response(StatusCode::UNAUTHORIZED, "invalid service identity"),
    };
    let timestamp = match i64_header(headers, "x-bis-timestamp") {
        Some(value) if timestamp_is_current(value) => value,
        _ => return ledger_auth_response(StatusCode::UNAUTHORIZED, "expired ledger request"),
    };
    let signature = match headers
        .get("x-bis-signature")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| hex::decode(value).ok())
    {
        Some(value) if value.len() == 32 => value,
        _ => return ledger_auth_response(StatusCode::UNAUTHORIZED, "invalid ledger signature"),
    };

    let canonical_path = canonical_path(parts.uri.path());
    if canonical_path == "/invalid" {
        return ledger_auth_response(StatusCode::BAD_REQUEST, "invalid ledger path");
    }
    let body_hash: [u8; 32] = Sha256::digest(&body).into();
    let nonce_hash: [u8; 32] = Sha256::digest(nonce.as_bytes()).into();
    let canonical = canonical_request(
        &parts.method,
        &canonical_path,
        &key_id,
        identity,
        timestamp,
        &nonce,
        &body_hash,
    );
    let mut mac = match HmacSha256::new_from_slice(service_key.as_bytes()) {
        Ok(value) => value,
        Err(_) => {
            return ledger_auth_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "ledger credentials are invalid",
            )
        }
    };
    mac.update(&canonical);
    if mac.verify_slice(&signature).is_err() {
        return ledger_auth_response(StatusCode::UNAUTHORIZED, "invalid ledger signature");
    }
    match state
        .replay
        .reserve(ReplayReservation {
            key_id: &key_id,
            nonce_hash: &nonce_hash,
            tenant_id: identity.tenant_id,
            actor_id: identity.actor_id,
            method: parts.method.as_str(),
            canonical_path: &canonical_path,
            body_sha256: &body_hash,
        })
        .await
    {
        Ok(()) => {}
        Err(ReplayError::Replayed) => {
            return ledger_auth_response(StatusCode::CONFLICT, "replayed ledger request")
        }
        Err(ReplayError::Unavailable) => {
            return ledger_auth_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "ledger replay protection unavailable",
            )
        }
    }

    parts.extensions.insert(identity);
    next.run(axum::extract::Request::from_parts(parts, Body::from(body)))
        .await
}

fn ledger_auth_response(status: StatusCode, error: &str) -> Response {
    (status, Json(serde_json::json!({"error": error}))).into_response()
}

fn required_header(headers: &HeaderMap, name: &str, max_length: usize) -> Option<String> {
    let value = headers.get(name)?.to_str().ok()?.trim();
    if value.is_empty() || value.len() > max_length || !value.is_ascii() {
        return None;
    }
    Some(value.to_string())
}

fn positive_i32_header(headers: &HeaderMap, name: &str) -> Option<i32> {
    required_header(headers, name, 10)?
        .parse::<i32>()
        .ok()
        .filter(|value| *value > 0)
}

fn i64_header(headers: &HeaderMap, name: &str) -> Option<i64> {
    required_header(headers, name, 20)?.parse::<i64>().ok()
}

fn timestamp_is_current(timestamp: i64) -> bool {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or_default();
    (now - timestamp).abs() <= MAX_LEDGER_CLOCK_SKEW_SECONDS
}

fn canonical_path(path: &str) -> String {
    if !path.starts_with('/') || path.contains("//") || path.contains("..") || path.contains('%') {
        return "/invalid".to_string();
    }
    path.to_string()
}

fn canonical_request(
    method: &axum::http::Method,
    path: &str,
    key_id: &str,
    identity: ServiceIdentity,
    timestamp: i64,
    nonce: &str,
    body_hash: &[u8; 32],
) -> Vec<u8> {
    format!(
        "BIS-LEDGER-HMAC-V2\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
        method.as_str(),
        path,
        key_id,
        identity.tenant_id,
        identity.actor_id,
        timestamp,
        nonce,
        hex::encode(body_hash),
    )
    .into_bytes()
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

async fn handle_topup(
    State(state): State<AppState>,
    Extension(identity): Extension<ServiceIdentity>,
    Json(mut req): Json<TopupRequest>,
) -> impl IntoResponse {
    if req.tenant_id != identity.tenant_id {
        return ledger_auth_response(StatusCode::FORBIDDEN, "tenant mismatch");
    }
    req.initiated_by = identity.actor_id;
    match execute_topup(&state.tb, &req).await {
        Ok(response) => (
            StatusCode::OK,
            Json(serde_json::to_value(response).unwrap()),
        )
            .into_response(),
        Err(error) => {
            let (status, body) = ledger_err_response(error);
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
        return ledger_auth_response(StatusCode::FORBIDDEN, "tenant mismatch");
    }
    req.initiated_by = identity.actor_id;
    match execute_debit(&state.tb, &req).await {
        Ok(response) => (
            StatusCode::OK,
            Json(serde_json::to_value(response).unwrap()),
        )
            .into_response(),
        Err(error) => {
            let (status, body) = ledger_err_response(error);
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
        return ledger_auth_response(StatusCode::FORBIDDEN, "tenant mismatch");
    }
    let account_id = TbClient::tenant_account_id(tenant_id);
    match state.tb.get_account(&account_id).await {
        Ok(account) => {
            let response = BalanceResponse {
                tenant_id,
                account_id: account.id.clone(),
                available_balance_kobo: account.available_balance(),
                credits_posted: account.credits_posted,
                debits_posted: account.debits_posted,
                debits_pending: account.debits_pending,
                currency: "NGN".to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            };
            (
                StatusCode::OK,
                Json(serde_json::to_value(response).unwrap()),
            )
                .into_response()
        }
        Err(error) => {
            let (status, body) = ledger_err_response(error);
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
        return ledger_auth_response(StatusCode::FORBIDDEN, "tenant mismatch");
    }
    req.initiated_by = identity.actor_id;
    let tenant_account_id = TbClient::tenant_account_id(req.tenant_id);
    let transfer = CreateTransferRequest {
        id: Uuid::new_v4().to_string(),
        debit_account_id: tenant_account_id.clone(),
        credit_account_id: accounts::FLOAT.to_string(),
        amount: req.amount_kobo,
        user_data_128: req.transfer_ref.clone(),
        user_data_64: req.initiated_by as u64,
        user_data_32: req.tenant_id as u32,
        ledger: TbClient::ledger_for_currency(&req.currency),
        code: tier::MOJALOOP as u16,
        flags: 0,
        timeout: 0,
    };
    match state.tb.create_transfer(&transfer).await {
        Ok(id) => (StatusCode::OK, Json(serde_json::json!({"transfer_id": id, "tenant_account_id": tenant_account_id, "amount_kobo": req.amount_kobo, "transfer_ref": req.transfer_ref, "timestamp": chrono::Utc::now().to_rfc3339()}))).into_response(),
        Err(error) => {
            let (status, body) = ledger_err_response(error);
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
        return ledger_auth_response(StatusCode::FORBIDDEN, "tenant mismatch");
    }
    req.initiated_by = identity.actor_id;
    let tenant_account_id = TbClient::tenant_account_id(req.tenant_id);
    let transfer = CreateTransferRequest {
        id: Uuid::new_v4().to_string(),
        debit_account_id: tenant_account_id.clone(),
        credit_account_id: accounts::FLOAT.to_string(),
        amount: req.amount,
        user_data_128: req.transfer_ref.clone(),
        user_data_64: req.initiated_by as u64,
        user_data_32: req.tenant_id as u32,
        ledger: TbClient::ledger_for_currency(&req.currency),
        code: tier::STABLECOIN as u16,
        flags: 0,
        timeout: 0,
    };
    match state.tb.create_transfer(&transfer).await {
        Ok(id) => (StatusCode::OK, Json(serde_json::json!({"transfer_id": id, "tenant_account_id": tenant_account_id, "amount": req.amount, "currency": req.currency, "transfer_ref": req.transfer_ref, "network": req.network, "timestamp": chrono::Utc::now().to_rfc3339()}))).into_response(),
        Err(error) => {
            let (status, body) = ledger_err_response(error);
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
        || std::env::var("BIS_LEDGER_KEY_ID")
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
    {
        error!("BIS_LEDGER_KEY and BIS_LEDGER_KEY_ID must be configured");
        return;
    }
    let replay = match ReplayStore::connect_required().await {
        Ok(store) => store,
        Err(_) => {
            error!("ledger replay protection is unavailable");
            return;
        }
    };
    let port: u16 = std::env::var("LEDGER_PORT")
        .unwrap_or_else(|_| "8097".to_string())
        .parse()
        .expect("LEDGER_PORT must be a valid port number");

    let tb = match TbClient::new(&tb_url) {
        Ok(client) => Arc::new(client),
        Err(_) => {
            error!("TigerBeetle client initialization failed");
            return;
        }
    };

    let state = AppState { tb };
    let auth_state = AuthState { replay };
    let protected = Router::new()
        .route("/ledger/topup", post(handle_topup))
        .route("/ledger/debit", post(handle_debit))
        .route("/ledger/balance/:tenant_id", get(handle_balance))
        .route("/ledger/mojaloop", post(handle_mojaloop))
        .route("/ledger/stablecoin", post(handle_stablecoin))
        .layer(middleware::from_fn_with_state(auth_state, service_auth));
    let app = Router::new()
        .route("/health", get(health))
        .merge(protected)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("ledger listener bind failed");
    axum::serve(listener, app)
        .await
        .expect("ledger server failed");
}

#[cfg(test)]
mod service_auth_tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
        routing::post,
        Router,
    };
    use tower::ServiceExt;

    const KEY: &str = "ledger-test-service-key";
    const KEY_ID: &str = "ledger-test-key-v2";

    fn signed_headers(
        method: Method,
        path: &str,
        body: &[u8],
        tenant_id: i32,
        actor_id: i32,
        timestamp: i64,
        nonce: &str,
    ) -> Vec<(&'static str, String)> {
        let identity = ServiceIdentity {
            tenant_id,
            actor_id,
        };
        let body_hash: [u8; 32] = Sha256::digest(body).into();
        let canonical = canonical_request(
            &method, path, KEY_ID, identity, timestamp, nonce, &body_hash,
        );
        let mut mac = HmacSha256::new_from_slice(KEY.as_bytes()).expect("test key");
        mac.update(&canonical);
        vec![
            ("x-bis-key-id", KEY_ID.to_string()),
            ("x-bis-tenant-id", tenant_id.to_string()),
            ("x-bis-actor-id", actor_id.to_string()),
            ("x-bis-timestamp", timestamp.to_string()),
            ("x-bis-nonce", nonce.to_string()),
            ("x-bis-signature", hex::encode(mac.finalize().into_bytes())),
        ]
    }

    fn protected_router() -> Router {
        Router::new()
            .route("/protected", post(|| async { StatusCode::OK }))
            .route("/other", post(|| async { StatusCode::OK }))
            .layer(middleware::from_fn_with_state(
                AuthState {
                    replay: ReplayStore::in_memory(),
                },
                service_auth,
            ))
    }

    async fn call(
        router: Router,
        path: &str,
        headers: Vec<(&'static str, String)>,
        body: Vec<u8>,
    ) -> StatusCode {
        let mut builder = Request::builder().uri(path).method(Method::POST);
        for (name, value) in headers {
            builder = builder.header(name, value);
        }
        router
            .oneshot(builder.body(Body::from(body)).expect("request"))
            .await
            .expect("router response")
            .status()
    }

    #[tokio::test(flavor = "current_thread")]
    async fn body_bound_signature_and_nonce_replay_protection_fail_closed() {
        std::env::set_var("BIS_LEDGER_KEY", KEY);
        std::env::set_var("BIS_LEDGER_KEY_ID", KEY_ID);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_secs() as i64;
        let body = br#"{"amount":100,"currency":"NGN"}"#.to_vec();
        let nonce = Uuid::new_v4().to_string();
        let headers = signed_headers(Method::POST, "/protected", &body, 101, 202, now, &nonce);
        let router = protected_router();

        assert_eq!(
            call(router.clone(), "/protected", headers.clone(), body.clone()).await,
            StatusCode::OK
        );
        assert_eq!(
            call(router.clone(), "/protected", headers.clone(), body.clone()).await,
            StatusCode::CONFLICT
        );
        assert_eq!(
            call(
                router.clone(),
                "/protected",
                headers.clone(),
                br#"{"amount":101,"currency":"NGN"}"#.to_vec()
            )
            .await,
            StatusCode::UNAUTHORIZED,
            "a signed body cannot be changed",
        );
        assert_eq!(
            call(router, "/other", headers, body).await,
            StatusCode::UNAUTHORIZED,
            "a signature cannot be replayed on another path",
        );
        std::env::remove_var("BIS_LEDGER_KEY");
        std::env::remove_var("BIS_LEDGER_KEY_ID");
    }
}
