-- Replace new local PII cryptography with direct Vault Transit references while retaining
-- legacy metadata only for an explicitly approved, one-time migration worker.

CREATE TABLE pii_key_compromise_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_ref TEXT NOT NULL UNIQUE CHECK (incident_ref ~ '^BIS-KC-[A-Z0-9]{18}$'),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'suspected' CHECK (status IN ('suspected','contained','rotation_queued','rotating','recovering','resolved','closed')),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contained_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  reported_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  commander_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  counsel_reference TEXT,
  evidence_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (contained_at IS NULL OR contained_at >= detected_at),
  CHECK (resolved_at IS NULL OR resolved_at >= detected_at),
  CHECK (counsel_reference IS NULL OR length(btrim(counsel_reference)) >= 12),
  CHECK (evidence_reference IS NULL OR length(btrim(evidence_reference)) >= 12)
);
CREATE INDEX pii_key_compromise_incidents_open_idx ON pii_key_compromise_incidents (tenant_id, status, detected_at DESC)
  WHERE status NOT IN ('resolved','closed');

CREATE TABLE pii_key_compromise_impacts (
  id BIGSERIAL PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES pii_key_compromise_incidents(id) ON DELETE RESTRICT,
  encryption_key_registry_id BIGINT REFERENCES pii_encryption_key_registry(id) ON DELETE RESTRICT,
  blind_index_key_registry_id BIGINT REFERENCES pii_blind_index_key_registry(id) ON DELETE RESTRICT,
  impact_scope TEXT NOT NULL CHECK (impact_scope IN ('encryption','blind_index','both')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((encryption_key_registry_id IS NOT NULL)::integer + (blind_index_key_registry_id IS NOT NULL)::integer >= 1),
  UNIQUE (incident_id, encryption_key_registry_id, blind_index_key_registry_id)
);
CREATE UNIQUE INDEX pii_key_compromise_impacts_encryption_once_idx
  ON pii_key_compromise_impacts (incident_id, encryption_key_registry_id)
  WHERE encryption_key_registry_id IS NOT NULL;
CREATE UNIQUE INDEX pii_key_compromise_impacts_blind_index_once_idx
  ON pii_key_compromise_impacts (incident_id, blind_index_key_registry_id)
  WHERE blind_index_key_registry_id IS NOT NULL;

ALTER TABLE pii_encryption_key_registry
  DROP CONSTRAINT IF EXISTS pii_encryption_key_registry_status_check,
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'legacy_local_aes' CHECK (provider IN ('legacy_local_aes','vault_transit')),
  ADD COLUMN provider_key_name TEXT,
  ADD COLUMN provider_key_version INTEGER,
  ADD COLUMN compromised_at TIMESTAMPTZ,
  ADD COLUMN compromise_incident_id UUID REFERENCES pii_key_compromise_incidents(id) ON DELETE RESTRICT,
  ADD CONSTRAINT pii_encryption_key_registry_status_check CHECK (status IN ('staged','active','retiring','retired','compromised')),
  ADD CONSTRAINT pii_encryption_key_registry_provider_shape CHECK (
    (provider = 'legacy_local_aes' AND provider_key_name IS NULL AND provider_key_version IS NULL)
    OR (provider = 'vault_transit' AND algorithm = 'VAULT-TRANSIT-AES256-GCM96' AND provider_key_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' AND provider_key_version IS NOT NULL AND provider_key_version > 0 AND external_key_ref = ('vault-transit://' || split_part(external_key_ref, '/', 3) || '/' || provider_key_name))
  ),
  ADD CONSTRAINT pii_encryption_key_registry_compromise_shape CHECK (
    (status = 'compromised') = (compromised_at IS NOT NULL)
  );

ALTER TABLE pii_blind_index_key_registry
  DROP CONSTRAINT IF EXISTS pii_blind_index_key_registry_status_check,
  DROP CONSTRAINT IF EXISTS pii_blind_index_key_registry_algorithm_check,
  ADD CONSTRAINT pii_blind_index_key_registry_algorithm_check CHECK (algorithm IN ('HMAC-SHA-256','VAULT-TRANSIT-HMAC-SHA256')),
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'legacy_local_aes' CHECK (provider IN ('legacy_local_aes','vault_transit')),
  ADD COLUMN provider_key_name TEXT,
  ADD COLUMN provider_key_version INTEGER,
  ADD COLUMN compromised_at TIMESTAMPTZ,
  ADD COLUMN compromise_incident_id UUID REFERENCES pii_key_compromise_incidents(id) ON DELETE RESTRICT,
  ADD CONSTRAINT pii_blind_index_key_registry_status_check CHECK (status IN ('staged','active','retiring','retired','compromised')),
  ADD CONSTRAINT pii_blind_index_key_registry_provider_shape CHECK (
    (provider = 'legacy_local_aes' AND provider_key_name IS NULL AND provider_key_version IS NULL)
    OR (provider = 'vault_transit' AND algorithm = 'VAULT-TRANSIT-HMAC-SHA256' AND provider_key_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' AND provider_key_version IS NOT NULL AND provider_key_version > 0 AND external_key_ref = ('vault-transit://' || split_part(external_key_ref, '/', 3) || '/' || provider_key_name))
  ),
  ADD CONSTRAINT pii_blind_index_key_registry_compromise_shape CHECK (
    (status = 'compromised') = (compromised_at IS NOT NULL)
  );

CREATE UNIQUE INDEX pii_encryption_key_registry_one_active_per_tenant_idx
  ON pii_encryption_key_registry (tenant_id) WHERE status = 'active';
CREATE UNIQUE INDEX pii_blind_index_key_registry_one_active_per_tenant_idx
  ON pii_blind_index_key_registry (tenant_id) WHERE status = 'active';

ALTER TABLE pii_envelope_records
  ALTER COLUMN nonce DROP NOT NULL,
  ADD COLUMN crypto_provider TEXT NOT NULL DEFAULT 'legacy_local_aes' CHECK (crypto_provider IN ('legacy_local_aes','vault_transit')),
  ADD COLUMN provider_key_version INTEGER,
  ADD CONSTRAINT pii_envelope_records_provider_shape CHECK (
    (crypto_provider = 'legacy_local_aes' AND nonce IS NOT NULL AND provider_key_version IS NULL)
    OR (crypto_provider = 'vault_transit' AND nonce IS NULL AND provider_key_version IS NOT NULL AND provider_key_version > 0)
  );
ALTER TABLE pii_blind_indexes
  DROP CONSTRAINT IF EXISTS pii_blind_indexes_normalized_hmac_check,
  ALTER COLUMN normalized_hmac TYPE TEXT,
  ADD COLUMN crypto_provider TEXT NOT NULL DEFAULT 'legacy_local_aes' CHECK (crypto_provider IN ('legacy_local_aes','vault_transit')),
  ADD COLUMN provider_key_version INTEGER,
  ADD CONSTRAINT pii_blind_indexes_provider_shape CHECK (
    (crypto_provider = 'legacy_local_aes' AND normalized_hmac ~ '^[0-9a-f]{64}$' AND provider_key_version IS NULL)
    OR (crypto_provider = 'vault_transit' AND normalized_hmac ~ '^vault:v[1-9][0-9]*:hmac:[A-Za-z0-9+/=]+$' AND provider_key_version IS NOT NULL AND provider_key_version > 0)
  );

ALTER TABLE compliance_notice_templates
  ALTER COLUMN body_nonce DROP NOT NULL,
  ADD COLUMN body_crypto_provider TEXT NOT NULL DEFAULT 'legacy_local_aes' CHECK (body_crypto_provider IN ('legacy_local_aes','vault_transit')),
  ADD COLUMN body_provider_key_version INTEGER,
  ADD COLUMN body_key_registry_id BIGINT REFERENCES pii_encryption_key_registry(id) ON DELETE RESTRICT,
  ADD CONSTRAINT compliance_notice_templates_provider_shape CHECK (
    (body_crypto_provider = 'legacy_local_aes' AND body_nonce IS NOT NULL AND body_provider_key_version IS NULL)
    OR (body_crypto_provider = 'vault_transit' AND body_nonce IS NULL AND body_provider_key_version IS NOT NULL AND body_provider_key_version > 0 AND body_key_registry_id IS NOT NULL)
  );
ALTER TABLE compliance_adverse_action_items
  ALTER COLUMN rationale_nonce DROP NOT NULL,
  ADD COLUMN rationale_crypto_provider TEXT NOT NULL DEFAULT 'legacy_local_aes' CHECK (rationale_crypto_provider IN ('legacy_local_aes','vault_transit')),
  ADD COLUMN rationale_provider_key_version INTEGER,
  ADD COLUMN rationale_key_registry_id BIGINT REFERENCES pii_encryption_key_registry(id) ON DELETE RESTRICT,
  ADD CONSTRAINT compliance_adverse_action_items_provider_shape CHECK (
    (rationale_crypto_provider = 'legacy_local_aes' AND rationale_nonce IS NOT NULL AND rationale_provider_key_version IS NULL)
    OR (rationale_crypto_provider = 'vault_transit' AND rationale_nonce IS NULL AND rationale_provider_key_version IS NOT NULL AND rationale_provider_key_version > 0 AND rationale_key_registry_id IS NOT NULL)
  );
ALTER TABLE compliance_notice_delivery_outbox
  ALTER COLUMN payload_nonce DROP NOT NULL,
  ADD COLUMN payload_crypto_provider TEXT NOT NULL DEFAULT 'legacy_local_aes' CHECK (payload_crypto_provider IN ('legacy_local_aes','vault_transit')),
  ADD COLUMN payload_provider_key_version INTEGER,
  ADD COLUMN payload_key_registry_id BIGINT REFERENCES pii_encryption_key_registry(id) ON DELETE RESTRICT,
  ADD CONSTRAINT compliance_notice_delivery_outbox_provider_shape CHECK (
    (payload_crypto_provider = 'legacy_local_aes' AND payload_nonce IS NOT NULL AND payload_provider_key_version IS NULL)
    OR (payload_crypto_provider = 'vault_transit' AND payload_nonce IS NULL AND payload_provider_key_version IS NOT NULL AND payload_provider_key_version > 0 AND payload_key_registry_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION enforce_pii_envelope_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_tenant INTEGER; registry_tenant INTEGER; registry_version TEXT; registry_status TEXT; registry_provider TEXT;
BEGIN
  IF NEW.subject_kind = 'candidate_profile' THEN SELECT "tenantId" INTO subject_tenant FROM candidate_profiles WHERE id = NEW.subject_id;
  ELSE SELECT "tenantId" INTO subject_tenant FROM criminal_records WHERE id = NEW.subject_id; END IF;
  SELECT tenant_id, key_version, status, provider INTO registry_tenant, registry_version, registry_status, registry_provider FROM pii_encryption_key_registry WHERE id = NEW.key_registry_id;
  IF NOT FOUND OR subject_tenant IS DISTINCT FROM NEW.tenant_id OR registry_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'PII envelope subject and key registry must belong to the same tenant'; END IF;
  IF NEW.key_version IS DISTINCT FROM registry_version OR NEW.crypto_provider IS DISTINCT FROM registry_provider THEN RAISE EXCEPTION 'PII envelope version and provider must match registered tenant key'; END IF;
  IF TG_OP = 'INSERT' AND registry_status <> 'active' THEN RAISE EXCEPTION 'new PII envelopes require an active tenant encryption key'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION enforce_pii_blind_index_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_tenant INTEGER; registry_tenant INTEGER; registry_version TEXT; registry_status TEXT; registry_provider TEXT;
BEGIN
  IF NEW.subject_kind = 'candidate_profile' THEN SELECT "tenantId" INTO subject_tenant FROM candidate_profiles WHERE id = NEW.subject_id;
  ELSE SELECT "tenantId" INTO subject_tenant FROM criminal_records WHERE id = NEW.subject_id; END IF;
  SELECT tenant_id, key_version, status, provider INTO registry_tenant, registry_version, registry_status, registry_provider FROM pii_blind_index_key_registry WHERE id = NEW.key_registry_id;
  IF NOT FOUND OR subject_tenant IS DISTINCT FROM NEW.tenant_id OR registry_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'PII blind-index subject and key registry must belong to the same tenant'; END IF;
  IF NEW.key_version IS DISTINCT FROM registry_version OR NEW.crypto_provider IS DISTINCT FROM registry_provider THEN RAISE EXCEPTION 'PII blind-index version and provider must match registered tenant key'; END IF;
  IF TG_OP = 'INSERT' AND registry_status <> 'active' THEN RAISE EXCEPTION 'new PII blind indexes require an active tenant blind-index key'; END IF;
  RETURN NEW;
END; $$;

CREATE TABLE pii_rotation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rotation_ref TEXT NOT NULL UNIQUE CHECK (rotation_ref ~ '^BIS-PR-[A-Z0-9]{18}$'),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_encryption_key_registry_id BIGINT NOT NULL REFERENCES pii_encryption_key_registry(id) ON DELETE RESTRICT,
  target_encryption_key_registry_id BIGINT NOT NULL REFERENCES pii_encryption_key_registry(id) ON DELETE RESTRICT,
  source_blind_index_key_registry_id BIGINT REFERENCES pii_blind_index_key_registry(id) ON DELETE RESTRICT,
  target_blind_index_key_registry_id BIGINT REFERENCES pii_blind_index_key_registry(id) ON DELETE RESTRICT,
  compromise_incident_id UUID REFERENCES pii_key_compromise_incidents(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('transit_rewrap','transit_reencrypt','legacy_cutover')),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','leased','dry_run_complete','completed','failed','canceled')),
  dry_run BOOLEAN NOT NULL DEFAULT true,
  max_batch_size SMALLINT NOT NULL DEFAULT 50 CHECK (max_batch_size BETWEEN 1 AND 200),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 12),
  expected_count INTEGER,
  processed_count INTEGER NOT NULL DEFAULT 0,
  rotated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  leased_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_encryption_key_registry_id <> target_encryption_key_registry_id),
  CHECK ((source_blind_index_key_registry_id IS NULL) = (target_blind_index_key_registry_id IS NULL)),
  CHECK (completed_at IS NULL OR completed_at >= created_at)
);
CREATE INDEX pii_rotation_jobs_dispatch_idx ON pii_rotation_jobs (state, created_at ASC) WHERE state IN ('queued','leased');
CREATE UNIQUE INDEX pii_rotation_jobs_active_target_idx ON pii_rotation_jobs (tenant_id, target_encryption_key_registry_id)
  WHERE state IN ('queued','leased');

CREATE TABLE pii_rotation_job_items (
  id BIGSERIAL PRIMARY KEY,
  rotation_job_id UUID NOT NULL REFERENCES pii_rotation_jobs(id) ON DELETE RESTRICT,
  envelope_id UUID NOT NULL REFERENCES pii_envelope_records(id) ON DELETE RESTRICT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('candidate_profile','criminal_record')),
  subject_id INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('planned','rotated','skipped','failed')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (rotation_job_id, envelope_id),
  CHECK (completed_at IS NULL OR completed_at >= created_at)
);
CREATE INDEX pii_rotation_job_items_pending_idx ON pii_rotation_job_items (rotation_job_id, state, id) WHERE state = 'planned';

CREATE TABLE pii_forensic_audit_events (
  id BIGSERIAL PRIMARY KEY,
  incident_id UUID REFERENCES pii_key_compromise_incidents(id) ON DELETE RESTRICT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  rotation_job_id UUID REFERENCES pii_rotation_jobs(id) ON DELETE RESTRICT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('incident_created','key_contained','key_compromised','rotation_created','rotation_dry_run_completed','rotation_started','rotation_progress','rotation_completed','rotation_failed','access_revoked','recovery_verified','incident_resolved','incident_closed')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash CHAR(64) NOT NULL CHECK (integrity_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX pii_forensic_audit_events_incident_idx ON pii_forensic_audit_events (incident_id, created_at ASC);
CREATE INDEX pii_forensic_audit_events_tenant_idx ON pii_forensic_audit_events (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS pii_envelope_tenant_guard ON pii_envelope_records;
CREATE TRIGGER pii_envelope_tenant_guard BEFORE INSERT OR UPDATE OF tenant_id, subject_kind, subject_id, key_registry_id, key_version, crypto_provider, provider_key_version
  ON pii_envelope_records FOR EACH ROW EXECUTE FUNCTION enforce_pii_envelope_tenant();
DROP TRIGGER IF EXISTS pii_blind_index_tenant_guard ON pii_blind_indexes;
CREATE TRIGGER pii_blind_index_tenant_guard BEFORE INSERT OR UPDATE OF tenant_id, subject_kind, subject_id, key_registry_id, key_version, crypto_provider, provider_key_version
  ON pii_blind_indexes FOR EACH ROW EXECUTE FUNCTION enforce_pii_blind_index_tenant();

CREATE OR REPLACE FUNCTION enforce_pii_rotation_job_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_tenant INTEGER; target_tenant INTEGER; source_provider TEXT; target_provider TEXT; source_blind_tenant INTEGER; target_blind_tenant INTEGER;
BEGIN
  SELECT tenant_id, provider INTO source_tenant, source_provider FROM pii_encryption_key_registry WHERE id = NEW.source_encryption_key_registry_id;
  SELECT tenant_id, provider INTO target_tenant, target_provider FROM pii_encryption_key_registry WHERE id = NEW.target_encryption_key_registry_id;
  IF source_tenant IS DISTINCT FROM NEW.tenant_id OR target_tenant IS DISTINCT FROM NEW.tenant_id OR target_provider <> 'vault_transit' THEN RAISE EXCEPTION 'PII rotation job encryption registries must be tenant-bound and target Vault Transit'; END IF;
  IF NEW.mode = 'transit_rewrap' AND source_provider <> 'vault_transit' THEN RAISE EXCEPTION 'Transit rewrap requires a Vault Transit source key'; END IF;
  IF NEW.mode = 'legacy_cutover' AND source_provider <> 'legacy_local_aes' THEN RAISE EXCEPTION 'Legacy cutover requires a legacy local AES source key'; END IF;
  IF NEW.source_blind_index_key_registry_id IS NOT NULL THEN
    SELECT tenant_id INTO source_blind_tenant FROM pii_blind_index_key_registry WHERE id = NEW.source_blind_index_key_registry_id;
    SELECT tenant_id INTO target_blind_tenant FROM pii_blind_index_key_registry WHERE id = NEW.target_blind_index_key_registry_id;
    IF source_blind_tenant IS DISTINCT FROM NEW.tenant_id OR target_blind_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'PII rotation job blind-index registries must be tenant-bound'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pii_rotation_job_integrity BEFORE INSERT OR UPDATE OF tenant_id, source_encryption_key_registry_id, target_encryption_key_registry_id, source_blind_index_key_registry_id, target_blind_index_key_registry_id, mode
  ON pii_rotation_jobs FOR EACH ROW EXECUTE FUNCTION enforce_pii_rotation_job_integrity();

CREATE OR REPLACE FUNCTION enforce_pii_rotation_item_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job_tenant INTEGER; envelope_tenant INTEGER; envelope_subject_kind TEXT; envelope_subject_id INTEGER; envelope_purpose TEXT;
BEGIN
  SELECT tenant_id INTO job_tenant FROM pii_rotation_jobs WHERE id = NEW.rotation_job_id;
  SELECT tenant_id, subject_kind, subject_id, purpose INTO envelope_tenant, envelope_subject_kind, envelope_subject_id, envelope_purpose FROM pii_envelope_records WHERE id = NEW.envelope_id;
  IF job_tenant IS DISTINCT FROM NEW.tenant_id OR envelope_tenant IS DISTINCT FROM NEW.tenant_id OR envelope_subject_kind IS DISTINCT FROM NEW.subject_kind OR envelope_subject_id IS DISTINCT FROM NEW.subject_id OR envelope_purpose IS DISTINCT FROM NEW.purpose THEN RAISE EXCEPTION 'PII rotation item must match its tenant-bound job and envelope'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pii_rotation_item_integrity BEFORE INSERT OR UPDATE OF rotation_job_id, envelope_id, tenant_id, subject_kind, subject_id, purpose
  ON pii_rotation_job_items FOR EACH ROW EXECUTE FUNCTION enforce_pii_rotation_item_integrity();

CREATE OR REPLACE FUNCTION enforce_pii_forensic_detail() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE forbidden_key TEXT;
BEGIN
  FOR forbidden_key IN SELECT jsonb_object_keys(NEW.detail) LOOP
    IF forbidden_key NOT IN ('record_count','registry_id','source_registry_id','target_registry_id','rotation_job_id','reason_code','error_code','actor_role','source_key_version','target_key_version','provider_key_version','evidence_ref','channel','dry_run','checkpoint','state','worker_version','incident_ref') THEN
      RAISE EXCEPTION 'PII forensic audit detail contains an unapproved field';
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;
CREATE TRIGGER pii_forensic_detail_guard BEFORE INSERT OR UPDATE ON pii_forensic_audit_events FOR EACH ROW EXECUTE FUNCTION enforce_pii_forensic_detail();
CREATE OR REPLACE FUNCTION reject_pii_forensic_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PII forensic audit events are append-only'; END; $$;
CREATE TRIGGER pii_forensic_event_no_update BEFORE UPDATE ON pii_forensic_audit_events FOR EACH ROW EXECUTE FUNCTION reject_pii_forensic_event_mutation();
CREATE TRIGGER pii_forensic_event_no_delete BEFORE DELETE ON pii_forensic_audit_events FOR EACH ROW EXECUTE FUNCTION reject_pii_forensic_event_mutation();

CREATE OR REPLACE FUNCTION reject_pii_rotation_item_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.rotation_job_id IS DISTINCT FROM NEW.rotation_job_id OR OLD.envelope_id IS DISTINCT FROM NEW.envelope_id OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.subject_kind IS DISTINCT FROM NEW.subject_kind OR OLD.subject_id IS DISTINCT FROM NEW.subject_id OR OLD.purpose IS DISTINCT FROM NEW.purpose THEN
    RAISE EXCEPTION 'PII rotation job item identity is immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pii_rotation_item_immutable BEFORE UPDATE ON pii_rotation_job_items FOR EACH ROW EXECUTE FUNCTION reject_pii_rotation_item_mutation();
