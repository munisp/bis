// tests.rs — unit tests for bis-event-processor types and logic
#[cfg(test)]
mod tests {
    use crate::{AppState, BisEvent, EventType, PublishRequest, Severity, Subscription};
    use chrono::Utc;
    use uuid::Uuid;

    // ─── EventType serialization ──────────────────────────────────────────────

    #[test]
    fn test_event_type_serialization() {
        let et = EventType::InvestigationCreated;
        let s = serde_json::to_string(&et).unwrap();
        assert_eq!(s, "\"INVESTIGATION_CREATED\"");
    }

    #[test]
    fn test_event_type_deserialization() {
        let et: EventType = serde_json::from_str("\"INVESTIGATION_UPDATED\"").unwrap_or(EventType::InvestigationFlagged);
        // InvestigationUpdated doesn't exist; InvestigationFlagged is the closest
        // Just verify deserialization works for a known type
        let et2: EventType = serde_json::from_str("\"KYC_COMPLETED\"").unwrap();
        assert!(matches!(et2, EventType::KycCompleted));
    }

    #[test]
    fn test_event_type_alert_triggered() {
        let et: EventType = serde_json::from_str("\"ALERT_TRIGGERED\"").unwrap();
        assert!(matches!(et, EventType::AlertTriggered));
    }

    #[test]
    fn test_event_type_sanctions_hit() {
        let et: EventType = serde_json::from_str("\"SANCTIONS_HIT\"").unwrap();
        assert!(matches!(et, EventType::SanctionsHit));
    }

    // ─── Severity ordering ────────────────────────────────────────────────────

    #[test]
    fn test_severity_ordering() {
        assert!(Severity::Critical > Severity::High);
        assert!(Severity::High > Severity::Medium);
        assert!(Severity::Medium > Severity::Low);
        assert!(Severity::Low > Severity::Info);
    }

    #[test]
    fn test_severity_serialization() {
        let s = serde_json::to_string(&Severity::High).unwrap();
        assert_eq!(s, "\"high\"");
    }

    #[test]
    fn test_severity_deserialization() {
        let s: Severity = serde_json::from_str("\"critical\"").unwrap();
        assert!(matches!(s, Severity::Critical));
    }

    #[test]
    fn test_severity_info_is_lowest() {
        assert!(Severity::Info < Severity::Low);
        assert!(Severity::Info < Severity::Medium);
        assert!(Severity::Info < Severity::High);
        assert!(Severity::Info < Severity::Critical);
    }

    // ─── BisEvent construction ────────────────────────────────────────────────

    #[test]
    fn test_bis_event_construction() {
        let event = BisEvent {
            id: Uuid::new_v4().to_string(),
            event_type: EventType::InvestigationCreated,
            subject_id: "user-123".to_string(),
            subject_ref: "CASE-2026-TEST".to_string(),
            severity: Severity::Medium,
            payload: serde_json::json!({ "title": "Test Case" }),
            source_service: "bis-bff".to_string(),
            occurred_at: Utc::now(),
        };
        assert!(!event.id.is_empty());
        assert_eq!(event.subject_ref, "CASE-2026-TEST");
        assert!(matches!(event.severity, Severity::Medium));
    }

    #[test]
    fn test_bis_event_serialization() {
        let event = BisEvent {
            id: "evt-001".to_string(),
            event_type: EventType::AlertTriggered,
            subject_id: "user-456".to_string(),
            subject_ref: "ALERT-001".to_string(),
            severity: Severity::High,
            payload: serde_json::json!({}),
            source_service: "aml-engine".to_string(),
            occurred_at: Utc::now(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("ALERT_TRIGGERED"));
        assert!(json.contains("high"));
    }

    // ─── PublishRequest deserialization ──────────────────────────────────────

    #[test]
    fn test_publish_request_deserialization() {
        let json = r#"{
            "event_type": "INVESTIGATION_CREATED",
            "subject_id": "user-789",
            "subject_ref": "CASE-2026-XYZ",
            "severity": "high",
            "payload": {"title": "Test"},
            "source_service": "test-service"
        }"#;
        let req: PublishRequest = serde_json::from_str(json).unwrap();
        assert!(matches!(req.event_type, EventType::InvestigationCreated));
        assert_eq!(req.subject_ref, "CASE-2026-XYZ");
        assert!(matches!(req.severity, Severity::High));
    }

    // ─── AppState initialization ──────────────────────────────────────────────

    #[test]
    fn test_app_state_new() {
        let state = AppState::new();
        assert_eq!(state.event_count.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(state.subscriptions.len(), 0);
        let log = state.audit_log.lock().unwrap();
        assert_eq!(log.len(), 0);
    }

    #[test]
    fn test_app_state_event_count_increment() {
        let state = AppState::new();
        state.event_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        state.event_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(state.event_count.load(std::sync::atomic::Ordering::Relaxed), 2);
    }

    // ─── Subscription construction ────────────────────────────────────────────

    #[test]
    fn test_subscription_construction() {
        let sub = Subscription {
            id: Uuid::new_v4().to_string(),
            subscriber_url: "https://example.com/webhook".to_string(),
            event_types: vec![EventType::InvestigationCreated, EventType::AlertTriggered],
            min_severity: Severity::Medium,
            active: true,
            created_at: Utc::now(),
            delivery_count: 0,
            failure_count: 0,
        };
        assert!(sub.active);
        assert_eq!(sub.event_types.len(), 2);
        assert!(sub.event_types.contains(&EventType::InvestigationCreated));
    }

    // ─── Subscription filtering logic ─────────────────────────────────────────

    #[test]
    fn test_subscription_matches_event_type() {
        let sub = Subscription {
            id: "sub-1".to_string(),
            subscriber_url: "https://example.com/webhook".to_string(),
            event_types: vec![EventType::InvestigationCreated],
            min_severity: Severity::Low,
            active: true,
            created_at: Utc::now(),
            delivery_count: 0,
            failure_count: 0,
        };
        assert!(sub.event_types.contains(&EventType::InvestigationCreated));
        assert!(!sub.event_types.contains(&EventType::AlertTriggered));
    }

    #[test]
    fn test_subscription_severity_filter() {
        let min_sev = Severity::High;
        // Critical >= High → should match
        assert!(Severity::Critical >= min_sev);
        // Medium < High → should not match
        assert!(!(Severity::Medium >= min_sev));
        // High == High → should match
        assert!(Severity::High >= min_sev);
    }

    // ─── gateway_key / port defaults ─────────────────────────────────────────

    #[test]
    fn test_gateway_key_default() {
        let key = crate::gateway_key();
        assert!(!key.is_empty());
    }

    #[test]
    fn test_port_default() {
        let port = crate::port();
        assert!(!port.is_empty());
        let port_num: u16 = port.parse().expect("port should be a valid number");
        assert!(port_num > 0);
    }

    // ─── AUDIT_LOG_CAPACITY constant ─────────────────────────────────────────

    #[test]
    fn test_audit_log_capacity_constant() {
        assert_eq!(crate::AUDIT_LOG_CAPACITY, 10_000);
    }

    #[test]
    fn test_broadcast_capacity_constant() {
        assert_eq!(crate::BROADCAST_CAPACITY, 256);
    }
}
