-- 0011_investigation_intelligence_controls.sql
-- PostgreSQL-only, tenant-scoped controls for explainable investigation decision support.
-- These tables deliberately store no raw biometric template and do not authorize an
-- external data-provider, monitoring feed, or automated adverse decision.

BEGIN;

CREATE TABLE IF NOT EXISTS investigation_score_policies (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  policy_code varchar(64) NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status varchar(24) NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  methodology jsonb NOT NULL,
  prohibited_factor_codes text[] NOT NULL DEFAULT ARRAY['biometric','race','ethnicity','religion','gender','disability','health','political_opinion','union_membership','sexual_orientation'],
  approved_by integer REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  effective_from timestamptz,
  retired_at timestamptz,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investigation_score_policy_version_unique UNIQUE (tenant_id, policy_code, version),
  CHECK ((status <> 'active') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND effective_from IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS investigation_score_policy_one_active_idx
  ON investigation_score_policies (tenant_id, policy_code) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS intelligence_source_catalog (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_code varchar(96) NOT NULL,
  source_class varchar(32) NOT NULL CHECK (source_class IN ('subject_provided','field_verified','informal_reference','licensed_provider','public_record','government_authorized','internal_case_record')),
  authority_level varchar(24) NOT NULL CHECK (authority_level IN ('unverified','declared','verified','licensed','government_authorized')),
  provider_authorization_id bigint REFERENCES data_provider_authorizations(id) ON DELETE RESTRICT,
  jurisdiction varchar(96) NOT NULL,
  permitted_purposes text[] NOT NULL CHECK (cardinality(permitted_purposes) > 0),
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
  active boolean NOT NULL DEFAULT true,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intelligence_source_catalog_unique UNIQUE (tenant_id, source_code),
  CHECK ((authority_level NOT IN ('licensed','government_authorized')) OR provider_authorization_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS intelligence_evidence_records (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id integer NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  investigation_id integer REFERENCES investigations(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES intelligence_source_catalog(id) ON DELETE RESTRICT,
  purpose_code varchar(64) NOT NULL,
  factor_code varchar(64) NOT NULL,
  assertion_direction smallint NOT NULL CHECK (assertion_direction IN (-1, 1)),
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > observed_at),
  evidence_sha256 char(64) NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  provenance_status varchar(24) NOT NULL CHECK (provenance_status IN ('claimed','attested','independently_confirmed','contradicted','withdrawn')),
  subject_disputed_at timestamptz,
  withdrawn_at timestamptz,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intelligence_evidence_digest_unique UNIQUE (tenant_id, evidence_sha256),
  CHECK ((provenance_status <> 'withdrawn') OR withdrawn_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS intelligence_evidence_candidate_idx ON intelligence_evidence_records (tenant_id, candidate_id, factor_code, expires_at);

CREATE TABLE IF NOT EXISTS intelligence_evidence_conflicts (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id integer NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  left_evidence_id uuid NOT NULL REFERENCES intelligence_evidence_records(id) ON DELETE RESTRICT,
  right_evidence_id uuid NOT NULL REFERENCES intelligence_evidence_records(id) ON DELETE RESTRICT,
  factor_code varchar(64) NOT NULL,
  status varchar(24) NOT NULL CHECK (status IN ('open','under_review','resolved','withdrawn')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_by integer REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  resolution_rationale text,
  CONSTRAINT intelligence_evidence_conflicts_pair_unique UNIQUE (left_evidence_id, right_evidence_id),
  CHECK (left_evidence_id <> right_evidence_id),
  CHECK ((status NOT IN ('resolved','withdrawn')) OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND length(trim(coalesce(resolution_rationale, ''))) >= 10))
);
CREATE INDEX IF NOT EXISTS intelligence_evidence_conflicts_open_idx ON intelligence_evidence_conflicts (tenant_id, candidate_id, detected_at) WHERE status IN ('open','under_review');

CREATE TABLE IF NOT EXISTS investigation_score_assessments (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id integer NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  investigation_id integer REFERENCES investigations(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL REFERENCES investigation_score_policies(id) ON DELETE RESTRICT,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  coverage numeric(5,4) NOT NULL CHECK (coverage >= 0 AND coverage <= 1),
  freshness numeric(5,4) NOT NULL CHECK (freshness >= 0 AND freshness <= 1),
  contradiction_count integer NOT NULL DEFAULT 0 CHECK (contradiction_count >= 0),
  decision_support_status varchar(32) NOT NULL CHECK (decision_support_status IN ('insufficient_evidence','manual_review_required','decision_support_only')),
  reason_codes text[] NOT NULL,
  input_sha256 char(64) NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  superseded_at timestamptz,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS investigation_score_assessments_current_idx ON investigation_score_assessments (tenant_id, candidate_id, calculated_at DESC) WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS investigation_score_factors (
  id bigserial PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES investigation_score_assessments(id) ON DELETE RESTRICT,
  evidence_id uuid REFERENCES intelligence_evidence_records(id) ON DELETE RESTRICT,
  factor_code varchar(64) NOT NULL,
  direction smallint NOT NULL CHECK (direction IN (-1, 1)),
  configured_weight numeric(8,4) NOT NULL CHECK (configured_weight > 0 AND configured_weight <= 40),
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  freshness numeric(5,4) NOT NULL CHECK (freshness >= 0 AND freshness <= 1),
  contribution numeric(8,4) NOT NULL,
  reason_code varchar(96) NOT NULL
);
CREATE INDEX IF NOT EXISTS investigation_score_factors_assessment_idx ON investigation_score_factors (assessment_id);

CREATE TABLE IF NOT EXISTS intelligence_review_cases (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id integer NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  investigation_id integer REFERENCES investigations(id) ON DELETE RESTRICT,
  assessment_id uuid REFERENCES investigation_score_assessments(id) ON DELETE RESTRICT,
  review_type varchar(32) NOT NULL CHECK (review_type IN ('score','conflict','freshness','fraud_signal','adverse_support','data_subject_correction')),
  priority varchar(16) NOT NULL CHECK (priority IN ('low','normal','high','critical')),
  status varchar(24) NOT NULL CHECK (status IN ('open','assigned','in_review','resolved','cancelled')),
  assigned_to integer REFERENCES users(id) ON DELETE RESTRICT,
  due_at timestamptz NOT NULL,
  resolved_by integer REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  resolution_rationale text,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status <> 'resolved') OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND length(trim(coalesce(resolution_rationale, ''))) >= 10))
);
CREATE INDEX IF NOT EXISTS intelligence_review_cases_queue_idx ON intelligence_review_cases (tenant_id, status, priority, due_at);

CREATE TABLE IF NOT EXISTS intelligence_reviewer_conflicts (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  review_case_id uuid NOT NULL REFERENCES intelligence_review_cases(id) ON DELETE RESTRICT,
  reviewer_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  conflict_type varchar(48) NOT NULL CHECK (conflict_type IN ('personal_relationship','prior_involvement','commercial_interest','other')),
  disclosed_at timestamptz NOT NULL DEFAULT now(),
  resolved_by integer REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  notes text NOT NULL CHECK (length(trim(notes)) >= 10),
  CONSTRAINT intelligence_reviewer_conflicts_one_open UNIQUE (review_case_id, reviewer_id, conflict_type)
);

CREATE TABLE IF NOT EXISTS intelligence_human_overrides (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assessment_id uuid NOT NULL REFERENCES investigation_score_assessments(id) ON DELETE RESTRICT,
  review_case_id uuid NOT NULL REFERENCES intelligence_review_cases(id) ON DELETE RESTRICT,
  prior_status varchar(32) NOT NULL,
  overridden_status varchar(32) NOT NULL CHECK (overridden_status IN ('manual_review_required','decision_support_only','insufficient_evidence')),
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 20),
  approved_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intelligence_human_overrides_one_per_case UNIQUE (review_case_id)
);

CREATE TABLE IF NOT EXISTS intelligence_monitoring_registrations (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id integer NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  purpose_code varchar(64) NOT NULL,
  provider_authorization_id bigint REFERENCES data_provider_authorizations(id) ON DELETE RESTRICT,
  consent_ref varchar(32) REFERENCES candidate_consents("consentRef") ON DELETE RESTRICT,
  status varchar(40) NOT NULL CHECK (status IN ('disabled_pending_provider_authorization','active','paused','expired','revoked')),
  next_review_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status <> 'active') OR (provider_authorization_id IS NOT NULL AND consent_ref IS NOT NULL AND next_review_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS intelligence_monitoring_due_idx ON intelligence_monitoring_registrations (status, next_review_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS intelligence_fraud_signals (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id integer NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  investigation_id integer REFERENCES investigations(id) ON DELETE RESTRICT,
  signal_type varchar(48) NOT NULL CHECK (signal_type IN ('identity_inconsistency','document_reuse','evidence_checksum_mismatch','velocity_anomaly','unusual_access','provider_response_anomaly')),
  severity varchar(16) NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  evidence_sha256 char(64) NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  status varchar(24) NOT NULL CHECK (status IN ('open','triaged','resolved','false_positive')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_by integer REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  resolution_rationale text,
  CONSTRAINT intelligence_fraud_signals_dedup UNIQUE (tenant_id, candidate_id, signal_type, evidence_sha256),
  CHECK ((status NOT IN ('resolved','false_positive')) OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND length(trim(coalesce(resolution_rationale, ''))) >= 10))
);
CREATE INDEX IF NOT EXISTS intelligence_fraud_signals_open_idx ON intelligence_fraud_signals (tenant_id, severity, detected_at) WHERE status IN ('open','triaged');

CREATE TABLE IF NOT EXISTS intelligence_audit_events (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type varchar(64) NOT NULL,
  actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  subject_candidate_id integer REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  resource_type varchar(64) NOT NULL,
  resource_id uuid,
  event_sha256 char(64) NOT NULL CHECK (event_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intelligence_audit_events_tenant_time_idx ON intelligence_audit_events (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_intelligence_source_provider_authorization()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authorization_tenant integer; authorization_state varchar; authorization_effective timestamptz; authorization_expires timestamptz;
BEGIN
  IF NEW.authority_level IN ('licensed','government_authorized') AND NEW.provider_authorization_id IS NULL THEN
    RAISE EXCEPTION 'licensed and government-authorized sources require provider authorization';
  END IF;
  IF NEW.provider_authorization_id IS NOT NULL THEN
    SELECT tenant_id, status, effective_at, expires_at INTO authorization_tenant, authorization_state, authorization_effective, authorization_expires FROM data_provider_authorizations WHERE id = NEW.provider_authorization_id;
    IF authorization_state IS NULL OR authorization_state <> 'active' OR authorization_effective IS NULL OR authorization_expires IS NULL OR authorization_effective > now() OR authorization_expires <= now() OR (authorization_tenant IS NOT NULL AND authorization_tenant <> NEW.tenant_id) THEN
      RAISE EXCEPTION 'provider authorization is inactive, expired, or tenant-mismatched';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER intelligence_source_provider_authorization_guard BEFORE INSERT OR UPDATE ON intelligence_source_catalog FOR EACH ROW EXECUTE FUNCTION enforce_intelligence_source_provider_authorization();

CREATE OR REPLACE FUNCTION enforce_intelligence_monitoring_authorization()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE consent_tenant integer; consent_candidate integer; authorization_tenant integer; authorization_state varchar; authorization_expires timestamptz;
BEGIN
  IF NEW.status = 'active' THEN
    IF NEW.consent_ref IS NULL OR NEW.provider_authorization_id IS NULL OR NEW.next_review_at IS NULL THEN RAISE EXCEPTION 'active monitoring requires consent, provider authorization, and schedule'; END IF;
    SELECT "tenantId", "candidateId" INTO consent_tenant, consent_candidate FROM candidate_consents WHERE "consentRef" = NEW.consent_ref;
    SELECT tenant_id, status, expires_at INTO authorization_tenant, authorization_state, authorization_expires FROM data_provider_authorizations WHERE id = NEW.provider_authorization_id;
    IF consent_tenant IS NULL OR consent_tenant <> NEW.tenant_id OR consent_candidate <> NEW.candidate_id OR authorization_state <> 'active' OR authorization_expires IS NULL OR authorization_expires <= now() OR (authorization_tenant IS NOT NULL AND authorization_tenant <> NEW.tenant_id) THEN
      RAISE EXCEPTION 'active monitoring authorization or consent is invalid';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER intelligence_monitoring_authorization_guard BEFORE INSERT OR UPDATE ON intelligence_monitoring_registrations FOR EACH ROW EXECUTE FUNCTION enforce_intelligence_monitoring_authorization();

CREATE OR REPLACE FUNCTION enforce_intelligence_evidence_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate_tenant integer; source_tenant integer; investigation_tenant integer;
BEGIN
  SELECT "tenantId" INTO candidate_tenant FROM candidate_profiles WHERE id = NEW.candidate_id;
  SELECT tenant_id INTO source_tenant FROM intelligence_source_catalog WHERE id = NEW.source_id;
  IF NEW.investigation_id IS NOT NULL THEN SELECT "tenantId" INTO investigation_tenant FROM investigations WHERE id = NEW.investigation_id; END IF;
  IF NEW.factor_code = ANY (ARRAY['biometric','race','ethnicity','religion','gender','disability','health','political_opinion','union_membership','sexual_orientation']) THEN
    RAISE EXCEPTION 'sensitive and biometric factors cannot be scored';
  END IF;
  IF candidate_tenant IS NULL OR candidate_tenant <> NEW.tenant_id OR source_tenant <> NEW.tenant_id OR (NEW.investigation_id IS NOT NULL AND investigation_tenant <> NEW.tenant_id) THEN
    RAISE EXCEPTION 'intelligence evidence tenant mismatch';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER intelligence_evidence_tenant_guard BEFORE INSERT OR UPDATE ON intelligence_evidence_records FOR EACH ROW EXECUTE FUNCTION enforce_intelligence_evidence_tenant();

CREATE OR REPLACE FUNCTION enforce_intelligence_conflict_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE left_tenant integer; right_tenant integer; left_candidate integer; right_candidate integer;
BEGIN
  SELECT tenant_id, candidate_id INTO left_tenant, left_candidate FROM intelligence_evidence_records WHERE id = NEW.left_evidence_id;
  SELECT tenant_id, candidate_id INTO right_tenant, right_candidate FROM intelligence_evidence_records WHERE id = NEW.right_evidence_id;
  IF left_tenant IS NULL OR left_tenant <> NEW.tenant_id OR right_tenant <> NEW.tenant_id OR left_candidate <> NEW.candidate_id OR right_candidate <> NEW.candidate_id THEN
    RAISE EXCEPTION 'intelligence conflict tenant or candidate mismatch';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER intelligence_conflict_tenant_guard BEFORE INSERT OR UPDATE ON intelligence_evidence_conflicts FOR EACH ROW EXECUTE FUNCTION enforce_intelligence_conflict_tenant();

CREATE OR REPLACE FUNCTION immutable_intelligence_audit_event()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intelligence audit events are append-only'; END; $$;
CREATE TRIGGER intelligence_audit_events_immutable_update BEFORE UPDATE ON intelligence_audit_events FOR EACH ROW EXECUTE FUNCTION immutable_intelligence_audit_event();
CREATE TRIGGER intelligence_audit_events_immutable_delete BEFORE DELETE ON intelligence_audit_events FOR EACH ROW EXECUTE FUNCTION immutable_intelligence_audit_event();

COMMIT;
