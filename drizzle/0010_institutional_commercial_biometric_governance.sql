-- 0010_institutional_commercial_biometric_governance.sql
-- Additive PostgreSQL-only controls for commercial entitlements, institutional
-- authority, informal-sector provenance, and biometric governance.
--
-- This migration deliberately does not create an external-provider adapter or
-- infer a government/law-enforcement authority. Every dispatch must be bound to
-- an approved, unexpired, tenant-scoped authorization record.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Commercial plan, subscription, usage, invoice, refund, webhook, and outbox.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_plans (
  id bigserial PRIMARY KEY,
  plan_code varchar(64) NOT NULL UNIQUE,
  display_name varchar(160) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  billing_interval varchar(16) NOT NULL CHECK (billing_interval IN ('monthly', 'annual')),
  price_kobo bigint NOT NULL CHECK (price_kobo >= 0),
  included_completed_checks integer NOT NULL DEFAULT 0 CHECK (included_completed_checks >= 0),
  overage_price_kobo bigint NOT NULL DEFAULT 0 CHECK (overage_price_kobo >= 0),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_id bigint NOT NULL REFERENCES billing_plans(id) ON DELETE RESTRICT,
  provider varchar(32) NOT NULL CHECK (provider IN ('paystack', 'manual_contract')),
  provider_customer_ref varchar(160),
  provider_subscription_ref varchar(160),
  status varchar(24) NOT NULL CHECK (status IN ('pending', 'active', 'past_due', 'cancelling', 'cancelled', 'suspended')),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL CHECK (current_period_end > current_period_start),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  suspended_at timestamptz,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_subscriptions_provider_ref_unique UNIQUE (provider, provider_subscription_ref)
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_subscriptions_single_active_idx
  ON tenant_subscriptions (tenant_id)
  WHERE status IN ('pending', 'active', 'past_due', 'cancelling');

CREATE TABLE IF NOT EXISTS billing_entitlements (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES tenant_subscriptions(id) ON DELETE RESTRICT,
  entitlement_kind varchar(32) NOT NULL CHECK (entitlement_kind IN ('subscription_included_check', 'prepaid_credit', 'manual_contract_check')),
  total_units integer NOT NULL CHECK (total_units > 0),
  consumed_units integer NOT NULL DEFAULT 0 CHECK (consumed_units >= 0 AND consumed_units <= total_units),
  reserved_units integer NOT NULL DEFAULT 0 CHECK (reserved_units >= 0 AND reserved_units <= total_units),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK (period_end > period_start),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  source_reference varchar(160) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_entitlements_available_idx
  ON billing_entitlements (tenant_id, status, period_end)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS billing_check_reservations (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entitlement_id uuid NOT NULL REFERENCES billing_entitlements(id) ON DELETE RESTRICT,
  investigation_ref varchar(128) NOT NULL,
  requested_tier varchar(32) NOT NULL CHECK (requested_tier IN ('basic', 'standard', 'premium')),
  status varchar(16) NOT NULL CHECK (status IN ('reserved', 'consumed', 'released', 'expired')),
  idempotency_key uuid NOT NULL,
  reserved_by integer REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason varchar(256),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_check_reservations_idempotency_unique UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT billing_check_reservations_investigation_unique UNIQUE (tenant_id, investigation_ref)
);
CREATE INDEX IF NOT EXISTS billing_check_reservations_expiry_idx
  ON billing_check_reservations (status, expires_at)
  WHERE status = 'reserved';

CREATE TABLE IF NOT EXISTS billing_usage_events (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL REFERENCES billing_check_reservations(id) ON DELETE RESTRICT,
  usage_type varchar(32) NOT NULL CHECK (usage_type IN ('completed_authorized_check', 'reversal')),
  units integer NOT NULL CHECK (units IN (1, -1)),
  investigation_ref varchar(128) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_by integer REFERENCES users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT billing_usage_events_reservation_unique UNIQUE (reservation_id, usage_type)
);
CREATE INDEX IF NOT EXISTS billing_usage_events_tenant_time_idx ON billing_usage_events (tenant_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES tenant_subscriptions(id) ON DELETE RESTRICT,
  invoice_number varchar(64) NOT NULL UNIQUE,
  currency char(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  subtotal_kobo bigint NOT NULL CHECK (subtotal_kobo >= 0),
  tax_kobo bigint NOT NULL DEFAULT 0 CHECK (tax_kobo >= 0),
  total_kobo bigint NOT NULL CHECK (total_kobo = subtotal_kobo + tax_kobo),
  status varchar(24) NOT NULL CHECK (status IN ('draft', 'issued', 'paid', 'void', 'uncollectible', 'refunded')),
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  provider_reference varchar(160) UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_payment_intents (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  initiated_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider varchar(32) NOT NULL CHECK (provider = 'paystack'),
  provider_reference varchar(160) NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo >= 10000),
  currency char(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  customer_email varchar(320) NOT NULL,
  purpose varchar(32) NOT NULL CHECK (purpose IN ('prepaid_credit', 'subscription_invoice')),
  status varchar(24) NOT NULL CHECK (status IN ('initializing', 'pending', 'verified', 'credited', 'failed', 'cancelled')),
  paystack_access_code varchar(160),
  initialized_at timestamptz,
  verified_at timestamptz,
  credited_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_payment_intents_provider_reference_unique UNIQUE (provider, provider_reference)
);
CREATE INDEX IF NOT EXISTS billing_payment_intents_reconcile_idx
  ON billing_payment_intents (status, expires_at)
  WHERE status IN ('pending', 'verified');

CREATE TABLE IF NOT EXISTS billing_invoice_lines (
  id bigserial PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES billing_invoices(id) ON DELETE RESTRICT,
  line_type varchar(32) NOT NULL CHECK (line_type IN ('subscription', 'overage', 'credit_topup', 'adjustment', 'refund')),
  description varchar(512) NOT NULL,
  quantity integer NOT NULL CHECK (quantity <> 0),
  unit_amount_kobo bigint NOT NULL,
  amount_kobo bigint NOT NULL,
  usage_event_id uuid REFERENCES billing_usage_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_kobo = quantity * unit_amount_kobo)
);

CREATE TABLE IF NOT EXISTS billing_refunds (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES billing_invoices(id) ON DELETE RESTRICT,
  payment_reference varchar(160) NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  reason varchar(1024) NOT NULL CHECK (length(trim(reason)) >= 10),
  status varchar(24) NOT NULL CHECK (status IN ('requested', 'approved', 'submitted', 'processed', 'rejected', 'failed')),
  requested_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by integer REFERENCES users(id) ON DELETE RESTRICT,
  provider_ref varchar(160),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
CREATE INDEX IF NOT EXISTS billing_refunds_pending_idx ON billing_refunds (status, requested_at) WHERE status IN ('requested', 'approved', 'submitted');

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id uuid PRIMARY KEY,
  provider varchar(32) NOT NULL CHECK (provider = 'paystack'),
  event_id varchar(160),
  event_type varchar(80) NOT NULL,
  provider_reference varchar(160),
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status varchar(24) NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'retryable_failure', 'terminal_failure')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz,
  last_error_code varchar(64),
  last_error_at timestamptz,
  payload jsonb NOT NULL,
  CONSTRAINT payment_webhook_events_dedup UNIQUE (provider, payload_sha256)
);
CREATE INDEX IF NOT EXISTS payment_webhook_events_retry_idx
  ON payment_webhook_events (status, next_attempt_at)
  WHERE status IN ('received', 'retryable_failure');

CREATE TABLE IF NOT EXISTS billing_delivery_outbox (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type varchar(64) NOT NULL CHECK (event_type IN ('paystack_webhook_received', 'subscription_changed', 'invoice_due', 'refund_submitted')),
  payload_ciphertext bytea NOT NULL,
  payload_nonce bytea NOT NULL CHECK (octet_length(payload_nonce) = 12),
  payload_key_version varchar(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'delivered', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_at timestamptz,
  lease_owner varchar(128),
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_delivery_outbox_ready_idx
  ON billing_delivery_outbox (status, available_at)
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- Institution and law-enforcement authority. These are required for every
-- restricted data request and never grant an external provider entitlement.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS institution_authorizations (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  institution_type varchar(32) NOT NULL CHECK (institution_type IN ('employer', 'government', 'law_enforcement', 'verification_firm')),
  authority_reference varchar(160) NOT NULL,
  lawful_basis varchar(64) NOT NULL,
  permitted_purposes text[] NOT NULL CHECK (cardinality(permitted_purposes) > 0),
  permitted_sources text[] NOT NULL CHECK (cardinality(permitted_sources) > 0),
  jurisdiction varchar(96) NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL CHECK (valid_until > valid_from),
  status varchar(16) NOT NULL CHECK (status IN ('pending', 'active', 'suspended', 'revoked', 'expired')),
  approved_by integer REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  revoked_by integer REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revocation_reason text,
  evidence_ref varchar(128),
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_authorizations_reference_unique UNIQUE (tenant_id, authority_reference),
  CHECK ((status <> 'active') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK ((status <> 'revoked') OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND length(trim(coalesce(revocation_reason, ''))) >= 10))
);
CREATE INDEX IF NOT EXISTS institution_authorizations_active_idx
  ON institution_authorizations (tenant_id, institution_type, valid_until)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS criminal_request_authorizations (
  id uuid PRIMARY KEY,
  request_ref varchar(32) NOT NULL REFERENCES criminal_record_requests("requestRef") ON DELETE RESTRICT,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  institution_authorization_id uuid NOT NULL REFERENCES institution_authorizations(id) ON DELETE RESTRICT,
  legal_case_reference varchar(160) NOT NULL,
  purpose_code varchar(64) NOT NULL,
  approval_status varchar(16) NOT NULL CHECK (approval_status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')),
  requested_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by integer REFERENCES users(id) ON DELETE RESTRICT,
  approval_note text,
  approved_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT criminal_request_authorizations_request_unique UNIQUE (request_ref),
  CHECK ((approval_status <> 'approved') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND length(trim(coalesce(approval_note, ''))) >= 10))
);

CREATE TABLE IF NOT EXISTS institutional_request_outbox (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  request_authorization_id uuid NOT NULL REFERENCES criminal_request_authorizations(id) ON DELETE RESTRICT,
  provider_authorization_id uuid NOT NULL REFERENCES institution_authorizations(id) ON DELETE RESTRICT,
  event_type varchar(64) NOT NULL CHECK (event_type IN ('restricted_criminal_request_dispatch', 'restricted_criminal_request_cancel')),
  payload_ciphertext bytea NOT NULL,
  payload_nonce bytea NOT NULL CHECK (octet_length(payload_nonce) = 12),
  payload_key_version varchar(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'delivered', 'dead_letter', 'cancelled')),
  idempotency_key uuid NOT NULL UNIQUE,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_at timestamptz,
  lease_owner varchar(128),
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institutional_request_outbox_dispatch_unique UNIQUE (request_authorization_id, event_type)
);
CREATE INDEX IF NOT EXISTS institutional_request_outbox_ready_idx
  ON institutional_request_outbox (status, available_at)
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- Informal-sector proof is provenance-labelled and never an unqualified score.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS informal_verification_cases (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id integer NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  investigation_id integer REFERENCES investigations(id) ON DELETE RESTRICT,
  consent_ref varchar(32) NOT NULL REFERENCES candidate_consents("consentRef") ON DELETE RESTRICT,
  purpose varchar(64) NOT NULL CHECK (purpose IN ('pre_employment', 'tenancy', 'vendor_due_diligence', 'consumer_self_check')),
  status varchar(24) NOT NULL CHECK (status IN ('open', 'collecting', 'under_review', 'completed', 'withdrawn', 'disputed')),
  expires_at timestamptz NOT NULL,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS informal_verification_cases_tenant_status_idx ON informal_verification_cases (tenant_id, status, expires_at);

CREATE TABLE IF NOT EXISTS informal_references (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES informal_verification_cases(id) ON DELETE RESTRICT,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_type varchar(32) NOT NULL CHECK (source_type IN ('self_nominated_referee', 'trade_association', 'cooperative', 'guarantor', 'landlord', 'neighbour', 'field_observation')),
  source_display_name varchar(256) NOT NULL,
  relationship_to_subject varchar(256) NOT NULL,
  relationship_disclosed boolean NOT NULL DEFAULT false,
  subject_consent_confirmed_at timestamptz NOT NULL,
  contact_verification_method varchar(32) NOT NULL CHECK (contact_verification_method IN ('otp', 'callback', 'in_person_verified', 'association_officer')),
  source_claim jsonb NOT NULL,
  provenance_status varchar(32) NOT NULL CHECK (provenance_status IN ('claimed', 'attested', 'independently_confirmed', 'contradicted', 'withdrawn')),
  collected_by integer REFERENCES users(id) ON DELETE SET NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (relationship_disclosed = true),
  CHECK ((provenance_status <> 'withdrawn') OR withdrawn_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS informal_references_case_idx ON informal_references (case_id, provenance_status);

CREATE TABLE IF NOT EXISTS informal_reference_corroborations (
  id uuid PRIMARY KEY,
  reference_id uuid NOT NULL REFERENCES informal_references(id) ON DELETE RESTRICT,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  corroboration_type varchar(32) NOT NULL CHECK (corroboration_type IN ('second_reference', 'association_attestation', 'field_evidence', 'licensed_provider_record')),
  evidence_reference varchar(160) NOT NULL,
  outcome varchar(24) NOT NULL CHECK (outcome IN ('supports', 'contradicts', 'inconclusive')),
  verified_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verified_at timestamptz NOT NULL DEFAULT now(),
  notes text NOT NULL CHECK (length(trim(notes)) >= 10),
  CONSTRAINT informal_reference_corroborations_unique UNIQUE (reference_id, corroboration_type, evidence_reference)
);

CREATE TABLE IF NOT EXISTS informal_reference_events (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES informal_verification_cases(id) ON DELETE RESTRICT,
  reference_id uuid REFERENCES informal_references(id) ON DELETE RESTRICT,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type varchar(48) NOT NULL CHECK (event_type IN ('case_opened', 'reference_collected', 'reference_verified', 'reference_contradicted', 'reference_withdrawn', 'subject_correction_submitted', 'case_completed')),
  actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  event_sha256 char(64) NOT NULL CHECK (event_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Biometric consent and decision ledger. Raw images and plaintext templates are
-- deliberately absent; only consent, risk/deletion lifecycle, and decision
-- provenance are retained in this application database.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS biometric_consents (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id integer REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  kyc_record_id integer REFERENCES kyc_records(id) ON DELETE RESTRICT,
  subject_ref varchar(128) NOT NULL,
  purpose varchar(64) NOT NULL CHECK (purpose IN ('identity_verification', 'document_face_match', 'liveness_assurance')),
  policy_version varchar(64) NOT NULL,
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > granted_at),
  withdrawn_at timestamptz,
  withdrawal_reason text,
  proof_sha256 char(64) NOT NULL CHECK (proof_sha256 ~ '^[0-9a-f]{64}$'),
  captured_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT biometric_consents_subject_purpose_unique UNIQUE (tenant_id, subject_ref, purpose, policy_version)
);
CREATE INDEX IF NOT EXISTS biometric_consents_active_idx
  ON biometric_consents (tenant_id, subject_ref, purpose, expires_at)
  WHERE withdrawn_at IS NULL;

CREATE TABLE IF NOT EXISTS biometric_review_cases (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kyc_record_id integer REFERENCES kyc_records(id) ON DELETE RESTRICT,
  subject_ref varchar(128) NOT NULL,
  operation varchar(32) NOT NULL CHECK (operation IN ('enrollment', 'liveness', 'face_match', 'document_match', 'full_verification')),
  engine_request_id varchar(64) NOT NULL,
  outcome varchar(24) NOT NULL CHECK (outcome IN ('verified', 'not_verified', 'unavailable', 'manual_review_required')),
  score numeric(6,5),
  threshold numeric(6,5),
  model_version varchar(128) NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}',
  status varchar(24) NOT NULL CHECK (status IN ('pending_human_review', 'approved', 'rejected', 'expired')),
  reviewed_by integer REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_rationale text,
  retention_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  CHECK (threshold IS NULL OR (threshold >= 0 AND threshold <= 1)),
  CHECK ((status NOT IN ('approved', 'rejected')) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(trim(coalesce(review_rationale, ''))) >= 10))
);
CREATE INDEX IF NOT EXISTS biometric_review_cases_queue_idx ON biometric_review_cases (tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS biometric_deletion_requests (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subject_ref varchar(128) NOT NULL,
  requested_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason varchar(64) NOT NULL CHECK (reason IN ('consent_withdrawn', 'retention_expired', 'subject_request', 'administrative_correction')),
  status varchar(24) NOT NULL CHECK (status IN ('requested', 'processing', 'completed', 'failed')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS biometric_deletion_requests_one_open_idx
  ON biometric_deletion_requests (tenant_id, subject_ref)
  WHERE status IN ('requested', 'processing');

-- ─────────────────────────────────────────────────────────────────────────────
-- Enforcement functions and triggers.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_institution_authorization_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_tenant integer;
DECLARE authorization_tenant integer;
DECLARE authorization_state varchar;
DECLARE authorization_until timestamptz;
BEGIN
  SELECT "tenantId" INTO request_tenant FROM criminal_record_requests WHERE "requestRef" = NEW.request_ref;
  SELECT tenant_id, status, valid_until INTO authorization_tenant, authorization_state, authorization_until FROM institution_authorizations WHERE id = NEW.institution_authorization_id;
  IF request_tenant IS NULL OR request_tenant <> NEW.tenant_id OR authorization_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'criminal request authorization tenant mismatch';
  END IF;
  IF authorization_state <> 'active' OR authorization_until <= now() THEN
    RAISE EXCEPTION 'institution authorization is not active';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS criminal_request_authorizations_tenant_guard ON criminal_request_authorizations;
CREATE TRIGGER criminal_request_authorizations_tenant_guard
BEFORE INSERT OR UPDATE ON criminal_request_authorizations
FOR EACH ROW EXECUTE FUNCTION enforce_institution_authorization_tenant();

CREATE OR REPLACE FUNCTION enforce_informal_case_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_tenant integer;
BEGIN
  SELECT tenant_id INTO case_tenant FROM informal_verification_cases WHERE id = NEW.case_id;
  IF case_tenant IS NULL OR case_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'informal reference tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS informal_references_tenant_guard ON informal_references;
CREATE TRIGGER informal_references_tenant_guard
BEFORE INSERT OR UPDATE ON informal_references
FOR EACH ROW EXECUTE FUNCTION enforce_informal_case_tenant();

CREATE OR REPLACE FUNCTION immutable_informal_reference_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'informal reference events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS informal_reference_events_immutable_update ON informal_reference_events;
DROP TRIGGER IF EXISTS informal_reference_events_immutable_delete ON informal_reference_events;
CREATE TRIGGER informal_reference_events_immutable_update BEFORE UPDATE ON informal_reference_events FOR EACH ROW EXECUTE FUNCTION immutable_informal_reference_event();
CREATE TRIGGER informal_reference_events_immutable_delete BEFORE DELETE ON informal_reference_events FOR EACH ROW EXECUTE FUNCTION immutable_informal_reference_event();

CREATE OR REPLACE FUNCTION prevent_biometric_decision_without_active_consent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM biometric_consents c
    WHERE c.tenant_id = NEW.tenant_id
      AND c.subject_ref = NEW.subject_ref
      AND c.withdrawn_at IS NULL
      AND c.granted_at <= NEW.created_at
      AND c.expires_at > NEW.created_at
  ) THEN
    RAISE EXCEPTION 'active biometric consent is required';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS biometric_review_cases_consent_guard ON biometric_review_cases;
CREATE TRIGGER biometric_review_cases_consent_guard
BEFORE INSERT ON biometric_review_cases
FOR EACH ROW EXECUTE FUNCTION prevent_biometric_decision_without_active_consent();

COMMIT;
