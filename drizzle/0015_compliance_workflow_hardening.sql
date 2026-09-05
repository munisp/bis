-- Harden 0014 without rewriting an already applied migration.
-- Closes key-registry tenant escapes, removes an unnecessary plaintext fingerprint,
-- and adds a durable, encrypted notice-delivery outbox.

ALTER TABLE pii_envelope_records
  DROP COLUMN plaintext_sha256,
  ADD COLUMN key_version TEXT;

UPDATE pii_envelope_records e
   SET key_version = k.key_version
  FROM pii_encryption_key_registry k
 WHERE k.id = e.key_registry_id
   AND e.key_version IS NULL;

ALTER TABLE pii_envelope_records
  ALTER COLUMN key_version SET NOT NULL;

CREATE TABLE pii_blind_index_key_registry (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  key_version TEXT NOT NULL,
  external_key_ref TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'HMAC-SHA-256' CHECK (algorithm = 'HMAC-SHA-256'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retiring','retired','compromised')),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retires_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, key_version),
  CHECK (btrim(key_version) <> '' AND btrim(external_key_ref) <> ''),
  CHECK (retires_at IS NULL OR retires_at >= activated_at)
);

ALTER TABLE pii_blind_indexes
  ADD COLUMN key_registry_id BIGINT REFERENCES pii_blind_index_key_registry(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION enforce_pii_envelope_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_tenant INTEGER; registry_tenant INTEGER; registry_version TEXT; registry_status TEXT;
BEGIN
  IF NEW.subject_kind = 'candidate_profile' THEN
    SELECT "tenantId" INTO subject_tenant FROM candidate_profiles WHERE id = NEW.subject_id;
  ELSE
    SELECT "tenantId" INTO subject_tenant FROM criminal_records WHERE id = NEW.subject_id;
  END IF;
  SELECT tenant_id, key_version, status INTO registry_tenant, registry_version, registry_status
    FROM pii_encryption_key_registry WHERE id = NEW.key_registry_id;
  IF NOT FOUND OR subject_tenant IS DISTINCT FROM NEW.tenant_id OR registry_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'PII envelope subject and key registry must belong to the same tenant';
  END IF;
  IF NEW.key_version IS DISTINCT FROM registry_version THEN
    RAISE EXCEPTION 'PII envelope key version must match the registered tenant key';
  END IF;
  IF TG_OP = 'INSERT' AND registry_status <> 'active' THEN
    RAISE EXCEPTION 'new PII envelopes require an active tenant encryption key';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS pii_envelope_tenant_guard ON pii_envelope_records;
CREATE TRIGGER pii_envelope_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, subject_kind, subject_id, key_registry_id, key_version
  ON pii_envelope_records FOR EACH ROW EXECUTE FUNCTION enforce_pii_envelope_tenant();

CREATE OR REPLACE FUNCTION enforce_pii_blind_index_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_tenant INTEGER; registry_tenant INTEGER; registry_version TEXT; registry_status TEXT;
BEGIN
  IF NEW.subject_kind = 'candidate_profile' THEN
    SELECT "tenantId" INTO subject_tenant FROM candidate_profiles WHERE id = NEW.subject_id;
  ELSE
    SELECT "tenantId" INTO subject_tenant FROM criminal_records WHERE id = NEW.subject_id;
  END IF;
  SELECT tenant_id, key_version, status INTO registry_tenant, registry_version, registry_status
    FROM pii_blind_index_key_registry WHERE id = NEW.key_registry_id;
  IF NOT FOUND OR subject_tenant IS DISTINCT FROM NEW.tenant_id OR registry_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'PII blind-index subject and key registry must belong to the same tenant';
  END IF;
  IF NEW.key_version IS DISTINCT FROM registry_version THEN
    RAISE EXCEPTION 'PII blind-index key version must match the registered tenant key';
  END IF;
  IF TG_OP = 'INSERT' AND registry_status <> 'active' THEN
    RAISE EXCEPTION 'new PII blind indexes require an active tenant blind-index key';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pii_blind_index_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, subject_kind, subject_id, key_registry_id, key_version
  ON pii_blind_indexes FOR EACH ROW EXECUTE FUNCTION enforce_pii_blind_index_tenant();

ALTER TABLE compliance_notice_templates
  ADD COLUMN counsel_approval_reference TEXT;
ALTER TABLE compliance_notice_templates
  ADD CONSTRAINT compliance_notice_templates_counsel_reference
  CHECK (counsel_approval_reference IS NULL OR length(btrim(counsel_approval_reference)) >= 12);

ALTER TABLE compliance_adverse_action_events
  DROP CONSTRAINT IF EXISTS compliance_adverse_action_events_event_type_check;
ALTER TABLE compliance_adverse_action_events
  ADD CONSTRAINT compliance_adverse_action_events_event_type_check CHECK (event_type IN (
    'created','pre_notice_queued','pre_notice_delivered','paused_for_dispute','resumed','canceled',
    'final_notice_queued','final_notice_delivered','manual_delivery_required','manual_delivery_resolved','completed'
  ));

CREATE TABLE compliance_notice_delivery_outbox (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  adverse_action_case_id UUID NOT NULL REFERENCES compliance_adverse_action_cases(id) ON DELETE RESTRICT,
  delivery_id UUID NOT NULL UNIQUE REFERENCES compliance_notice_deliveries(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL DEFAULT 'deliver_notice' CHECK (event_type = 'deliver_notice'),
  payload_ciphertext BYTEA NOT NULL,
  payload_nonce BYTEA NOT NULL CHECK (octet_length(payload_nonce) = 12),
  payload_key_version TEXT NOT NULL,
  payload_algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm' CHECK (payload_algorithm = 'aes-256-gcm'),
  payload_sha256 CHAR(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key UUID NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','delivered','dead_letter','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 12),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leased_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX compliance_notice_delivery_outbox_dispatch_idx
  ON compliance_notice_delivery_outbox (state, available_at ASC, created_at ASC) WHERE state = 'pending';
CREATE INDEX compliance_notice_delivery_outbox_case_idx
  ON compliance_notice_delivery_outbox (tenant_id, adverse_action_case_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_compliance_notice_outbox_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_tenant INTEGER; delivery_case UUID;
BEGIN
  SELECT tenant_id INTO case_tenant FROM compliance_adverse_action_cases WHERE id = NEW.adverse_action_case_id;
  SELECT adverse_action_case_id INTO delivery_case FROM compliance_notice_deliveries WHERE id = NEW.delivery_id;
  IF NOT FOUND OR case_tenant IS DISTINCT FROM NEW.tenant_id OR delivery_case IS DISTINCT FROM NEW.adverse_action_case_id THEN
    RAISE EXCEPTION 'notice delivery outbox tenant, case, and delivery must match';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER compliance_notice_delivery_outbox_integrity
  BEFORE INSERT OR UPDATE OF tenant_id, adverse_action_case_id, delivery_id
  ON compliance_notice_delivery_outbox FOR EACH ROW EXECUTE FUNCTION enforce_compliance_notice_outbox_integrity();

CREATE TABLE compliance_template_events (
  id BIGSERIAL PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES compliance_notice_templates(id) ON DELETE RESTRICT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','superseded')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash CHAR(64) NOT NULL CHECK (integrity_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION reject_compliance_template_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'compliance template events are append-only'; END; $$;
CREATE TRIGGER compliance_template_event_no_update BEFORE UPDATE ON compliance_template_events FOR EACH ROW EXECUTE FUNCTION reject_compliance_template_event_mutation();
CREATE TRIGGER compliance_template_event_no_delete BEFORE DELETE ON compliance_template_events FOR EACH ROW EXECUTE FUNCTION reject_compliance_template_event_mutation();

ALTER TABLE compliance_adverse_action_cases
  ADD COLUMN framework TEXT NOT NULL DEFAULT 'ndpa' CHECK (framework IN ('ndpa','fcra','dual')),
  ADD COLUMN fcra_eligibility_attested_at TIMESTAMPTZ,
  ADD COLUMN fcra_eligibility_attestation_text TEXT,
  ADD COLUMN paused_from_status TEXT;
ALTER TABLE compliance_adverse_action_cases
  ADD CONSTRAINT compliance_adverse_action_cases_framework_attestation CHECK (
    framework = 'ndpa' OR (
      jurisdiction_code = 'US'
      AND fcra_eligibility_attested_at IS NOT NULL
      AND length(btrim(fcra_eligibility_attestation_text)) >= 40
    )
  ),
  ADD CONSTRAINT compliance_adverse_action_cases_pause_origin CHECK (
    paused_from_status IS NULL OR paused_from_status IN ('pre_notice_queued','pre_notice_delivered','waiting','final_notice_queued')
  );

CREATE OR REPLACE FUNCTION enforce_compliance_notice_template_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.superseded_at IS NOT NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.template_key IS DISTINCT FROM OLD.template_key
     OR NEW.jurisdiction_code IS DISTINCT FROM OLD.jurisdiction_code
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.body_ciphertext IS DISTINCT FROM OLD.body_ciphertext
     OR NEW.body_nonce IS DISTINCT FROM OLD.body_nonce
     OR NEW.body_key_version IS DISTINCT FROM OLD.body_key_version
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.counsel_approval_reference IS DISTINCT FROM OLD.counsel_approval_reference
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.superseded_at IS NULL AND NEW.superseded_at IS NULL) THEN
    RAISE EXCEPTION 'compliance notice templates are immutable; only one NULL-to-timestamp supersession transition is permitted';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER compliance_notice_templates_immutable_update
  BEFORE UPDATE ON compliance_notice_templates FOR EACH ROW
  EXECUTE FUNCTION enforce_compliance_notice_template_immutability();

ALTER TABLE compliance_adverse_action_events
  DROP CONSTRAINT compliance_adverse_action_events_event_type_check;
ALTER TABLE compliance_adverse_action_events
  ADD CONSTRAINT compliance_adverse_action_events_event_type_check CHECK (event_type IN (
    'created','pre_notice_queued','notice_dispatched','pre_notice_delivered','paused_for_dispute','resumed','canceled',
    'final_notice_queued','final_notice_delivered','manual_delivery_required','manual_delivery_resolved','completed'
  ));

ALTER TABLE compliance_adverse_action_cases
  ADD COLUMN paused_at TIMESTAMPTZ;
ALTER TABLE compliance_adverse_action_cases
  ADD CONSTRAINT compliance_adverse_action_cases_pause_timestamp CHECK (
    (status = 'paused_for_dispute') = (paused_at IS NOT NULL)
  );
