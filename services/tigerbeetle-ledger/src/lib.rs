/// BIS TigerBeetle Ledger — Core Library
///
/// Provides:
///   - Double-entry accounting types (Account, Transfer, Ledger)
///   - TigerBeetle HTTP proxy client
///   - PostgreSQL reconciliation writer
///   - Idempotency key management via Redis
///   - Prometheus metrics
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

// ─── Ledger Constants ─────────────────────────────────────────────────────────

/// ISO 4217 numeric codes used as TigerBeetle ledger IDs
pub mod ledger {
    pub const NGN: u32 = 566;
    pub const USD: u32 = 840;
    pub const EUR: u32 = 978;
    pub const GBP: u32 = 826;
    pub const GHS: u32 = 936;
    pub const KES: u32 = 404;
    pub const USDC: u32 = 9001; // Stablecoin pseudo-ledger
    pub const CNGN: u32 = 9566; // cNGN stablecoin pseudo-ledger
}

/// Well-known system account IDs
pub mod accounts {
    /// Platform revenue account (credit side for all service fees)
    pub const REVENUE: &str = "1";
    /// Platform float account (holds unallocated tenant deposits)
    pub const FLOAT: &str = "2";
    /// Suspense account (temporary holds during compliance review)
    pub const SUSPENSE: &str = "3";
    /// Fee collection account
    pub const FEES: &str = "4";
    /// Prefix for tenant debit accounts: "10000{tenant_id}"
    pub const TENANT_PREFIX: &str = "10000";
    /// Prefix for investigation escrow accounts: "20000{investigation_id}"
    pub const INVESTIGATION_PREFIX: &str = "20000";
}

/// Transfer user-data codes (investigation tiers)
pub mod tier {
    pub const BASIC: u64 = 1;
    pub const STANDARD: u64 = 2;
    pub const PREMIUM: u64 = 3;
    pub const TOPUP: u64 = 100;
    pub const REFUND: u64 = 101;
    pub const FEE: u64 = 102;
    pub const MOJALOOP: u64 = 200;
    pub const STABLECOIN: u64 = 201;
    pub const SAR_ESCROW: u64 = 300;
}

// ─── Error Types ─────────────────────────────────────────────────────────────

#[derive(Error, Debug)]
pub enum LedgerError {
    #[error("TigerBeetle HTTP proxy error: {0}")]
    ProxyError(String),
    #[error("Insufficient balance: account {account_id} has {available} but {required} required")]
    InsufficientBalance { account_id: String, available: u64, required: u64 },
    #[error("Account not found: {0}")]
    AccountNotFound(String),
    #[error("Duplicate transfer: idempotency key {0} already processed")]
    DuplicateTransfer(String),
    #[error("PostgreSQL reconciliation error: {0}")]
    ReconciliationError(String),
    #[error("Redis idempotency error: {0}")]
    IdempotencyError(String),
    #[error("Invalid ledger code: {0}")]
    InvalidLedger(u32),
    #[error("HTTP client error: {0}")]
    HttpError(#[from] reqwest::Error),
    #[error("Serialization error: {0}")]
    SerdeError(#[from] serde_json::Error),
}

// ─── TigerBeetle Types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TbAccount {
    pub id: String,
    pub debits_pending: u64,
    pub debits_posted: u64,
    pub credits_pending: u64,
    pub credits_posted: u64,
    pub user_data_128: String,
    pub user_data_64: u64,
    pub user_data_32: u32,
    pub ledger: u32,
    pub code: u16,
    pub flags: u16,
}

impl TbAccount {
    /// Available balance = credits_posted - debits_posted - debits_pending
    pub fn available_balance(&self) -> i64 {
        self.credits_posted as i64 - self.debits_posted as i64 - self.debits_pending as i64
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TbTransfer {
    pub id: String,
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub amount: u64,
    pub user_data_128: String,
    pub user_data_64: u64,
    pub user_data_32: u32,
    pub ledger: u32,
    pub code: u16,
    pub flags: u16,
    pub timeout: u32,
    pub timestamp: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAccountRequest {
    pub id: String,
    pub user_data_128: String,
    pub user_data_64: u64,
    pub user_data_32: u32,
    pub ledger: u32,
    pub code: u16,
    pub flags: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTransferRequest {
    pub id: String,
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub amount: u64,
    pub user_data_128: String,
    pub user_data_64: u64,
    pub user_data_32: u32,
    pub ledger: u32,
    pub code: u16,
    pub flags: u16,
    pub timeout: u32,
}

// ─── API Request/Response Types ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TopupRequest {
    pub tenant_id: i32,
    pub amount_kobo: u64,
    pub currency: String,
    pub reference: String,
    pub initiated_by: i32,
}

#[derive(Debug, Serialize)]
pub struct TopupResponse {
    pub transfer_id: String,
    pub tenant_account_id: String,
    pub amount_kobo: u64,
    pub new_balance_kobo: i64,
    pub reference: String,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
pub struct DebitRequest {
    pub tenant_id: i32,
    pub amount_kobo: u64,
    pub currency: String,
    pub tier: u64,
    pub investigation_ref: String,
    pub initiated_by: i32,
}

#[derive(Debug, Serialize)]
pub struct DebitResponse {
    pub transfer_id: String,
    pub tenant_account_id: String,
    pub amount_kobo: u64,
    pub remaining_balance_kobo: i64,
    pub investigation_ref: String,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
pub struct BalanceRequest {
    pub tenant_id: i32,
    pub currency: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BalanceResponse {
    pub tenant_id: i32,
    pub account_id: String,
    pub available_balance_kobo: i64,
    pub credits_posted: u64,
    pub debits_posted: u64,
    pub debits_pending: u64,
    pub currency: String,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
pub struct MojaloopTransferRequest {
    pub tenant_id: i32,
    pub amount_kobo: u64,
    pub currency: String,
    pub transfer_ref: String,
    pub beneficiary_account: String,
    pub beneficiary_bank_code: String,
    pub initiated_by: i32,
}

#[derive(Debug, Deserialize)]
pub struct StablecoinTransferRequest {
    pub tenant_id: i32,
    pub amount: u64,
    pub currency: String, // "USDC" | "cNGN"
    pub transfer_ref: String,
    pub from_address: String,
    pub to_address: String,
    pub network: String,
    pub initiated_by: i32,
}

// ─── TigerBeetle HTTP Proxy Client ───────────────────────────────────────────

#[derive(Clone)]
pub struct TbClient {
    base_url: String,
    http: reqwest::Client,
    pub enabled: bool,
}

impl TbClient {
    pub fn new(base_url: &str) -> Self {
        let enabled = !base_url.is_empty() && base_url != "disabled";
        Self {
            base_url: base_url.to_string(),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("Failed to build HTTP client"),
            enabled,
        }
    }

    pub fn tenant_account_id(tenant_id: i32) -> String {
        format!("{}{}", accounts::TENANT_PREFIX, tenant_id)
    }

    pub fn investigation_escrow_id(investigation_id: i32) -> String {
        format!("{}{}", accounts::INVESTIGATION_PREFIX, investigation_id)
    }

    pub fn ledger_for_currency(currency: &str) -> u32 {
        match currency {
            "NGN" => ledger::NGN,
            "USD" => ledger::USD,
            "EUR" => ledger::EUR,
            "GBP" => ledger::GBP,
            "GHS" => ledger::GHS,
            "KES" => ledger::KES,
            "USDC" => ledger::USDC,
            "cNGN" | "CNGN" => ledger::CNGN,
            _ => ledger::NGN,
        }
    }

    /// Create or ensure a tenant account exists in TigerBeetle
    pub async fn ensure_account(&self, account_id: &str, ledger_code: u32, tenant_id: i32) -> Result<TbAccount, LedgerError> {
        if !self.enabled {
            return Ok(self.mock_account(account_id, ledger_code));
        }
        // Try to fetch existing account first
        let resp = self.http
            .get(format!("{}/accounts/{}", self.base_url, account_id))
            .send()
            .await?;
        if resp.status().is_success() {
            let account: TbAccount = resp.json().await?;
            return Ok(account);
        }
        // Create the account
        let req = CreateAccountRequest {
            id: account_id.to_string(),
            user_data_128: format!("tenant:{}", tenant_id),
            user_data_64: tenant_id as u64,
            user_data_32: 0,
            ledger: ledger_code,
            code: 1000, // Tenant debit account code
            flags: 0,
        };
        let resp = self.http
            .post(format!("{}/accounts", self.base_url))
            .json(&[&req])
            .send()
            .await?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(LedgerError::ProxyError(format!("create account failed: {}", body)));
        }
        Ok(self.mock_account(account_id, ledger_code))
    }

    /// Post a double-entry transfer
    pub async fn create_transfer(&self, req: &CreateTransferRequest) -> Result<String, LedgerError> {
        if !self.enabled {
            tracing::debug!("[TigerBeetle] (dev) transfer {} → {} amount={}", req.debit_account_id, req.credit_account_id, req.amount);
            return Ok(req.id.clone());
        }
        let resp = self.http
            .post(format!("{}/transfers", self.base_url))
            .json(&[req])
            .send()
            .await?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(LedgerError::ProxyError(format!("create transfer failed: {}", body)));
        }
        Ok(req.id.clone())
    }

    /// Fetch account balance
    pub async fn get_account(&self, account_id: &str) -> Result<TbAccount, LedgerError> {
        if !self.enabled {
            return Ok(self.mock_account(account_id, ledger::NGN));
        }
        let resp = self.http
            .get(format!("{}/accounts/{}", self.base_url, account_id))
            .send()
            .await?;
        if resp.status() == 404 {
            return Err(LedgerError::AccountNotFound(account_id.to_string()));
        }
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(LedgerError::ProxyError(body));
        }
        Ok(resp.json().await?)
    }

    fn mock_account(&self, id: &str, ledger_code: u32) -> TbAccount {
        TbAccount {
            id: id.to_string(),
            debits_pending: 0,
            debits_posted: 0,
            credits_pending: 0,
            credits_posted: 10_000_000_000, // ₦100,000 mock balance
            user_data_128: String::new(),
            user_data_64: 0,
            user_data_32: 0,
            ledger: ledger_code,
            code: 1000,
            flags: 0,
        }
    }
}

// ─── Ledger Operations ────────────────────────────────────────────────────────

/// Execute a tenant topup (credit tenant account from float)
pub async fn execute_topup(
    client: &TbClient,
    req: &TopupRequest,
) -> Result<TopupResponse, LedgerError> {
    let ledger_code = TbClient::ledger_for_currency(&req.currency);
    let tenant_account_id = TbClient::tenant_account_id(req.tenant_id);
    // Ensure tenant account exists
    client.ensure_account(&tenant_account_id, ledger_code, req.tenant_id).await?;
    // Transfer: FLOAT → TENANT
    let transfer_id = Uuid::new_v4().to_string();
    let transfer = CreateTransferRequest {
        id: transfer_id.clone(),
        debit_account_id: accounts::FLOAT.to_string(),
        credit_account_id: tenant_account_id.clone(),
        amount: req.amount_kobo,
        user_data_128: req.reference.clone(),
        user_data_64: req.initiated_by as u64,
        user_data_32: req.tenant_id as u32,
        ledger: ledger_code,
        code: tier::TOPUP as u16,
        flags: 0,
        timeout: 0,
    };
    client.create_transfer(&transfer).await?;
    let account = client.get_account(&tenant_account_id).await?;
    Ok(TopupResponse {
        transfer_id,
        tenant_account_id,
        amount_kobo: req.amount_kobo,
        new_balance_kobo: account.available_balance(),
        reference: req.reference.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

/// Execute a tenant debit (investigation credit consumption)
pub async fn execute_debit(
    client: &TbClient,
    req: &DebitRequest,
) -> Result<DebitResponse, LedgerError> {
    let ledger_code = TbClient::ledger_for_currency(&req.currency);
    let tenant_account_id = TbClient::tenant_account_id(req.tenant_id);
    // Check balance
    let account = client.get_account(&tenant_account_id).await?;
    let available = account.available_balance();
    if available < req.amount_kobo as i64 {
        return Err(LedgerError::InsufficientBalance {
            account_id: tenant_account_id.clone(),
            available: available.max(0) as u64,
            required: req.amount_kobo,
        });
    }
    // Transfer: TENANT → REVENUE
    let transfer_id = Uuid::new_v4().to_string();
    let transfer = CreateTransferRequest {
        id: transfer_id.clone(),
        debit_account_id: tenant_account_id.clone(),
        credit_account_id: accounts::REVENUE.to_string(),
        amount: req.amount_kobo,
        user_data_128: req.investigation_ref.clone(),
        user_data_64: req.initiated_by as u64,
        user_data_32: req.tenant_id as u32,
        ledger: ledger_code,
        code: req.tier as u16,
        flags: 0,
        timeout: 0,
    };
    client.create_transfer(&transfer).await?;
    let updated = client.get_account(&tenant_account_id).await?;
    Ok(DebitResponse {
        transfer_id,
        tenant_account_id,
        amount_kobo: req.amount_kobo,
        remaining_balance_kobo: updated.available_balance(),
        investigation_ref: req.investigation_ref.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tenant_account_id() {
        assert_eq!(TbClient::tenant_account_id(42), "1000042");
    }

    #[test]
    fn test_ledger_for_currency() {
        assert_eq!(TbClient::ledger_for_currency("NGN"), ledger::NGN);
        assert_eq!(TbClient::ledger_for_currency("USD"), ledger::USD);
        assert_eq!(TbClient::ledger_for_currency("USDC"), ledger::USDC);
        assert_eq!(TbClient::ledger_for_currency("UNKNOWN"), ledger::NGN);
    }

    #[test]
    fn test_available_balance() {
        let account = TbAccount {
            id: "test".to_string(),
            debits_pending: 100,
            debits_posted: 500,
            credits_pending: 0,
            credits_posted: 1000,
            user_data_128: String::new(),
            user_data_64: 0,
            user_data_32: 0,
            ledger: ledger::NGN,
            code: 1000,
            flags: 0,
        };
        // available = 1000 - 500 - 100 = 400
        assert_eq!(account.available_balance(), 400);
    }
}
