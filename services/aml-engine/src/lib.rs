use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::collections::HashSet;

// ─── AML Scoring ─────────────────────────────────────────────────────────────

/// High-risk jurisdictions per FATF, OFAC, UN Security Council
static HIGH_RISK_COUNTRIES: &[&str] = &[
    "AF", "BY", "CF", "CG", "CU", "ER", "IR", "KP", "LY", "ML",
    "MM", "NI", "RU", "SO", "SS", "SY", "VE", "YE", "ZW",
];

/// OFAC/UN sanctioned BIC prefixes (stub list — production uses full OFAC SDN)
static SANCTIONED_BIC_PREFIXES: &[&str] = &[
    "CBIRKPSE", // Central Bank of DPRK
    "SYRIABANK",
    "IRIBANKIR",
];

/// Structuring thresholds by currency (just below CTR threshold)
fn structuring_range(currency: &str) -> Option<(f64, f64)> {
    match currency {
        "NGN" => Some((4_900_000.0, 5_000_000.0)),
        "USD" => Some((9_000.0, 10_000.0)),
        "EUR" => Some((9_000.0, 10_000.0)),
        "GBP" => Some((9_000.0, 10_000.0)),
        "GHS" => Some((49_000.0, 50_000.0)),
        "KES" => Some((990_000.0, 1_000_000.0)),
        _ => None,
    }
}

fn large_cash_threshold(currency: &str) -> f64 {
    match currency {
        "NGN" => 5_000_000.0,
        "USD" | "EUR" | "GBP" => 10_000.0,
        "GHS" => 50_000.0,
        "KES" => 1_000_000.0,
        _ => 10_000.0,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionScreenRequest {
    pub transaction_ref: String,
    pub amount: f64,
    pub currency: String,
    pub originator_name: String,
    pub originator_country: String,
    pub originator_bic: Option<String>,
    pub beneficiary_name: String,
    pub beneficiary_country: String,
    pub beneficiary_bic: Option<String>,
    pub transaction_type: String,
    pub narration: Option<String>,
    pub is_cash: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

impl RiskLevel {
    pub fn from_score(score: u32) -> Self {
        match score {
            0..=24 => RiskLevel::Low,
            25..=49 => RiskLevel::Medium,
            50..=74 => RiskLevel::High,
            _ => RiskLevel::Critical,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            RiskLevel::Low => "low",
            RiskLevel::Medium => "medium",
            RiskLevel::High => "high",
            RiskLevel::Critical => "critical",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreeningResult {
    pub transaction_ref: String,
    pub risk_score: u32,
    pub risk_level: RiskLevel,
    pub flags: Vec<String>,
    pub blocked: bool,
    pub requires_manual_review: bool,
    pub rule_hits: Vec<RuleHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleHit {
    pub rule_id: String,
    pub rule_name: String,
    pub score_contribution: u32,
    pub description: String,
}

/// Core AML scoring function — pure, deterministic, no I/O
pub fn score_transaction(req: &TransactionScreenRequest) -> ScreeningResult {
    let mut score: u32 = 0;
    let mut flags: Vec<String> = Vec::new();
    let mut rule_hits: Vec<RuleHit> = Vec::new();
    let high_risk_set: HashSet<&str> = HIGH_RISK_COUNTRIES.iter().copied().collect();

    // Rule 1: High-risk originator country
    if high_risk_set.contains(req.originator_country.as_str()) {
        score += 35;
        flags.push("high_risk_originator_country".to_string());
        rule_hits.push(RuleHit {
            rule_id: "AML-001".to_string(),
            rule_name: "High-Risk Originator Country".to_string(),
            score_contribution: 35,
            description: format!("Originator country {} is on FATF/OFAC high-risk list", req.originator_country),
        });
    }

    // Rule 2: High-risk beneficiary country
    if high_risk_set.contains(req.beneficiary_country.as_str()) {
        score += 35;
        flags.push("high_risk_beneficiary_country".to_string());
        rule_hits.push(RuleHit {
            rule_id: "AML-002".to_string(),
            rule_name: "High-Risk Beneficiary Country".to_string(),
            score_contribution: 35,
            description: format!("Beneficiary country {} is on FATF/OFAC high-risk list", req.beneficiary_country),
        });
    }

    // Rule 3: Potential structuring (Smurfing)
    if let Some((low, high)) = structuring_range(&req.currency) {
        if req.amount >= low && req.amount < high {
            score += 45;
            flags.push("potential_structuring".to_string());
            rule_hits.push(RuleHit {
                rule_id: "AML-003".to_string(),
                rule_name: "Potential Structuring / Smurfing".to_string(),
                score_contribution: 45,
                description: format!(
                    "Amount {:.2} {} is in structuring range ({:.2}–{:.2})",
                    req.amount, req.currency, low, high
                ),
            });
        }
    }

    // Rule 4: Large cash transaction (CTR threshold)
    let threshold = large_cash_threshold(&req.currency);
    if req.amount >= threshold && req.is_cash.unwrap_or(false) {
        score += 20;
        flags.push("large_cash_transaction".to_string());
        rule_hits.push(RuleHit {
            rule_id: "AML-004".to_string(),
            rule_name: "Large Cash Transaction (CTR Required)".to_string(),
            score_contribution: 20,
            description: format!("Cash transaction {:.2} {} exceeds CTR threshold {:.2}", req.amount, req.currency, threshold),
        });
    }

    // Rule 5: Cash transaction type
    let cash_types = ["cash_deposit", "cash_withdrawal"];
    if cash_types.contains(&req.transaction_type.as_str()) {
        score += 10;
        flags.push("cash_transaction".to_string());
        rule_hits.push(RuleHit {
            rule_id: "AML-005".to_string(),
            rule_name: "Cash Transaction".to_string(),
            score_contribution: 10,
            description: format!("Transaction type {} involves physical cash", req.transaction_type),
        });
    }

    // Rule 6: Suspicious narration keywords
    if let Some(narration) = &req.narration {
        let narration_lower = narration.to_lowercase();
        let suspicious_keywords = [
            "shell", "offshore", "nominee", "bearer", "crypto", "bitcoin",
            "hawala", "smurfing", "layering", "placement", "integration",
        ];
        let found: Vec<&str> = suspicious_keywords.iter()
            .filter(|&&kw| narration_lower.contains(kw))
            .copied()
            .collect();
        if !found.is_empty() {
            score += 30;
            flags.push("suspicious_narration".to_string());
            rule_hits.push(RuleHit {
                rule_id: "AML-006".to_string(),
                rule_name: "Suspicious Narration Keywords".to_string(),
                score_contribution: 30,
                description: format!("Narration contains suspicious keywords: {}", found.join(", ")),
            });
        }
    }

    // Rule 7: Large FX conversion
    if req.transaction_type == "fx_conversion" && req.amount > 50_000.0 {
        score += 15;
        flags.push("large_fx_conversion".to_string());
        rule_hits.push(RuleHit {
            rule_id: "AML-007".to_string(),
            rule_name: "Large FX Conversion".to_string(),
            score_contribution: 15,
            description: format!("FX conversion of {:.2} {} exceeds threshold", req.amount, req.currency),
        });
    }

    // Rule 8: Sanctioned BIC
    let bics_to_check: Vec<&str> = [
        req.originator_bic.as_deref(),
        req.beneficiary_bic.as_deref(),
    ]
    .iter()
    .filter_map(|b| *b)
    .collect();
    for bic in bics_to_check {
        if SANCTIONED_BIC_PREFIXES.iter().any(|&prefix| bic.starts_with(prefix)) {
            score += 100; // Automatic block
            flags.push("sanctioned_bic".to_string());
            rule_hits.push(RuleHit {
                rule_id: "AML-008".to_string(),
                rule_name: "Sanctioned Institution BIC".to_string(),
                score_contribution: 100,
                description: format!("BIC {} matches sanctioned institution list", bic),
            });
        }
    }

    // Rule 9: Round number large transfer (indicator of layering)
    if req.amount >= 100_000.0 && req.amount % 10_000.0 == 0.0 {
        score += 10;
        flags.push("round_number_large_transfer".to_string());
        rule_hits.push(RuleHit {
            rule_id: "AML-009".to_string(),
            rule_name: "Round Number Large Transfer".to_string(),
            score_contribution: 10,
            description: format!("Transfer amount {:.2} is a round number >= 100,000 (layering indicator)", req.amount),
        });
    }

    // Rule 10: Cross-border wire with no purpose code
    let cross_border = req.originator_country != req.beneficiary_country;
    let wire_types = ["wire_transfer", "swift_mt103", "swift_mt202"];
    if cross_border && wire_types.contains(&req.transaction_type.as_str()) && req.amount > 10_000.0 {
        score += 5;
        flags.push("cross_border_wire".to_string());
        rule_hits.push(RuleHit {
            rule_id: "AML-010".to_string(),
            rule_name: "Cross-Border Wire Transfer".to_string(),
            score_contribution: 5,
            description: "Cross-border wire transfer above threshold — verify purpose code".to_string(),
        });
    }

    let score = score.min(100);
    let risk_level = RiskLevel::from_score(score);
    let blocked = score >= 100 || flags.contains(&"sanctioned_bic".to_string());
    let requires_manual_review = score >= 50 && !blocked;

    ScreeningResult {
        transaction_ref: req.transaction_ref.clone(),
        risk_score: score,
        risk_level,
        flags,
        blocked,
        requires_manual_review,
        rule_hits,
    }
}

// ─── Evidence Integrity ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceItem {
    pub id: String,
    pub case_ref: String,
    pub file_name: String,
    pub file_size: u64,
    pub mime_type: String,
    pub content_hash: String, // SHA-256 of file content
    pub chain_hash: String,   // SHA-256 of (prev_hash + content_hash + timestamp)
    pub previous_hash: String,
    pub timestamp: String,
    pub custodian: String,
    pub action: String,       // "collected", "transferred", "analyzed", "submitted"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceChainVerification {
    pub is_valid: bool,
    pub total_items: usize,
    pub broken_at: Option<usize>,
    pub broken_item_id: Option<String>,
    pub error: Option<String>,
}

/// Compute SHA-256 hash of arbitrary bytes
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// Compute chain hash for evidence item
/// chain_hash = SHA256(previous_hash || content_hash || timestamp || custodian || action)
pub fn compute_chain_hash(
    previous_hash: &str,
    content_hash: &str,
    timestamp: &str,
    custodian: &str,
    action: &str,
) -> String {
    let data = format!("{}{}{}{}{}", previous_hash, content_hash, timestamp, custodian, action);
    sha256_hex(data.as_bytes())
}

/// Verify the integrity of an evidence chain
pub fn verify_evidence_chain(items: &[EvidenceItem]) -> EvidenceChainVerification {
    if items.is_empty() {
        return EvidenceChainVerification {
            is_valid: true,
            total_items: 0,
            broken_at: None,
            broken_item_id: None,
            error: None,
        };
    }

    for (i, item) in items.iter().enumerate() {
        let expected_chain_hash = compute_chain_hash(
            &item.previous_hash,
            &item.content_hash,
            &item.timestamp,
            &item.custodian,
            &item.action,
        );
        if expected_chain_hash != item.chain_hash {
            return EvidenceChainVerification {
                is_valid: false,
                total_items: items.len(),
                broken_at: Some(i),
                broken_item_id: Some(item.id.clone()),
                error: Some(format!(
                    "Chain integrity broken at item {} ({}): expected hash {}, got {}",
                    i, item.id, expected_chain_hash, item.chain_hash
                )),
            };
        }

        // Verify chain linkage (each item's previous_hash must match previous item's chain_hash)
        if i > 0 {
            let prev_chain_hash = &items[i - 1].chain_hash;
            if &item.previous_hash != prev_chain_hash {
                return EvidenceChainVerification {
                    is_valid: false,
                    total_items: items.len(),
                    broken_at: Some(i),
                    broken_item_id: Some(item.id.clone()),
                    error: Some(format!(
                        "Chain linkage broken at item {} ({}): previous_hash mismatch",
                        i, item.id
                    )),
                };
            }
        }
    }

    EvidenceChainVerification {
        is_valid: true,
        total_items: items.len(),
        broken_at: None,
        broken_item_id: None,
        error: None,
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn base_request() -> TransactionScreenRequest {
        TransactionScreenRequest {
            transaction_ref: "TXN-TEST-001".to_string(),
            amount: 1000.0,
            currency: "USD".to_string(),
            originator_name: "Test Corp".to_string(),
            originator_country: "NG".to_string(),
            originator_bic: None,
            beneficiary_name: "Test Beneficiary".to_string(),
            beneficiary_country: "GB".to_string(),
            beneficiary_bic: None,
            transaction_type: "wire_transfer".to_string(),
            narration: None,
            is_cash: None,
        }
    }

    #[test]
    fn test_low_risk_transaction() {
        let req = base_request();
        let result = score_transaction(&req);
        assert_eq!(result.risk_level, RiskLevel::Low);
        assert!(!result.blocked);
        assert!(!result.requires_manual_review);
    }

    #[test]
    fn test_high_risk_originator_country() {
        let mut req = base_request();
        req.originator_country = "KP".to_string(); // North Korea
        let result = score_transaction(&req);
        assert!(result.risk_score >= 35);
        assert!(result.flags.contains(&"high_risk_originator_country".to_string()));
    }

    #[test]
    fn test_high_risk_both_countries() {
        let mut req = base_request();
        req.originator_country = "IR".to_string();
        req.beneficiary_country = "SY".to_string();
        let result = score_transaction(&req);
        // 35 + 35 = 70 → High (50-74 range)
        assert!(result.risk_score >= 70);
        assert!(result.risk_level == RiskLevel::High || result.risk_level == RiskLevel::Critical);
        assert!(result.flags.contains(&"high_risk_originator_country".to_string()));
        assert!(result.flags.contains(&"high_risk_beneficiary_country".to_string()));
    }

    #[test]
    fn test_structuring_ngn() {
        let mut req = base_request();
        req.amount = 4_950_000.0;
        req.currency = "NGN".to_string();
        req.originator_country = "NG".to_string();
        req.beneficiary_country = "NG".to_string();
        let result = score_transaction(&req);
        assert!(result.flags.contains(&"potential_structuring".to_string()));
        assert!(result.risk_score >= 45);
    }

    #[test]
    fn test_structuring_usd() {
        let mut req = base_request();
        req.amount = 9_500.0;
        req.currency = "USD".to_string();
        req.originator_country = "NG".to_string();
        req.beneficiary_country = "NG".to_string();
        let result = score_transaction(&req);
        assert!(result.flags.contains(&"potential_structuring".to_string()));
    }

    #[test]
    fn test_large_cash_transaction() {
        let mut req = base_request();
        req.amount = 15_000.0;
        req.currency = "USD".to_string();
        req.is_cash = Some(true);
        req.transaction_type = "cash_deposit".to_string();
        req.originator_country = "NG".to_string();
        req.beneficiary_country = "NG".to_string();
        let result = score_transaction(&req);
        assert!(result.flags.contains(&"large_cash_transaction".to_string()));
        assert!(result.flags.contains(&"cash_transaction".to_string()));
    }

    #[test]
    fn test_suspicious_narration() {
        let mut req = base_request();
        req.narration = Some("Payment for offshore shell company services".to_string());
        let result = score_transaction(&req);
        assert!(result.flags.contains(&"suspicious_narration".to_string()));
        assert!(result.risk_score >= 30);
    }

    #[test]
    fn test_sanctioned_bic_blocked() {
        let mut req = base_request();
        req.originator_bic = Some("CBIRKPSEXxx".to_string());
        let result = score_transaction(&req);
        assert!(result.blocked);
        assert!(result.flags.contains(&"sanctioned_bic".to_string()));
    }

    #[test]
    fn test_round_number_large_transfer() {
        let mut req = base_request();
        req.amount = 500_000.0;
        req.originator_country = "NG".to_string();
        req.beneficiary_country = "NG".to_string();
        let result = score_transaction(&req);
        assert!(result.flags.contains(&"round_number_large_transfer".to_string()));
    }

    #[test]
    fn test_fx_conversion_large() {
        let mut req = base_request();
        req.transaction_type = "fx_conversion".to_string();
        req.amount = 100_000.0;
        req.originator_country = "NG".to_string();
        req.beneficiary_country = "NG".to_string();
        let result = score_transaction(&req);
        assert!(result.flags.contains(&"large_fx_conversion".to_string()));
    }

    #[test]
    fn test_score_capped_at_100() {
        let mut req = base_request();
        req.originator_country = "KP".to_string();
        req.beneficiary_country = "IR".to_string();
        req.amount = 9_500.0;
        req.currency = "USD".to_string();
        req.narration = Some("offshore shell bitcoin hawala".to_string());
        let result = score_transaction(&req);
        assert!(result.risk_score <= 100);
    }

    // Evidence chain tests
    #[test]
    fn test_sha256_hex() {
        let hash = sha256_hex(b"hello world");
        // SHA256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe04294e576f3e9b6b7c3f9c9a4
        assert_eq!(hash.len(), 64, "SHA256 hash must be 64 hex characters");
        // Verify it's deterministic
        let hash2 = sha256_hex(b"hello world");
        assert_eq!(hash, hash2, "SHA256 must be deterministic");
        // Verify different inputs produce different hashes
        let hash3 = sha256_hex(b"hello world!");
        assert_ne!(hash, hash3, "Different inputs must produce different hashes");
    }

    #[test]
    fn test_empty_evidence_chain_valid() {
        let result = verify_evidence_chain(&[]);
        assert!(result.is_valid);
        assert_eq!(result.total_items, 0);
    }

    #[test]
    fn test_valid_evidence_chain() {
        let genesis_hash = "0000000000000000000000000000000000000000000000000000000000000000";
        let content_hash1 = sha256_hex(b"evidence file 1 content");
        let ts1 = "2026-04-14T10:00:00Z";
        let chain_hash1 = compute_chain_hash(genesis_hash, &content_hash1, ts1, "officer_001", "collected");

        let content_hash2 = sha256_hex(b"evidence file 2 content");
        let ts2 = "2026-04-14T11:00:00Z";
        let chain_hash2 = compute_chain_hash(&chain_hash1, &content_hash2, ts2, "analyst_002", "analyzed");

        let items = vec![
            EvidenceItem {
                id: "EV-001".to_string(),
                case_ref: "CASE-2026-001".to_string(),
                file_name: "document1.pdf".to_string(),
                file_size: 1024,
                mime_type: "application/pdf".to_string(),
                content_hash: content_hash1,
                chain_hash: chain_hash1.clone(),
                previous_hash: genesis_hash.to_string(),
                timestamp: ts1.to_string(),
                custodian: "officer_001".to_string(),
                action: "collected".to_string(),
            },
            EvidenceItem {
                id: "EV-002".to_string(),
                case_ref: "CASE-2026-001".to_string(),
                file_name: "analysis.xlsx".to_string(),
                file_size: 2048,
                mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string(),
                content_hash: content_hash2,
                chain_hash: chain_hash2,
                previous_hash: chain_hash1,
                timestamp: ts2.to_string(),
                custodian: "analyst_002".to_string(),
                action: "analyzed".to_string(),
            },
        ];

        let result = verify_evidence_chain(&items);
        assert!(result.is_valid, "Expected valid chain, got error: {:?}", result.error);
        assert_eq!(result.total_items, 2);
    }

    #[test]
    fn test_tampered_evidence_chain() {
        let genesis_hash = "0000000000000000000000000000000000000000000000000000000000000000";
        let content_hash1 = sha256_hex(b"evidence file 1 content");
        let ts1 = "2026-04-14T10:00:00Z";
        let chain_hash1 = compute_chain_hash(genesis_hash, &content_hash1, ts1, "officer_001", "collected");

        let items = vec![
            EvidenceItem {
                id: "EV-001".to_string(),
                case_ref: "CASE-2026-001".to_string(),
                file_name: "document1.pdf".to_string(),
                file_size: 1024,
                mime_type: "application/pdf".to_string(),
                content_hash: "tampered_hash_here".to_string(), // TAMPERED
                chain_hash: chain_hash1,
                previous_hash: genesis_hash.to_string(),
                timestamp: ts1.to_string(),
                custodian: "officer_001".to_string(),
                action: "collected".to_string(),
            },
        ];

        let result = verify_evidence_chain(&items);
        assert!(!result.is_valid, "Expected invalid chain for tampered evidence");
        assert_eq!(result.broken_at, Some(0));
    }

    #[test]
    fn test_broken_chain_linkage() {
        let genesis_hash = "0000000000000000000000000000000000000000000000000000000000000000";
        let content_hash1 = sha256_hex(b"evidence file 1");
        let ts1 = "2026-04-14T10:00:00Z";
        let chain_hash1 = compute_chain_hash(genesis_hash, &content_hash1, ts1, "officer_001", "collected");

        let content_hash2 = sha256_hex(b"evidence file 2");
        let ts2 = "2026-04-14T11:00:00Z";
        // Use wrong previous hash (not chain_hash1)
        let wrong_prev = "wrong_previous_hash_here";
        let chain_hash2 = compute_chain_hash(wrong_prev, &content_hash2, ts2, "analyst_002", "analyzed");

        let items = vec![
            EvidenceItem {
                id: "EV-001".to_string(),
                case_ref: "CASE-2026-001".to_string(),
                file_name: "doc1.pdf".to_string(),
                file_size: 1024,
                mime_type: "application/pdf".to_string(),
                content_hash: content_hash1,
                chain_hash: chain_hash1,
                previous_hash: genesis_hash.to_string(),
                timestamp: ts1.to_string(),
                custodian: "officer_001".to_string(),
                action: "collected".to_string(),
            },
            EvidenceItem {
                id: "EV-002".to_string(),
                case_ref: "CASE-2026-001".to_string(),
                file_name: "doc2.pdf".to_string(),
                file_size: 2048,
                mime_type: "application/pdf".to_string(),
                content_hash: content_hash2,
                chain_hash: chain_hash2,
                previous_hash: wrong_prev.to_string(), // BROKEN LINKAGE
                timestamp: ts2.to_string(),
                custodian: "analyst_002".to_string(),
                action: "analyzed".to_string(),
            },
        ];

        let result = verify_evidence_chain(&items);
        assert!(!result.is_valid, "Expected invalid chain for broken linkage");
        assert_eq!(result.broken_at, Some(1));
    }

    #[test]
    fn test_risk_level_boundaries() {
        assert_eq!(RiskLevel::from_score(0), RiskLevel::Low);
        assert_eq!(RiskLevel::from_score(24), RiskLevel::Low);
        assert_eq!(RiskLevel::from_score(25), RiskLevel::Medium);
        assert_eq!(RiskLevel::from_score(49), RiskLevel::Medium);
        assert_eq!(RiskLevel::from_score(50), RiskLevel::High);
        assert_eq!(RiskLevel::from_score(74), RiskLevel::High);
        assert_eq!(RiskLevel::from_score(75), RiskLevel::Critical);
        assert_eq!(RiskLevel::from_score(100), RiskLevel::Critical);
    }
}
