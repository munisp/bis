/// BIS Risk Stream Processor — Core Library
///
/// Consumes events from Kafka/Fluvio topics and:
///   1. Routes events to the ML Enrichment service for risk scoring
///   2. Publishes enriched events back to Dapr pub/sub
///   3. Deduplicates events using Redis
///   4. Tracks processing metrics via Prometheus
use serde::{Deserialize, Serialize};
use thiserror::Error;

// ─── Event Types ──────────────────────────────────────────────────────────────

/// All BIS domain event types that this processor handles
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EventDomain {
    AmlAlert,
    Transaction,
    KycRecord,
    Investigation,
    Case,
    Screening,
    CriminalRecord,
    SarFiling,
    GoamlFiling,
    RiskProfile,
    InsiderThreat,
    Biometric,
    FieldVisit,
    LexSubmission,
    Payment,
    Stablecoin,
    Mojaloop,
}

/// Canonical risk event envelope — all domain events are normalized to this
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskEvent {
    pub event_id: String,
    pub domain: EventDomain,
    pub event_type: String,
    pub subject_ref: String,
    pub subject_name: Option<String>,
    pub risk_score: Option<f64>,
    pub risk_tier: Option<String>,
    pub tenant_id: Option<i32>,
    pub payload: serde_json::Value,
    pub published_at: String,
    pub source_topic: String,
}

/// ML enrichment request sent to the Python ML service
#[derive(Debug, Serialize)]
pub struct EnrichmentRequest {
    pub subject_ref: String,
    pub subject_name: Option<String>,
    pub domain: String,
    pub event_type: String,
    pub risk_score: Option<f64>,
    pub tenant_id: Option<i32>,
    pub context: serde_json::Value,
}

/// ML enrichment response
#[derive(Debug, Deserialize)]
pub struct EnrichmentResponse {
    pub subject_ref: String,
    pub composite_risk_score: f64,
    pub risk_tier: String,
    pub flags: Vec<String>,
    pub adverse_media_hits: Option<i32>,
    pub pep_match: Option<bool>,
    pub sanctions_match: Option<bool>,
    pub model_version: String,
    pub enriched_at: String,
}

/// Dapr publish request
#[derive(Debug, Serialize)]
pub struct DaprPublishRequest {
    pub topic: String,
    pub data: serde_json::Value,
    pub pubsubname: String,
}

// ─── Processing Result ────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct ProcessingResult {
    pub event_id: String,
    pub domain: EventDomain,
    pub enriched: bool,
    pub risk_score: Option<f64>,
    pub risk_tier: Option<String>,
    pub published_to_dapr: bool,
    pub processing_ms: u64,
}

// ─── Error Types ─────────────────────────────────────────────────────────────

#[derive(Error, Debug)]
pub enum ProcessorError {
    #[error("Kafka consumer error: {0}")]
    KafkaError(String),
    #[error("ML enrichment error: {0}")]
    EnrichmentError(String),
    #[error("Dapr publish error: {0}")]
    DaprError(String),
    #[error("Redis deduplication error: {0}")]
    RedisError(String),
    #[error("Deserialization error: {0}")]
    DeserError(#[from] serde_json::Error),
    #[error("HTTP client error: {0}")]
    HttpError(#[from] reqwest::Error),
}

// ─── Topic Routing ────────────────────────────────────────────────────────────

/// Map Kafka/Fluvio topic names to event domains
pub fn topic_to_domain(topic: &str) -> Option<EventDomain> {
    match topic {
        "bis.aml.alerts" | "bis.aml.events" => Some(EventDomain::AmlAlert),
        "bis.transaction.events" => Some(EventDomain::Transaction),
        "bis.kyc.events" => Some(EventDomain::KycRecord),
        "bis.investigation.events" => Some(EventDomain::Investigation),
        "bis.case.events" => Some(EventDomain::Case),
        "bis.screening.events" => Some(EventDomain::Screening),
        "bis.criminal_records.events" => Some(EventDomain::CriminalRecord),
        "bis.sar.events" => Some(EventDomain::SarFiling),
        "bis.goaml.events" => Some(EventDomain::GoamlFiling),
        "bis.risk_profile.events" => Some(EventDomain::RiskProfile),
        "bis.insider.events" => Some(EventDomain::InsiderThreat),
        "bis.biometric.events" => Some(EventDomain::Biometric),
        "bis.field_visit.events" => Some(EventDomain::FieldVisit),
        "bis.lex.events" => Some(EventDomain::LexSubmission),
        "bis.payment.events" => Some(EventDomain::Payment),
        "bis.stablecoin.events" => Some(EventDomain::Stablecoin),
        "bis.mojaloop.events" => Some(EventDomain::Mojaloop),
        _ => None,
    }
}

/// Determine the enriched output topic for a domain event
pub fn enriched_topic(domain: &EventDomain) -> &'static str {
    match domain {
        EventDomain::AmlAlert => "bis.aml.enriched",
        EventDomain::Transaction => "bis.transaction.enriched",
        EventDomain::KycRecord => "bis.kyc.enriched",
        EventDomain::Investigation => "bis.investigation.enriched",
        EventDomain::Case => "bis.case.enriched",
        EventDomain::Screening => "bis.screening.enriched",
        EventDomain::CriminalRecord => "bis.criminal_records.enriched",
        EventDomain::SarFiling => "bis.sar.enriched",
        EventDomain::GoamlFiling => "bis.goaml.enriched",
        EventDomain::RiskProfile => "bis.risk_profile.enriched",
        EventDomain::InsiderThreat => "bis.insider.enriched",
        _ => "bis.events.enriched",
    }
}

/// Extract subject_ref from a raw event payload based on domain
pub fn extract_subject_ref(domain: &EventDomain, payload: &serde_json::Value) -> String {
    let candidates = match domain {
        EventDomain::AmlAlert => &["alertRef", "alert_ref", "transactionRef"],
        EventDomain::Transaction => &["txRef", "tx_ref", "transactionRef"],
        EventDomain::KycRecord => &["subjectRef", "subject_ref", "kycRef"],
        EventDomain::Investigation => &["ref", "investigationRef", "subjectRef"],
        EventDomain::Case => &["ref", "caseRef", "case_ref"],
        EventDomain::SarFiling => &["sarRef", "sar_ref", "ref"],
        EventDomain::GoamlFiling => &["filingRef", "filing_ref", "ref"],
        _ => &["ref", "subjectRef", "id"],
    };
    for key in candidates.iter() {
        if let Some(v) = payload.get(key).and_then(|v| v.as_str()) {
            return v.to_string();
        }
    }
    format!("unknown-{}", uuid::Uuid::new_v4())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_topic_routing() {
        assert_eq!(
            topic_to_domain("bis.aml.alerts"),
            Some(EventDomain::AmlAlert)
        );
        assert_eq!(
            topic_to_domain("bis.transaction.events"),
            Some(EventDomain::Transaction)
        );
        assert_eq!(
            topic_to_domain("bis.sar.events"),
            Some(EventDomain::SarFiling)
        );
        assert_eq!(topic_to_domain("unknown.topic"), None);
    }

    #[test]
    fn test_enriched_topic() {
        assert_eq!(enriched_topic(&EventDomain::AmlAlert), "bis.aml.enriched");
        assert_eq!(
            enriched_topic(&EventDomain::Transaction),
            "bis.transaction.enriched"
        );
    }

    #[test]
    fn test_extract_subject_ref() {
        let payload = serde_json::json!({ "alertRef": "AML-123", "amount": 5000 });
        assert_eq!(
            extract_subject_ref(&EventDomain::AmlAlert, &payload),
            "AML-123"
        );
    }
}
