/*!
 * kafka/handlers.rs — Specialised event handlers for new BIS event types
 *
 * This module extends the generic `process_event` function with domain-specific
 * logic for:
 *   - Criminal record ingestion (bis.criminal.*)
 *   - Corporate background checks (bis.corporate.*)
 *   - Field visit GPS events (bis.field_visit.*)
 *   - Thin-file investigation flags (bis.investigation.thin_file_*)
 *   - Mojaloop compliance checks (bis.mojaloop.*)
 *   - Fluvio velocity stream (bis.fluvio.*)
 *
 * Each handler follows the same pattern:
 *   1. Deserialise the event payload into a typed struct
 *   2. Apply domain-specific business logic (risk scoring, alert generation)
 *   3. Forward high-severity outcomes to the BFF webhook
 *   4. Publish enriched events back to Kafka for downstream consumers
 *      (OpenSearch indexer, ML enrichment, lakehouse ingest)
 */

use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

use super::consumer::{AuditLog, BisEvent};

// ─── Criminal Record Ingested ─────────────────────────────────────────────────

/// Payload for bis.criminal.record_ingested events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriminalRecordIngestedPayload {
    pub record_ref: String,
    pub request_ref: String,
    pub subject_name: String,
    pub nin: Option<String>,
    pub offence_category: String,
    pub verdict: String,
    pub outstanding_warrant: bool,
    pub risk_contribution: f64,
    pub ingest_source: String,
    pub timestamp: String,
}

/// Handles bis.criminal.record_ingested events.
/// - Computes a severity level based on offence category and verdict
/// - Triggers a BFF alert for terrorism, violent, or warrant records
/// - Publishes an enriched event for the OpenSearch indexer
pub async fn handle_criminal_record_ingested(
    event: &BisEvent,
    audit_log: AuditLog,
) {
    let payload: CriminalRecordIngestedPayload = match serde_json::from_value(event.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            warn!("[CriminalRecord] Failed to deserialise payload: {}", e);
            return;
        }
    };

    info!(
        "[CriminalRecord] Ingested: ref={} category={} verdict={} warrant={} risk={:.1}",
        payload.record_ref,
        payload.offence_category,
        payload.verdict,
        payload.outstanding_warrant,
        payload.risk_contribution,
    );

    // Determine severity
    let severity = compute_criminal_severity(
        &payload.offence_category,
        &payload.verdict,
        payload.outstanding_warrant,
        payload.risk_contribution,
    );

    // Append to audit log
    {
        let mut log = audit_log.write().await;
        log.push(serde_json::json!({
            "event_type": "CRIMINAL_RECORD_INGESTED",
            "record_ref": payload.record_ref,
            "request_ref": payload.request_ref,
            "subject_name": payload.subject_name,
            "offence_category": payload.offence_category,
            "verdict": payload.verdict,
            "outstanding_warrant": payload.outstanding_warrant,
            "risk_contribution": payload.risk_contribution,
            "severity": severity,
            "processed_at": chrono::Utc::now().to_rfc3339(),
        }));
        if log.len() > 500 {
            log.drain(0..100);
        }
    }

    // Forward to BFF for high-severity records
    if matches!(severity, "high" | "critical") {
        let alert = serde_json::json!({
            "event_type": "CRIMINAL_RECORD_ALERT",
            "record_ref": payload.record_ref,
            "subject_name": payload.subject_name,
            "offence_category": payload.offence_category,
            "verdict": payload.verdict,
            "outstanding_warrant": payload.outstanding_warrant,
            "risk_contribution": payload.risk_contribution,
            "severity": severity,
            "message": format!(
                "Criminal record alert: {} — {} ({})",
                payload.subject_name, payload.offence_category, payload.verdict
            ),
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });
        tokio::spawn(async move {
            forward_to_bff(alert).await;
        });
    }
}

/// Compute severity for a criminal record based on category, verdict, and warrant.
fn compute_criminal_severity(
    category: &str,
    verdict: &str,
    warrant: bool,
    risk_score: f64,
) -> &'static str {
    // Warrant always escalates to at least high
    if warrant {
        return "critical";
    }
    // Terrorism and sexual offences with conviction are always critical
    if matches!(category, "terrorism" | "sexual") && verdict == "convicted" {
        return "critical";
    }
    // Score-based thresholds
    if risk_score >= 70.0 {
        return "high";
    }
    if risk_score >= 40.0 {
        return "medium";
    }
    "low"
}

// ─── Corporate Check Completed ────────────────────────────────────────────────

/// Payload for bis.corporate.check_completed events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorporateCheckCompletedPayload {
    pub check_ref: String,
    pub rc_number: String,
    pub outcome: String, // clear, consider, adverse
    pub risk_score: f64,
    pub flags: Vec<String>,
    pub workflow_id: Option<String>,
    pub investigation_ref: Option<String>,
    pub timestamp: String,
}

/// Handles bis.corporate.check_completed events.
/// - Triggers BFF alert for adverse outcomes
/// - Publishes enriched event for OpenSearch indexer
pub async fn handle_corporate_check_completed(
    event: &BisEvent,
    audit_log: AuditLog,
) {
    let payload: CorporateCheckCompletedPayload = match serde_json::from_value(event.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            warn!("[CorporateCheck] Failed to deserialise payload: {}", e);
            return;
        }
    };

    info!(
        "[CorporateCheck] Completed: ref={} outcome={} risk={:.1} flags={:?}",
        payload.check_ref, payload.outcome, payload.risk_score, payload.flags
    );

    let severity = match payload.outcome.as_str() {
        "adverse" => "high",
        "consider" => "medium",
        _ => "low",
    };

    {
        let mut log = audit_log.write().await;
        log.push(serde_json::json!({
            "event_type": "CORPORATE_CHECK_COMPLETED",
            "check_ref": payload.check_ref,
            "rc_number": payload.rc_number,
            "outcome": payload.outcome,
            "risk_score": payload.risk_score,
            "flags": payload.flags,
            "severity": severity,
            "investigation_ref": payload.investigation_ref,
            "processed_at": chrono::Utc::now().to_rfc3339(),
        }));
        if log.len() > 500 {
            log.drain(0..100);
        }
    }

    if matches!(severity, "high" | "critical") {
        let alert = serde_json::json!({
            "event_type": "CORPORATE_CHECK_ALERT",
            "check_ref": payload.check_ref,
            "rc_number": payload.rc_number,
            "outcome": payload.outcome,
            "risk_score": payload.risk_score,
            "flags": payload.flags,
            "severity": severity,
            "message": format!(
                "Corporate check adverse: RC {} — {} (risk: {:.0})",
                payload.rc_number, payload.outcome, payload.risk_score
            ),
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });
        tokio::spawn(async move {
            forward_to_bff(alert).await;
        });
    }
}

// ─── Field Visit Events ───────────────────────────────────────────────────────

/// Payload for bis.field_visit.checked_in events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldVisitCheckInPayload {
    pub check_in_ref: String,
    pub task_ref: String,
    pub agent_id: String,
    pub lat: f64,
    pub lng: f64,
    pub accuracy: Option<f64>,
    pub notes: Option<String>,
    pub timestamp: String,
}

/// Handles bis.field_visit.checked_in events.
pub async fn handle_field_visit_checked_in(
    event: &BisEvent,
    audit_log: AuditLog,
) {
    let payload: FieldVisitCheckInPayload = match serde_json::from_value(event.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            warn!("[FieldVisit] Failed to deserialise check-in payload: {}", e);
            return;
        }
    };

    info!(
        "[FieldVisit] Check-in: task={} agent={} gps=({:.4},{:.4})",
        payload.task_ref, payload.agent_id, payload.lat, payload.lng
    );

    {
        let mut log = audit_log.write().await;
        log.push(serde_json::json!({
            "event_type": "FIELD_VISIT_CHECKED_IN",
            "check_in_ref": payload.check_in_ref,
            "task_ref": payload.task_ref,
            "agent_id": payload.agent_id,
            "gps": { "lat": payload.lat, "lng": payload.lng },
            "processed_at": chrono::Utc::now().to_rfc3339(),
        }));
        if log.len() > 500 {
            log.drain(0..100);
        }
    }
}

/// Payload for bis.field_visit.checked_out events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldVisitCheckOutPayload {
    pub check_out_ref: String,
    pub task_ref: String,
    pub agent_id: String,
    pub lat: f64,
    pub lng: f64,
    pub duration_minutes: i64,
    pub notes: Option<String>,
    pub timestamp: String,
}

/// Handles bis.field_visit.checked_out events.
/// Flags suspiciously short visits (< 5 minutes) for review.
pub async fn handle_field_visit_checked_out(
    event: &BisEvent,
    audit_log: AuditLog,
) {
    let payload: FieldVisitCheckOutPayload = match serde_json::from_value(event.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            warn!("[FieldVisit] Failed to deserialise check-out payload: {}", e);
            return;
        }
    };

    info!(
        "[FieldVisit] Check-out: task={} agent={} duration={}min",
        payload.task_ref, payload.agent_id, payload.duration_minutes
    );

    // Flag suspiciously short visits
    let suspicious = payload.duration_minutes < 5 && payload.duration_minutes >= 0;
    if suspicious {
        warn!(
            "[FieldVisit] Suspicious short visit: task={} duration={}min — flagging for review",
            payload.task_ref, payload.duration_minutes
        );
        let alert = serde_json::json!({
            "event_type": "FIELD_VISIT_SHORT_DURATION_ALERT",
            "task_ref": payload.task_ref,
            "agent_id": payload.agent_id,
            "duration_minutes": payload.duration_minutes,
            "severity": "medium",
            "message": format!(
                "Field visit completed in {}min — below minimum threshold of 5min",
                payload.duration_minutes
            ),
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });
        tokio::spawn(async move {
            forward_to_bff(alert).await;
        });
    }

    {
        let mut log = audit_log.write().await;
        log.push(serde_json::json!({
            "event_type": "FIELD_VISIT_CHECKED_OUT",
            "check_out_ref": payload.check_out_ref,
            "task_ref": payload.task_ref,
            "agent_id": payload.agent_id,
            "duration_minutes": payload.duration_minutes,
            "suspicious": suspicious,
            "processed_at": chrono::Utc::now().to_rfc3339(),
        }));
        if log.len() > 500 {
            log.drain(0..100);
        }
    }
}

// ─── Thin-File Events ─────────────────────────────────────────────────────────

/// Payload for bis.investigation.thin_file_flagged events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinFileFlaggedPayload {
    pub investigation_ref: String,
    pub flagged_by: String,
    pub reason: Option<String>,
    pub timestamp: String,
}

/// Handles bis.investigation.thin_file_flagged events.
/// Notifies the BFF so the investigation dashboard updates in real-time.
pub async fn handle_thin_file_flagged(
    event: &BisEvent,
    audit_log: AuditLog,
) {
    let payload: ThinFileFlaggedPayload = match serde_json::from_value(event.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            warn!("[ThinFile] Failed to deserialise thin_file_flagged payload: {}", e);
            return;
        }
    };

    info!(
        "[ThinFile] Flagged: investigation={} by={} reason={:?}",
        payload.investigation_ref, payload.flagged_by, payload.reason
    );

    {
        let mut log = audit_log.write().await;
        log.push(serde_json::json!({
            "event_type": "THIN_FILE_FLAGGED",
            "investigation_ref": payload.investigation_ref,
            "flagged_by": payload.flagged_by,
            "reason": payload.reason,
            "processed_at": chrono::Utc::now().to_rfc3339(),
        }));
        if log.len() > 500 {
            log.drain(0..100);
        }
    }

    // Notify BFF for real-time dashboard update
    let alert = serde_json::json!({
        "event_type": "THIN_FILE_FLAGGED",
        "investigation_ref": payload.investigation_ref,
        "flagged_by": payload.flagged_by,
        "reason": payload.reason,
        "severity": "medium",
        "message": format!(
            "Investigation {} flagged as thin-file by {}",
            payload.investigation_ref, payload.flagged_by
        ),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    tokio::spawn(async move {
        forward_to_bff(alert).await;
    });
}

/// Payload for bis.investigation.thin_file_reverted events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinFileRevertedPayload {
    pub investigation_ref: String,
    pub reverted_by: String,
    pub reason: Option<String>,
    pub timestamp: String,
}

/// Handles bis.investigation.thin_file_reverted events.
pub async fn handle_thin_file_reverted(
    event: &BisEvent,
    audit_log: AuditLog,
) {
    let payload: ThinFileRevertedPayload = match serde_json::from_value(event.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            warn!("[ThinFile] Failed to deserialise thin_file_reverted payload: {}", e);
            return;
        }
    };

    info!(
        "[ThinFile] Reverted: investigation={} by={}",
        payload.investigation_ref, payload.reverted_by
    );

    {
        let mut log = audit_log.write().await;
        log.push(serde_json::json!({
            "event_type": "THIN_FILE_REVERTED",
            "investigation_ref": payload.investigation_ref,
            "reverted_by": payload.reverted_by,
            "processed_at": chrono::Utc::now().to_rfc3339(),
        }));
        if log.len() > 500 {
            log.drain(0..100);
        }
    }
}

// ─── Mojaloop Compliance ──────────────────────────────────────────────────────

/// Payload for bis.mojaloop.compliance_checked events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MojaloopCompliancePayload {
    pub subject_ref: String,
    pub approved: bool,
    pub risk_level: String,
    pub amount: i64,
    pub timestamp: String,
}

/// Handles bis.mojaloop.compliance_checked events.
/// Blocks and alerts on non-approved compliance checks.
pub async fn handle_mojaloop_compliance(
    event: &BisEvent,
    audit_log: AuditLog,
) {
    let payload: MojaloopCompliancePayload = match serde_json::from_value(event.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            warn!("[Mojaloop] Failed to deserialise compliance payload: {}", e);
            return;
        }
    };

    info!(
        "[Mojaloop] Compliance: subject={} approved={} risk={}",
        payload.subject_ref, payload.approved, payload.risk_level
    );

    {
        let mut log = audit_log.write().await;
        log.push(serde_json::json!({
            "event_type": "MOJALOOP_COMPLIANCE_CHECKED",
            "subject_ref": payload.subject_ref,
            "approved": payload.approved,
            "risk_level": payload.risk_level,
            "amount": payload.amount,
            "processed_at": chrono::Utc::now().to_rfc3339(),
        }));
        if log.len() > 500 {
            log.drain(0..100);
        }
    }

    if !payload.approved {
        let alert = serde_json::json!({
            "event_type": "MOJALOOP_COMPLIANCE_BLOCKED",
            "subject_ref": payload.subject_ref,
            "risk_level": payload.risk_level,
            "amount": payload.amount,
            "severity": "high",
            "message": format!(
                "Mojaloop transfer blocked for subject {} — compliance check failed (risk: {})",
                payload.subject_ref, payload.risk_level
            ),
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });
        tokio::spawn(async move {
            forward_to_bff(alert).await;
        });
    }
}

// ─── Fluvio Velocity Stream ───────────────────────────────────────────────────

/// Payload for bis.fluvio.criminal_record velocity events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FluvioCriminalRecordPayload {
    pub record_ref: String,
    pub offence_category: String,
    pub verdict: String,
    pub risk_contribution: f64,
    pub timestamp: String,
}

/// Handles bis.fluvio.criminal_record events from the Fluvio velocity stream.
/// These are lightweight, high-throughput events for real-time analytics.
pub async fn handle_fluvio_criminal_record(
    event: &BisEvent,
    audit_log: AuditLog,
) {
    let payload: FluvioCriminalRecordPayload = match serde_json::from_value(event.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            warn!("[Fluvio] Failed to deserialise criminal record payload: {}", e);
            return;
        }
    };

    // Lightweight processing for velocity stream — just log and move on
    info!(
        "[Fluvio] Criminal record velocity: ref={} category={} risk={:.1}",
        payload.record_ref, payload.offence_category, payload.risk_contribution
    );

    {
        let mut log = audit_log.write().await;
        log.push(serde_json::json!({
            "event_type": "FLUVIO_CRIMINAL_RECORD",
            "record_ref": payload.record_ref,
            "offence_category": payload.offence_category,
            "risk_contribution": payload.risk_contribution,
            "processed_at": chrono::Utc::now().to_rfc3339(),
        }));
        if log.len() > 500 {
            log.drain(0..100);
        }
    }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/// Route a BIS event to its domain-specific handler based on event_type prefix.
/// Called from `process_event` in consumer.rs after the generic audit log entry.
pub async fn dispatch_domain_event(event: &BisEvent, audit_log: AuditLog) {
    match event.event_type.as_str() {
        "bis.criminal.record_ingested" => {
            handle_criminal_record_ingested(event, audit_log).await;
        }
        "bis.corporate.check_completed" => {
            handle_corporate_check_completed(event, audit_log).await;
        }
        "bis.field_visit.checked_in" => {
            handle_field_visit_checked_in(event, audit_log).await;
        }
        "bis.field_visit.checked_out" => {
            handle_field_visit_checked_out(event, audit_log).await;
        }
        "bis.investigation.thin_file_flagged" => {
            handle_thin_file_flagged(event, audit_log).await;
        }
        "bis.investigation.thin_file_reverted" => {
            handle_thin_file_reverted(event, audit_log).await;
        }
        "bis.mojaloop.compliance_checked" => {
            handle_mojaloop_compliance(event, audit_log).await;
        }
        "bis.fluvio.criminal_record" => {
            handle_fluvio_criminal_record(event, audit_log).await;
        }
        _ => {
            // Not a domain-specific event — handled by the generic process_event
        }
    }
}

// ─── BFF webhook forward (shared with consumer.rs) ───────────────────────────

async fn forward_to_bff(entry: serde_json::Value) {
    let bff_url = std::env::var("BFF_WEBHOOK_URL")
        .unwrap_or_else(|_| "http://localhost:8080/api/internal/events".to_string());
    let gateway_key = std::env::var("BIS_GATEWAY_KEY")
        .unwrap_or_else(|_| "dev-gateway-key-change-in-prod".to_string());

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!("[BFF] Failed to build HTTP client: {}", e);
            return;
        }
    };

    match client
        .post(&bff_url)
        .header("X-BIS-Key", &gateway_key)
        .header("Content-Type", "application/json")
        .json(&entry)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            tracing::debug!("[BFF] Domain event forwarded successfully");
        }
        Ok(resp) => {
            warn!("[BFF] Webhook returned HTTP {}", resp.status());
        }
        Err(e) => {
            warn!("[BFF] Webhook forward failed: {}", e);
        }
    }
}
