-- Consumer access and FCRA/NDPA dispute/reinvestigation controls.
-- This migration is additive. It does not enable a live provider: outbound access remains
-- denied until a time-bounded data_provider_authorizations row is active and in scope.

CREATE TABLE consumer_subject_bindings (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id INTEGER REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  consumer_profile_id BIGINT REFERENCES consumer_discovery_profiles(id) ON DELETE RESTRICT,
  assurance_level TEXT NOT NULL,
  verification_reference TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_subject_binding_subject CHECK (
    (candidate_id IS NOT NULL)::integer + (consumer_profile_id IS NOT NULL)::integer = 1
  ),
  CONSTRAINT consumer_subject_binding_assurance CHECK (
    assurance_level IN ('account_verified', 'identity_verified', 'manual_verified')
  )
);
CREATE UNIQUE INDEX consumer_subject_bindings_active_candidate_idx
  ON consumer_subject_bindings (tenant_id, candidate_id)
  WHERE candidate_id IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX consumer_subject_bindings_active_profile_idx
  ON consumer_subject_bindings (user_id, consumer_profile_id)
  WHERE consumer_profile_id IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX consumer_subject_bindings_tenant_idx
  ON consumer_subject_bindings (tenant_id, user_id, verified_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE consumer_report_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_ref TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id INTEGER REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  screening_order_id INTEGER REFERENCES screening_orders(id) ON DELETE RESTRICT,
  report_id INTEGER REFERENCES reports(id) ON DELETE RESTRICT,
  jurisdiction_code TEXT NOT NULL,
  report_purpose TEXT NOT NULL,
  report_version INTEGER NOT NULL DEFAULT 1,
  content_sha256 CHAR(64) NOT NULL,
  manifest JSONB NOT NULL,
  encrypted_object_key TEXT,
  object_version_id TEXT,
  kms_key_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  CONSTRAINT consumer_report_snapshots_subject CHECK (
    (candidate_id IS NOT NULL)::integer + (screening_order_id IS NOT NULL)::integer + (report_id IS NOT NULL)::integer >= 1
  ),
  CONSTRAINT consumer_report_snapshots_version CHECK (report_version > 0),
  CONSTRAINT consumer_report_snapshots_digest CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX consumer_report_snapshots_candidate_idx
  ON consumer_report_snapshots (tenant_id, candidate_id, created_at DESC);
CREATE INDEX consumer_report_snapshots_order_idx
  ON consumer_report_snapshots (tenant_id, screening_order_id, created_at DESC);
CREATE UNIQUE INDEX consumer_report_snapshots_hash_version_idx
  ON consumer_report_snapshots (tenant_id, content_sha256, report_version);

CREATE TABLE data_provider_authorizations (
  id BIGSERIAL PRIMARY KEY,
  authorization_ref TEXT NOT NULL UNIQUE,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE RESTRICT,
  data_source_id INTEGER NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  provider_code TEXT NOT NULL,
  environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  contract_reference TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  approved_use_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_jurisdictions JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_data_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  lawful_basis_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  credential_secret_ref TEXT NOT NULL,
  network_policy_ref TEXT,
  certification_reference TEXT,
  approved_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  effective_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  suspension_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT data_provider_authorizations_environment CHECK (environment IN ('sandbox', 'staging', 'production')),
  CONSTRAINT data_provider_authorizations_status CHECK (
    status IN ('draft', 'pending_provider', 'certification_pending', 'active', 'suspended', 'expired', 'revoked')
  ),
  CONSTRAINT data_provider_authorizations_active_metadata CHECK (
    status <> 'active' OR (
      approved_by_user_id IS NOT NULL AND effective_at IS NOT NULL AND expires_at IS NOT NULL
      AND expires_at > effective_at AND jsonb_array_length(approved_use_cases) > 0
      AND jsonb_array_length(approved_jurisdictions) > 0 AND jsonb_array_length(approved_data_fields) > 0
    )
  )
);
CREATE UNIQUE INDEX data_provider_authorizations_active_scope_idx
  ON data_provider_authorizations (data_source_id, environment, COALESCE(tenant_id, 0))
  WHERE status = 'active';
CREATE INDEX data_provider_authorizations_expiry_idx
  ON data_provider_authorizations (status, expires_at ASC NULLS LAST);

CREATE TABLE consumer_dispute_cases (
  id BIGSERIAL PRIMARY KEY,
  case_ref TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  rights_request_id BIGINT REFERENCES consumer_rights_requests(id) ON DELETE RESTRICT,
  requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject_binding_id BIGINT NOT NULL REFERENCES consumer_subject_bindings(id) ON DELETE RESTRICT,
  report_snapshot_id BIGINT REFERENCES consumer_report_snapshots(id) ON DELETE RESTRICT,
  adverse_action_id INTEGER REFERENCES adverse_actions(id) ON DELETE RESTRICT,
  framework TEXT NOT NULL,
  jurisdiction_code TEXT NOT NULL,
  case_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'identity_pending',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  reinvestigation_due_at TIMESTAMPTZ,
  extension_due_at TIMESTAMPTZ,
  extension_reason TEXT,
  source_notice_due_at TIMESTAMPTZ,
  result_notice_due_at TIMESTAMPTZ,
  method_description_due_at TIMESTAMPTZ,
  assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_dispute_cases_framework CHECK (framework IN ('ndpa', 'fcra', 'dual')),
  CONSTRAINT consumer_dispute_cases_type CHECK (
    case_type IN ('access', 'accuracy', 'completeness', 'source_provenance', 'suppression', 'objection', 'deletion', 'method_description')
  ),
  CONSTRAINT consumer_dispute_cases_status CHECK (
    status IN ('identity_pending', 'received', 'accepted', 'source_pending', 'investigating', 'awaiting_consumer', 'frivolous', 'resolved', 'withdrawn', 'escalated')
  ),
  CONSTRAINT consumer_dispute_cases_fcra_clock CHECK (
    framework = 'ndpa' OR reinvestigation_due_at IS NOT NULL
  ),
  CONSTRAINT consumer_dispute_cases_extension CHECK (
    extension_due_at IS NULL OR (extension_reason IS NOT NULL AND reinvestigation_due_at IS NOT NULL AND extension_due_at > reinvestigation_due_at)
  ),
  CONSTRAINT consumer_dispute_cases_completion CHECK (
    status NOT IN ('resolved', 'withdrawn') OR completed_at IS NOT NULL
  )
);
CREATE INDEX consumer_dispute_cases_queue_idx
  ON consumer_dispute_cases (status, reinvestigation_due_at ASC NULLS LAST);
CREATE INDEX consumer_dispute_cases_subject_idx
  ON consumer_dispute_cases (tenant_id, subject_binding_id, created_at DESC);
CREATE INDEX consumer_dispute_cases_requester_idx
  ON consumer_dispute_cases (requester_user_id, created_at DESC);

CREATE TABLE consumer_dispute_items (
  id BIGSERIAL PRIMARY KEY,
  item_ref TEXT NOT NULL UNIQUE,
  case_id BIGINT NOT NULL REFERENCES consumer_dispute_cases(id) ON DELETE RESTRICT,
  screening_result_id INTEGER REFERENCES screening_results(id) ON DELETE RESTRICT,
  adverse_item_id INTEGER REFERENCES adverse_items(id) ON DELETE RESTRICT,
  report_item_key TEXT NOT NULL,
  disputed_value JSONB,
  consumer_statement TEXT NOT NULL,
  source_category TEXT,
  disposition TEXT NOT NULL DEFAULT 'pending',
  disposition_rationale TEXT,
  held_from_automation_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_dispute_items_source CHECK (
    screening_result_id IS NOT NULL OR adverse_item_id IS NOT NULL OR length(report_item_key) > 0
  ),
  CONSTRAINT consumer_dispute_items_disposition CHECK (
    disposition IN ('pending', 'verified', 'corrected', 'deleted', 'partially_resolved', 'unverifiable', 'not_in_scope')
  ),
  CONSTRAINT consumer_dispute_items_resolution CHECK (
    disposition = 'pending' OR (disposition_rationale IS NOT NULL AND resolved_at IS NOT NULL)
  )
);
CREATE INDEX consumer_dispute_items_case_idx ON consumer_dispute_items (case_id, disposition);
CREATE INDEX consumer_dispute_items_hold_idx ON consumer_dispute_items (held_from_automation_at)
  WHERE disposition = 'pending';

CREATE TABLE consumer_dispute_evidence (
  id BIGSERIAL PRIMARY KEY,
  evidence_ref TEXT NOT NULL UNIQUE,
  case_id BIGINT NOT NULL REFERENCES consumer_dispute_cases(id) ON DELETE RESTRICT,
  submitted_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  object_version_id TEXT,
  kms_key_id TEXT NOT NULL,
  ciphertext_sha256 CHAR(64) NOT NULL,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  custody_status TEXT NOT NULL DEFAULT 'initiated',
  expires_at TIMESTAMPTZ NOT NULL,
  retained_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  CONSTRAINT consumer_dispute_evidence_digest CHECK (ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT consumer_dispute_evidence_size CHECK (byte_size > 0 AND byte_size <= 10485760),
  CONSTRAINT consumer_dispute_evidence_status CHECK (custody_status IN ('initiated', 'verified', 'quarantined', 'deleted'))
);
CREATE UNIQUE INDEX consumer_dispute_evidence_idempotency_idx
  ON consumer_dispute_evidence (case_id, submitted_by_user_id, idempotency_key);
CREATE INDEX consumer_dispute_evidence_case_idx ON consumer_dispute_evidence (case_id, created_at ASC);
CREATE INDEX consumer_dispute_evidence_expiry_idx
  ON consumer_dispute_evidence (custody_status, expires_at);

CREATE TABLE consumer_dispute_source_tasks (
  id BIGSERIAL PRIMARY KEY,
  task_ref TEXT NOT NULL UNIQUE,
  case_id BIGINT NOT NULL REFERENCES consumer_dispute_cases(id) ON DELETE RESTRICT,
  dispute_item_id BIGINT REFERENCES consumer_dispute_items(id) ON DELETE RESTRICT,
  provider_authorization_id BIGINT NOT NULL REFERENCES data_provider_authorizations(id) ON DELETE RESTRICT,
  data_source_id INTEGER NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  source_record_ref TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  all_relevant_evidence_manifest_sha256 CHAR(64) NOT NULL,
  dispatched_at TIMESTAMPTZ,
  response_due_at TIMESTAMPTZ,
  response_received_at TIMESTAMPTZ,
  response_disposition TEXT,
  response_manifest JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_dispute_source_tasks_status CHECK (status IN ('pending', 'dispatched', 'acknowledged', 'responded', 'failed', 'cancelled')),
  CONSTRAINT consumer_dispute_source_tasks_manifest_digest CHECK (all_relevant_evidence_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT consumer_dispute_source_tasks_disposition CHECK (response_disposition IS NULL OR response_disposition IN ('verified', 'corrected', 'deleted', 'unverifiable', 'no_response')),
  CONSTRAINT consumer_dispute_source_tasks_response CHECK (response_received_at IS NULL OR status IN ('acknowledged', 'responded', 'failed')),
  CONSTRAINT consumer_dispute_source_tasks_idempotency UNIQUE (provider_authorization_id, idempotency_key)
);
CREATE INDEX consumer_dispute_source_tasks_clock_idx
  ON consumer_dispute_source_tasks (status, response_due_at ASC NULLS LAST);
CREATE INDEX consumer_dispute_source_tasks_case_idx ON consumer_dispute_source_tasks (case_id, created_at ASC);

CREATE TABLE consumer_dispute_notices (
  id BIGSERIAL PRIMARY KEY,
  notice_ref TEXT NOT NULL UNIQUE,
  case_id BIGINT NOT NULL REFERENCES consumer_dispute_cases(id) ON DELETE RESTRICT,
  notice_type TEXT NOT NULL,
  template_version TEXT NOT NULL,
  delivery_channel TEXT NOT NULL,
  recipient_kind TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'queued',
  secure_object_key TEXT,
  content_sha256 CHAR(64) NOT NULL,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  CONSTRAINT consumer_dispute_notices_type CHECK (notice_type IN ('acknowledgement', 'identity_needed', 'frivolous', 'extension', 'result', 'method_description', 'reinsertion', 'recipient_remediation')),
  CONSTRAINT consumer_dispute_notices_channel CHECK (delivery_channel IN ('portal', 'email', 'postal', 'api')),
  CONSTRAINT consumer_dispute_notices_recipient CHECK (recipient_kind IN ('consumer', 'institution', 'furnisher', 'provider')),
  CONSTRAINT consumer_dispute_notices_status CHECK (delivery_status IN ('queued', 'sent', 'delivered', 'failed')),
  CONSTRAINT consumer_dispute_notices_digest CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX consumer_dispute_notices_case_idx ON consumer_dispute_notices (case_id, notice_type, queued_at DESC);

CREATE TABLE consumer_dispute_events (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES consumer_dispute_cases(id) ON DELETE RESTRICT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  actor_kind TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_dispute_events_actor CHECK (actor_kind IN ('consumer', 'caseworker', 'supervisor', 'provider', 'system')),
  CONSTRAINT consumer_dispute_events_type CHECK (event_type IN (
    'submitted', 'identity_verified', 'accepted', 'assigned', 'item_held', 'source_task_created',
    'source_task_dispatched', 'source_response_recorded', 'extension_applied', 'frivolous_determined',
    'item_corrected', 'item_deleted', 'item_verified', 'item_unverifiable', 'notice_queued',
    'notice_delivered', 'method_description_requested', 'method_description_delivered', 'withdrawn',
    'completed', 'reinserted', 'recipient_remediation_queued', 'evidence_initiated',
    'evidence_verified', 'evidence_quarantined'
  )),
  CONSTRAINT consumer_dispute_events_digest CHECK (integrity_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX consumer_dispute_events_case_idx ON consumer_dispute_events (case_id, created_at ASC);

CREATE OR REPLACE FUNCTION consumer_dispute_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'consumer_dispute_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER consumer_dispute_events_no_update
  BEFORE UPDATE ON consumer_dispute_events
  FOR EACH ROW EXECUTE FUNCTION consumer_dispute_events_append_only();
CREATE TRIGGER consumer_dispute_events_no_delete
  BEFORE DELETE ON consumer_dispute_events
  FOR EACH ROW EXECUTE FUNCTION consumer_dispute_events_append_only();

COMMENT ON TABLE consumer_subject_bindings IS
  'Verified, revocable association between a BIS user and exactly one candidate or consumer profile for rights workflows.';
COMMENT ON TABLE consumer_report_snapshots IS
  'Immutable, hashed consumer-report snapshots. Corrections create superseding snapshots; original report content is never overwritten.';
COMMENT ON TABLE data_provider_authorizations IS
  'Runtime deny-by-default authorization registry. A signed provider contract and active record are required before outbound use.';
COMMENT ON TABLE consumer_dispute_cases IS
  'Consumer access, accuracy, completeness, and statutory reinvestigation cases with counsel-configured due dates.';
COMMENT ON TABLE consumer_dispute_items IS
  'Individually resolved report items; pending items are withheld from automated conclusions.';
COMMENT ON TABLE consumer_dispute_evidence IS
  'Encrypted direct-to-object-store consumer evidence custody metadata; evidence bytes never transit the BFF.';
COMMENT ON TABLE consumer_dispute_source_tasks IS
  'Auditable, idempotent source/furnisher reinvestigation tasks with an all-relevant-evidence manifest hash.';
COMMENT ON TABLE consumer_dispute_events IS
  'Application-HMAC-protected, database-append-only lifecycle history for consumer dispute and reinvestigation cases.';
