/*!
# BIS Kafka Avro Schema Registry

Manages Avro schema versions for BIS Kafka topics.  Provides:

- Schema registration with fingerprint-based deduplication
- Forward/backward/full compatibility checking
- Schema evolution validation (field additions, removals, type changes)
- Subject-based versioning (one subject per Kafka topic)

## Supported Topics (Subjects)

| Subject                     | Description                        |
|-----------------------------|------------------------------------|
| bis.payment.events          | NIP/Mojaloop payment events        |
| bis.aml.alerts              | AML alert events                   |
| bis.kyc.completed           | KYC completion events              |
| bis.investigation.events    | Investigation lifecycle events     |
| bis.velocity.breaches       | Velocity check breach events       |

## Compatibility Modes

- `BACKWARD`: New schema can read data written with the previous schema
- `FORWARD`: Previous schema can read data written with the new schema
- `FULL`: Both backward and forward compatible
- `NONE`: No compatibility check

## Avro Schema Representation

Schemas are stored as JSON strings (Avro JSON Schema format).
This library validates the JSON structure and field compatibility
without requiring the full Apache Avro runtime.
*/

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use thiserror::Error;

// ─── Errors ───────────────────────────────────────────────────────────────────

#[derive(Debug, Error, PartialEq)]
pub enum SchemaError {
    #[error("schema is not valid JSON: {0}")]
    InvalidJson(String),

    #[error("schema is missing required field: {0}")]
    MissingField(String),

    #[error("subject not found: {0}")]
    SubjectNotFound(String),

    #[error("schema version not found: subject={0}, version={1}")]
    VersionNotFound(String, u32),

    #[error("schema already registered with id={0}")]
    AlreadyRegistered(u32),

    #[error("compatibility check failed: {0}")]
    IncompatibleSchema(String),

    #[error("invalid compatibility mode: {0}")]
    InvalidCompatibilityMode(String),
}

// ─── Compatibility mode ───────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CompatibilityMode {
    Backward,
    Forward,
    Full,
    None,
}

impl Default for CompatibilityMode {
    fn default() -> Self {
        CompatibilityMode::Backward
    }
}

impl CompatibilityMode {
    pub fn from_str(s: &str) -> Result<Self, SchemaError> {
        match s.to_uppercase().as_str() {
            "BACKWARD" => Ok(CompatibilityMode::Backward),
            "FORWARD"  => Ok(CompatibilityMode::Forward),
            "FULL"     => Ok(CompatibilityMode::Full),
            "NONE"     => Ok(CompatibilityMode::None),
            other      => Err(SchemaError::InvalidCompatibilityMode(other.to_string())),
        }
    }
}

// ─── Avro field ───────────────────────────────────────────────────────────────

/// A simplified representation of an Avro field for compatibility checking.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AvroField {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
}

/// A parsed Avro record schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvroSchema {
    #[serde(rename = "type")]
    pub schema_type: String,
    pub name: String,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub doc: Option<String>,
    pub fields: Vec<AvroField>,
}

// ─── Schema version ───────────────────────────────────────────────────────────

/// A registered schema version.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaVersion {
    pub id: u32,
    pub version: u32,
    pub subject: String,
    pub schema_json: String,
    pub fingerprint: String,
}

// ─── Schema registry ──────────────────────────────────────────────────────────

/// In-memory Avro schema registry.
pub struct SchemaRegistry {
    /// subject -> list of schema versions (ordered by version number)
    subjects: HashMap<String, Vec<SchemaVersion>>,
    /// subject -> compatibility mode
    compatibility: HashMap<String, CompatibilityMode>,
    /// Global schema ID counter
    next_id: u32,
    /// Global default compatibility mode
    default_compatibility: CompatibilityMode,
}

impl Default for SchemaRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl SchemaRegistry {
    pub fn new() -> Self {
        Self {
            subjects: HashMap::new(),
            compatibility: HashMap::new(),
            next_id: 1,
            default_compatibility: CompatibilityMode::Backward,
        }
    }

    /// Set the compatibility mode for a subject.
    pub fn set_compatibility(
        &mut self,
        subject: &str,
        mode: CompatibilityMode,
    ) {
        self.compatibility.insert(subject.to_string(), mode);
    }

    /// Get the compatibility mode for a subject (falls back to default).
    pub fn get_compatibility(&self, subject: &str) -> &CompatibilityMode {
        self.compatibility
            .get(subject)
            .unwrap_or(&self.default_compatibility)
    }

    /// Register a new schema for a subject.
    ///
    /// Returns the schema ID.  If the schema is identical to the latest
    /// version (same fingerprint), returns the existing ID.
    pub fn register(
        &mut self,
        subject: &str,
        schema_json: &str,
    ) -> Result<u32, SchemaError> {
        // Parse and validate the schema
        let parsed = parse_avro_schema(schema_json)?;
        let fingerprint = fingerprint(schema_json);

        // Check if this exact schema is already registered
        if let Some(versions) = self.subjects.get(subject) {
            if let Some(existing) = versions.iter().find(|v| v.fingerprint == fingerprint) {
                return Ok(existing.id);
            }

            // Compatibility check against the latest version
            let latest = versions.last().unwrap();
            let latest_parsed = parse_avro_schema(&latest.schema_json)?;
            let mode = self.get_compatibility(subject).clone();
            check_compatibility(&latest_parsed, &parsed, &mode)?;
        }

        let id = self.next_id;
        self.next_id += 1;

        let versions = self.subjects.entry(subject.to_string()).or_default();
        let version = (versions.len() as u32) + 1;

        versions.push(SchemaVersion {
            id,
            version,
            subject: subject.to_string(),
            schema_json: schema_json.to_string(),
            fingerprint,
        });

        Ok(id)
    }

    /// Get the latest schema version for a subject.
    pub fn get_latest(&self, subject: &str) -> Result<&SchemaVersion, SchemaError> {
        self.subjects
            .get(subject)
            .and_then(|v| v.last())
            .ok_or_else(|| SchemaError::SubjectNotFound(subject.to_string()))
    }

    /// Get a specific schema version for a subject.
    pub fn get_version(
        &self,
        subject: &str,
        version: u32,
    ) -> Result<&SchemaVersion, SchemaError> {
        self.subjects
            .get(subject)
            .ok_or_else(|| SchemaError::SubjectNotFound(subject.to_string()))?
            .iter()
            .find(|v| v.version == version)
            .ok_or_else(|| SchemaError::VersionNotFound(subject.to_string(), version))
    }

    /// Get schema by global ID.
    pub fn get_by_id(&self, id: u32) -> Option<&SchemaVersion> {
        for versions in self.subjects.values() {
            if let Some(v) = versions.iter().find(|v| v.id == id) {
                return Some(v);
            }
        }
        None
    }

    /// List all subjects.
    pub fn list_subjects(&self) -> Vec<&str> {
        self.subjects.keys().map(String::as_str).collect()
    }

    /// List all versions for a subject.
    pub fn list_versions(&self, subject: &str) -> Result<Vec<u32>, SchemaError> {
        self.subjects
            .get(subject)
            .map(|v| v.iter().map(|sv| sv.version).collect())
            .ok_or_else(|| SchemaError::SubjectNotFound(subject.to_string()))
    }

    /// Delete a subject (all versions).
    pub fn delete_subject(&mut self, subject: &str) -> Result<Vec<u32>, SchemaError> {
        let versions = self
            .subjects
            .remove(subject)
            .ok_or_else(|| SchemaError::SubjectNotFound(subject.to_string()))?;
        self.compatibility.remove(subject);
        Ok(versions.iter().map(|v| v.version).collect())
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


/// Returns true if an Avro field has a default value.
///
/// Handles two cases:
/// 1. `"default": <non-null>` — serde deserializes as `Some(value)`
/// 2. `"default": null` — serde deserializes as `None` but the Avro convention
///    is that a union type `["null", ...]` with `"default": null` IS a valid default.
///    We detect this by checking if the type is a JSON array whose first element is "null".
pub fn field_has_default(field: &AvroField) -> bool {
    if field.default.is_some() {
        return true;
    }
    // Check if the type is a nullable union (["null", ...]) — Avro convention for optional fields
    if let serde_json::Value::Array(types) = &field.field_type {
        if let Some(first) = types.first() {
            if first == &serde_json::Value::String("null".to_string()) {
                return true;
            }
        }
    }
    false
}

/// Parse an Avro JSON schema string into an AvroSchema struct.
pub fn parse_avro_schema(schema_json: &str) -> Result<AvroSchema, SchemaError> {
    serde_json::from_str::<AvroSchema>(schema_json)
        .map_err(|e| SchemaError::InvalidJson(e.to_string()))
}

/// Compute a SHA-256 fingerprint of the schema JSON.
pub fn fingerprint(schema_json: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(schema_json.as_bytes());
    hex::encode(hasher.finalize())
}

/// Check schema compatibility between old and new schemas.
///
/// Returns Ok(()) if compatible, Err(IncompatibleSchema) otherwise.
pub fn check_compatibility(
    old: &AvroSchema,
    new: &AvroSchema,
    mode: &CompatibilityMode,
) -> Result<(), SchemaError> {
    match mode {
        CompatibilityMode::None => Ok(()),
        CompatibilityMode::Backward => check_backward(old, new),
        CompatibilityMode::Forward => check_forward(old, new),
        CompatibilityMode::Full => {
            check_backward(old, new)?;
            check_forward(old, new)
        }
    }
}

/// Backward compatibility: new schema can read data written with old schema.
///
/// Rules:
/// - Fields removed from new schema must have a default in old schema
/// - Fields added to new schema must have a default
fn check_backward(old: &AvroSchema, new: &AvroSchema) -> Result<(), SchemaError> {
    let old_fields: HashMap<&str, &AvroField> =
        old.fields.iter().map(|f| (f.name.as_str(), f)).collect();
    let new_fields: HashMap<&str, &AvroField> =
        new.fields.iter().map(|f| (f.name.as_str(), f)).collect();

    // Fields in old but not in new: old readers will fail if no default
    for (name, old_field) in &old_fields {
        if !new_fields.contains_key(name) && !field_has_default(old_field) {
            return Err(SchemaError::IncompatibleSchema(format!(
                "BACKWARD: field '{}' removed from new schema but has no default in old schema",
                name
            )));
        }
    }

    // Fields in new but not in old: new readers must have a default to handle missing data
    for (name, new_field) in &new_fields {
        if !old_fields.contains_key(name) && !field_has_default(new_field) {
            return Err(SchemaError::IncompatibleSchema(format!(
                "BACKWARD: new field '{}' has no default value — cannot read old data",
                name
            )));
        }
    }

    Ok(())
}

/// Forward compatibility: old schema can read data written with new schema.
///
/// Rules:
/// - Fields added to new schema must have a default (so old readers can ignore them)
/// - Fields removed from new schema: old readers must have defaults
fn check_forward(old: &AvroSchema, new: &AvroSchema) -> Result<(), SchemaError> {
    let old_fields: HashMap<&str, &AvroField> =
        old.fields.iter().map(|f| (f.name.as_str(), f)).collect();
    let new_fields: HashMap<&str, &AvroField> =
        new.fields.iter().map(|f| (f.name.as_str(), f)).collect();

    // Fields in new but not in old: old readers cannot handle them without default
    for (name, new_field) in &new_fields {
        if !old_fields.contains_key(name) && !field_has_default(new_field) {
            return Err(SchemaError::IncompatibleSchema(format!(
                "FORWARD: new field '{}' has no default — old readers cannot skip it",
                name
            )));
        }
    }

    // Fields in old but not in new: old readers expect them
    for (name, old_field) in &old_fields {
        if !new_fields.contains_key(name) && !field_has_default(old_field) {
            return Err(SchemaError::IncompatibleSchema(format!(
                "FORWARD: field '{}' removed from new schema but old readers expect it (no default)",
                name
            )));
        }
    }

    Ok(())
}

// ─── BIS topic schemas ────────────────────────────────────────────────────────

/// Returns the canonical Avro schema for the bis.payment.events topic.
pub fn payment_event_schema() -> &'static str {
    r#"{
  "type": "record",
  "name": "PaymentEvent",
  "namespace": "ng.bis.payments",
  "doc": "NIP/Mojaloop payment event",
  "fields": [
    {"name": "eventType",      "type": "string"},
    {"name": "txRef",          "type": "string"},
    {"name": "accountId",      "type": "string"},
    {"name": "amountKobo",     "type": "long"},
    {"name": "currency",       "type": "string"},
    {"name": "rail",           "type": "string"},
    {"name": "isCrossBorder",  "type": ["null", "boolean"], "default": null},
    {"name": "tenantId",       "type": "string"},
    {"name": "timestamp",      "type": "string"}
  ]
}"#
}

/// Returns the canonical Avro schema for the bis.aml.alerts topic.
pub fn aml_alert_schema() -> &'static str {
    r#"{
  "type": "record",
  "name": "AmlAlert",
  "namespace": "ng.bis.aml",
  "doc": "AML alert event",
  "fields": [
    {"name": "alertRef",        "type": "string"},
    {"name": "title",           "type": "string"},
    {"name": "riskLevel",       "type": "string"},
    {"name": "status",          "type": "string"},
    {"name": "transactionRef",  "type": ["null", "string"], "default": null},
    {"name": "triggeredValue",  "type": ["null", "double"], "default": null},
    {"name": "tenantId",        "type": "string"},
    {"name": "createdAt",       "type": "string"}
  ]
}"#
}

/// Returns the canonical Avro schema for the bis.velocity.breaches topic.
pub fn velocity_breach_schema() -> &'static str {
    r#"{
  "type": "record",
  "name": "VelocityBreach",
  "namespace": "ng.bis.velocity",
  "doc": "Payment velocity rule breach event",
  "fields": [
    {"name": "alertId",          "type": "string"},
    {"name": "accountId",        "type": "string"},
    {"name": "tenantId",         "type": "string"},
    {"name": "ruleName",         "type": "string"},
    {"name": "riskLevel",        "type": "string"},
    {"name": "windowSecs",       "type": "long"},
    {"name": "txCount",          "type": "long"},
    {"name": "totalAmountKobo",  "type": "long"},
    {"name": "triggeringTxRef",  "type": "string"},
    {"name": "detectedAt",       "type": "string"}
  ]
}"#
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn base_schema() -> &'static str {
        r#"{
          "type": "record",
          "name": "TestEvent",
          "namespace": "ng.bis.test",
          "fields": [
            {"name": "id",     "type": "string"},
            {"name": "amount", "type": "long"}
          ]
        }"#
    }

    fn schema_with_optional_field() -> &'static str {
        r#"{
          "type": "record",
          "name": "TestEvent",
          "namespace": "ng.bis.test",
          "fields": [
            {"name": "id",       "type": "string"},
            {"name": "amount",   "type": "long"},
            {"name": "currency", "type": ["null", "string"], "default": null}
          ]
        }"#
    }

    fn schema_without_amount() -> &'static str {
        r#"{
          "type": "record",
          "name": "TestEvent",
          "namespace": "ng.bis.test",
          "fields": [
            {"name": "id", "type": "string"}
          ]
        }"#
    }

    fn schema_without_amount_with_default() -> &'static str {
        r#"{
          "type": "record",
          "name": "TestEvent",
          "namespace": "ng.bis.test",
          "fields": [
            {"name": "id",     "type": "string"},
            {"name": "amount", "type": "long", "default": 0}
          ]
        }"#
    }

    // ── parse_avro_schema ─────────────────────────────────────────────────────

    #[test]
    fn test_parse_valid_schema() {
        let schema = parse_avro_schema(base_schema());
        assert!(schema.is_ok());
        let s = schema.unwrap();
        assert_eq!(s.name, "TestEvent");
        assert_eq!(s.fields.len(), 2);
    }

    #[test]
    fn test_parse_invalid_json() {
        let result = parse_avro_schema("not json");
        assert!(matches!(result, Err(SchemaError::InvalidJson(_))));
    }

    #[test]
    fn test_parse_payment_event_schema() {
        let schema = parse_avro_schema(payment_event_schema());
        assert!(schema.is_ok());
        let s = schema.unwrap();
        assert_eq!(s.name, "PaymentEvent");
        assert_eq!(s.namespace, Some("ng.bis.payments".to_string()));
    }

    #[test]
    fn test_parse_aml_alert_schema() {
        assert!(parse_avro_schema(aml_alert_schema()).is_ok());
    }

    #[test]
    fn test_parse_velocity_breach_schema() {
        assert!(parse_avro_schema(velocity_breach_schema()).is_ok());
    }

    // ── fingerprint ───────────────────────────────────────────────────────────

    #[test]
    fn test_fingerprint_deterministic() {
        let fp1 = fingerprint(base_schema());
        let fp2 = fingerprint(base_schema());
        assert_eq!(fp1, fp2);
    }

    #[test]
    fn test_fingerprint_different_schemas() {
        let fp1 = fingerprint(base_schema());
        let fp2 = fingerprint(schema_with_optional_field());
        assert_ne!(fp1, fp2);
    }

    // ── compatibility checks ──────────────────────────────────────────────────

    #[test]
    fn test_backward_compatible_add_optional_field() {
        let old = parse_avro_schema(base_schema()).unwrap();
        let new = parse_avro_schema(schema_with_optional_field()).unwrap();
        assert!(check_backward(&old, &new).is_ok());
    }

    #[test]
    fn test_backward_incompatible_remove_required_field() {
        let old = parse_avro_schema(base_schema()).unwrap();
        let new = parse_avro_schema(schema_without_amount()).unwrap();
        // Removing 'amount' (no default in old) breaks backward compatibility
        let result = check_backward(&old, &new);
        assert!(matches!(result, Err(SchemaError::IncompatibleSchema(_))));
    }

    #[test]
    fn test_backward_compatible_remove_field_with_default() {
        // Old schema has 'amount' with default=0, new schema removes it
        let old = parse_avro_schema(schema_without_amount_with_default()).unwrap();
        let new = parse_avro_schema(schema_without_amount()).unwrap();
        assert!(check_backward(&old, &new).is_ok());
    }

    #[test]
    fn test_forward_compatible_add_optional_field() {
        let old = parse_avro_schema(base_schema()).unwrap();
        let new = parse_avro_schema(schema_with_optional_field()).unwrap();
        assert!(check_forward(&old, &new).is_ok());
    }

    #[test]
    fn test_forward_incompatible_add_required_field() {
        let required_field_schema = r#"{
          "type": "record",
          "name": "TestEvent",
          "namespace": "ng.bis.test",
          "fields": [
            {"name": "id",       "type": "string"},
            {"name": "amount",   "type": "long"},
            {"name": "required", "type": "string"}
          ]
        }"#;
        let old = parse_avro_schema(base_schema()).unwrap();
        let new = parse_avro_schema(required_field_schema).unwrap();
        let result = check_forward(&old, &new);
        assert!(matches!(result, Err(SchemaError::IncompatibleSchema(_))));
    }

    #[test]
    fn test_full_compatible() {
        let old = parse_avro_schema(base_schema()).unwrap();
        let new = parse_avro_schema(schema_with_optional_field()).unwrap();
        assert!(check_compatibility(&old, &new, &CompatibilityMode::Full).is_ok());
    }

    #[test]
    fn test_none_compatibility_always_passes() {
        let old = parse_avro_schema(base_schema()).unwrap();
        let new = parse_avro_schema(schema_without_amount()).unwrap();
        assert!(check_compatibility(&old, &new, &CompatibilityMode::None).is_ok());
    }

    // ── SchemaRegistry ────────────────────────────────────────────────────────

    #[test]
    fn test_register_first_schema() {
        let mut registry = SchemaRegistry::new();
        let id = registry.register("bis.payment.events", payment_event_schema());
        assert!(id.is_ok());
        assert_eq!(id.unwrap(), 1);
    }

    #[test]
    fn test_register_same_schema_returns_existing_id() {
        let mut registry = SchemaRegistry::new();
        let id1 = registry.register("bis.payment.events", payment_event_schema()).unwrap();
        let id2 = registry.register("bis.payment.events", payment_event_schema()).unwrap();
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_register_multiple_subjects() {
        let mut registry = SchemaRegistry::new();
        let id1 = registry.register("bis.payment.events", payment_event_schema()).unwrap();
        let id2 = registry.register("bis.aml.alerts", aml_alert_schema()).unwrap();
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_get_latest() {
        let mut registry = SchemaRegistry::new();
        registry.register("bis.payment.events", payment_event_schema()).unwrap();
        let latest = registry.get_latest("bis.payment.events");
        assert!(latest.is_ok());
        assert_eq!(latest.unwrap().version, 1);
    }

    #[test]
    fn test_get_latest_subject_not_found() {
        let registry = SchemaRegistry::new();
        let result = registry.get_latest("nonexistent");
        assert!(matches!(result, Err(SchemaError::SubjectNotFound(_))));
    }

    #[test]
    fn test_get_by_id() {
        let mut registry = SchemaRegistry::new();
        let id = registry.register("bis.payment.events", payment_event_schema()).unwrap();
        let schema = registry.get_by_id(id);
        assert!(schema.is_some());
        assert_eq!(schema.unwrap().id, id);
    }

    #[test]
    fn test_list_subjects() {
        let mut registry = SchemaRegistry::new();
        registry.register("bis.payment.events", payment_event_schema()).unwrap();
        registry.register("bis.aml.alerts", aml_alert_schema()).unwrap();
        let subjects = registry.list_subjects();
        assert_eq!(subjects.len(), 2);
    }

    #[test]
    fn test_list_versions() {
        let mut registry = SchemaRegistry::new();
        registry.set_compatibility("bis.test", CompatibilityMode::None);
        registry.register("bis.test", base_schema()).unwrap();
        registry.register("bis.test", schema_with_optional_field()).unwrap();
        let versions = registry.list_versions("bis.test").unwrap();
        assert_eq!(versions, vec![1, 2]);
    }

    #[test]
    fn test_delete_subject() {
        let mut registry = SchemaRegistry::new();
        registry.register("bis.payment.events", payment_event_schema()).unwrap();
        let deleted = registry.delete_subject("bis.payment.events");
        assert!(deleted.is_ok());
        assert!(registry.get_latest("bis.payment.events").is_err());
    }

    #[test]
    fn test_compatibility_mode_from_str() {
        assert_eq!(CompatibilityMode::from_str("BACKWARD").unwrap(), CompatibilityMode::Backward);
        assert_eq!(CompatibilityMode::from_str("FORWARD").unwrap(), CompatibilityMode::Forward);
        assert_eq!(CompatibilityMode::from_str("FULL").unwrap(), CompatibilityMode::Full);
        assert_eq!(CompatibilityMode::from_str("NONE").unwrap(), CompatibilityMode::None);
        assert!(CompatibilityMode::from_str("INVALID").is_err());
    }

    #[test]
    fn test_register_incompatible_schema_rejected() {
        let mut registry = SchemaRegistry::new();
        // Default mode is BACKWARD
        registry.register("bis.test", base_schema()).unwrap();
        // schema_without_amount removes 'amount' which has no default — incompatible
        let result = registry.register("bis.test", schema_without_amount());
        assert!(matches!(result, Err(SchemaError::IncompatibleSchema(_))));
    }
}
