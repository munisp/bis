-- Adds a versioned, canonical HMAC scheme for cryptographic audit read-back.
-- Existing append-only evidence is deliberately not rewritten; it remains legacy_v1
-- and must not be represented as cryptographically verified by application reads.

ALTER TABLE pii_forensic_audit_events
  ADD COLUMN integrity_scheme TEXT NOT NULL DEFAULT 'legacy_json_v1'
    CHECK (integrity_scheme IN ('legacy_json_v1','hmac_sha256_canonical_json_v2'));

CREATE INDEX pii_forensic_audit_events_integrity_scheme_idx
  ON pii_forensic_audit_events (tenant_id, integrity_scheme, created_at DESC);

CREATE OR REPLACE FUNCTION reject_pii_forensic_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PII forensic audit events are append-only';
END; $$;

DROP TRIGGER IF EXISTS pii_forensic_event_no_update ON pii_forensic_audit_events;
DROP TRIGGER IF EXISTS pii_forensic_event_no_delete ON pii_forensic_audit_events;
CREATE TRIGGER pii_forensic_event_no_update
  BEFORE UPDATE ON pii_forensic_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_pii_forensic_event_mutation();
CREATE TRIGGER pii_forensic_event_no_delete
  BEFORE DELETE ON pii_forensic_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_pii_forensic_event_mutation();
