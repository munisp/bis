-- Adverse-action orchestration and tenant-bound PII envelope-encryption foundation.
-- This migration is additive: plaintext legacy columns remain readable only during a
-- separately approved key-backed backfill and are never copied into notices/logs.

CREATE TABLE pii_encryption_key_registry (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  key_version TEXT NOT NULL,
  external_key_ref TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retiring','retired','compromised')),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retires_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, key_version),
  CHECK (btrim(key_version) <> '' AND btrim(external_key_ref) <> '')
);

CREATE TABLE pii_envelope_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('candidate_profile','criminal_record')),
  subject_id INTEGER NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('identity','contact','address','document','criminal_record','provider_payload')),
  ciphertext BYTEA NOT NULL,
  nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 12),
  authenticated_data_version SMALLINT NOT NULL DEFAULT 1 CHECK (authenticated_data_version = 1),
  key_registry_id BIGINT NOT NULL REFERENCES pii_encryption_key_registry(id) ON DELETE RESTRICT,
  plaintext_sha256 CHAR(64) NOT NULL CHECK (plaintext_sha256 ~ '^[0-9a-f]{64}$'),
  encrypted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  CHECK (retired_at IS NULL OR retired_at >= encrypted_at)
);
CREATE UNIQUE INDEX pii_envelope_records_one_active_purpose_idx
  ON pii_envelope_records (tenant_id, subject_kind, subject_id, purpose)
  WHERE retired_at IS NULL;
CREATE INDEX pii_envelope_records_subject_idx ON pii_envelope_records (tenant_id, subject_kind, subject_id) WHERE retired_at IS NULL;

CREATE TABLE pii_blind_indexes (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('candidate_profile','criminal_record')),
  subject_id INTEGER NOT NULL,
  attribute_name TEXT NOT NULL CHECK (attribute_name IN ('nin','bvn','passport_number','email','phone')),
  key_version TEXT NOT NULL,
  normalized_hmac CHAR(64) NOT NULL CHECK (normalized_hmac ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, subject_kind, subject_id, attribute_name, key_version),
  UNIQUE (tenant_id, attribute_name, key_version, normalized_hmac)
);

CREATE TABLE compliance_notice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  template_key TEXT NOT NULL CHECK (template_key IN ('pre_adverse','final_adverse','undeliverable','dispute_hold','dispute_result')),
  jurisdiction_code TEXT NOT NULL,
  version TEXT NOT NULL,
  body_ciphertext BYTEA NOT NULL,
  body_nonce BYTEA NOT NULL CHECK (octet_length(body_nonce) = 12),
  body_key_version TEXT NOT NULL,
  content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, template_key, jurisdiction_code, version)
);

CREATE TABLE compliance_adverse_action_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_ref TEXT NOT NULL UNIQUE CHECK (case_ref ~ '^BIS-AA-[A-Z0-9]{18}$'),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  screening_order_id INTEGER NOT NULL REFERENCES screening_orders(id) ON DELETE RESTRICT,
  candidate_id INTEGER NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  report_snapshot_id BIGINT NOT NULL REFERENCES consumer_report_snapshots(id) ON DELETE RESTRICT,
  jurisdiction_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pre_notice_queued','pre_notice_delivered','waiting','paused_for_dispute','canceled','final_notice_queued','completed','undeliverable','manual_delivery')),
  waiting_period_days SMALLINT NOT NULL CHECK (waiting_period_days BETWEEN 5 AND 30),
  pre_notice_due_at TIMESTAMPTZ,
  final_notice_eligible_at TIMESTAMPTZ,
  final_notice_sent_at TIMESTAMPTZ,
  initiated_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  employer_attestation_at TIMESTAMPTZ,
  employer_attestation_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, screening_order_id)
);
CREATE INDEX compliance_adverse_action_open_idx ON compliance_adverse_action_cases (tenant_id, status, final_notice_eligible_at) WHERE status IN ('pre_notice_delivered','waiting','paused_for_dispute','final_notice_queued');

CREATE TABLE compliance_adverse_action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adverse_action_case_id UUID NOT NULL REFERENCES compliance_adverse_action_cases(id) ON DELETE RESTRICT,
  screening_result_id INTEGER NOT NULL REFERENCES screening_results(id) ON DELETE RESTRICT,
  rationale_ciphertext BYTEA NOT NULL,
  rationale_nonce BYTEA NOT NULL CHECK (octet_length(rationale_nonce) = 12),
  rationale_key_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (adverse_action_case_id, screening_result_id)
);

CREATE TABLE compliance_notice_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adverse_action_case_id UUID NOT NULL REFERENCES compliance_adverse_action_cases(id) ON DELETE RESTRICT,
  template_id UUID NOT NULL REFERENCES compliance_notice_templates(id) ON DELETE RESTRICT,
  notice_type TEXT NOT NULL CHECK (notice_type IN ('pre_adverse','final_adverse','undeliverable','dispute_hold','dispute_result')),
  channel TEXT NOT NULL CHECK (channel IN ('portal','email','postal','manual')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','opened','undeliverable','manual_required','canceled')),
  content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  provider_message_ref TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX compliance_notice_delivery_pending_idx ON compliance_notice_deliveries (status, queued_at) WHERE status IN ('queued','sent');

CREATE TABLE compliance_adverse_action_events (
  id BIGSERIAL PRIMARY KEY,
  adverse_action_case_id UUID NOT NULL REFERENCES compliance_adverse_action_cases(id) ON DELETE RESTRICT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','pre_notice_queued','pre_notice_delivered','paused_for_dispute','resumed','canceled','final_notice_queued','final_notice_delivered','manual_delivery_required','completed')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash CHAR(64) NOT NULL CHECK (integrity_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION reject_compliance_adverse_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'compliance adverse-action events are append-only'; END; $$;
CREATE TRIGGER compliance_adverse_event_no_update BEFORE UPDATE ON compliance_adverse_action_events FOR EACH ROW EXECUTE FUNCTION reject_compliance_adverse_event_mutation();
CREATE TRIGGER compliance_adverse_event_no_delete BEFORE DELETE ON compliance_adverse_action_events FOR EACH ROW EXECUTE FUNCTION reject_compliance_adverse_event_mutation();

CREATE OR REPLACE FUNCTION enforce_compliance_adverse_action_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_tenant INTEGER; order_candidate INTEGER; snapshot_tenant INTEGER; snapshot_candidate INTEGER;
BEGIN
 SELECT "tenantId", "candidateId" INTO order_tenant, order_candidate FROM screening_orders WHERE id = NEW.screening_order_id;
 SELECT tenant_id, candidate_id INTO snapshot_tenant, snapshot_candidate FROM consumer_report_snapshots WHERE id = NEW.report_snapshot_id;
 IF NOT FOUND OR order_tenant <> NEW.tenant_id OR order_candidate <> NEW.candidate_id OR snapshot_tenant <> NEW.tenant_id OR snapshot_candidate <> NEW.candidate_id THEN RAISE EXCEPTION 'adverse-action case tenant, candidate, order, and immutable snapshot must match'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER compliance_adverse_action_integrity BEFORE INSERT OR UPDATE OF tenant_id, screening_order_id, candidate_id, report_snapshot_id ON compliance_adverse_action_cases FOR EACH ROW EXECUTE FUNCTION enforce_compliance_adverse_action_integrity();

CREATE OR REPLACE FUNCTION enforce_pii_envelope_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_tenant INTEGER;
BEGIN
 IF NEW.subject_kind = 'candidate_profile' THEN SELECT "tenantId" INTO actual_tenant FROM candidate_profiles WHERE id = NEW.subject_id;
 ELSE SELECT "tenantId" INTO actual_tenant FROM criminal_records WHERE id = NEW.subject_id; END IF;
 IF NOT FOUND OR actual_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'PII envelope subject must belong to the same tenant'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER pii_envelope_tenant_guard BEFORE INSERT OR UPDATE OF tenant_id, subject_kind, subject_id ON pii_envelope_records FOR EACH ROW EXECUTE FUNCTION enforce_pii_envelope_tenant();
