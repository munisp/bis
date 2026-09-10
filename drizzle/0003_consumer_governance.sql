-- Nigeria-first consumer governance. This migration stores minimal operational data
-- and retains an immutable event trail for consent and data-subject rights requests.

CREATE TABLE consumer_consent_records (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tenant_id BIGINT REFERENCES tenants(id) ON DELETE RESTRICT,
  jurisdiction_code TEXT NOT NULL DEFAULT 'NG',
  purpose TEXT NOT NULL,
  legal_basis TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_consent_jurisdiction CHECK (jurisdiction_code = 'NG'),
  CONSTRAINT consumer_consent_purpose
    CHECK (purpose IN ('self', 'personal_safety', 'fraud_prevention', 'account_security', 'compliance_investigation', 'legal_authority')),
  CONSTRAINT consumer_consent_legal_basis CHECK (legal_basis IN ('consent', 'legal_obligation', 'legitimate_interest', 'legal_authority'))
);
CREATE INDEX consumer_consent_active_idx
  ON consumer_consent_records (user_id, purpose, granted_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE consumer_rights_requests (
  id BIGSERIAL PRIMARY KEY,
  request_ref TEXT NOT NULL UNIQUE,
  requester_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tenant_id BIGINT REFERENCES tenants(id) ON DELETE RESTRICT,
  jurisdiction_code TEXT NOT NULL DEFAULT 'NG',
  request_type TEXT NOT NULL,
  subject_profile_ref TEXT,
  request_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  identity_verification_ref TEXT,
  status TEXT NOT NULL DEFAULT 'identity_pending',
  resolution_code TEXT,
  resolution_detail TEXT,
  assigned_to_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  due_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_rights_jurisdiction CHECK (jurisdiction_code = 'NG'),
  CONSTRAINT consumer_rights_type CHECK (request_type IN ('access', 'correction', 'deletion', 'suppression', 'objection')),
  CONSTRAINT consumer_rights_status CHECK (status IN ('identity_pending', 'received', 'in_review', 'fulfilled', 'rejected', 'withdrawn')),
  CONSTRAINT consumer_rights_resolution CHECK (resolution_code IS NULL OR resolution_code IN ('fulfilled', 'identity_failed', 'insufficient_scope', 'legal_hold', 'not_found', 'withdrawn')),
  CONSTRAINT consumer_rights_resolution_when_terminal CHECK (
    (status IN ('fulfilled', 'rejected', 'withdrawn') AND resolution_code IS NOT NULL)
    OR status NOT IN ('fulfilled', 'rejected', 'withdrawn')
  )
);
CREATE INDEX consumer_rights_requester_idx ON consumer_rights_requests (requester_user_id, created_at DESC);
CREATE INDEX consumer_rights_queue_idx ON consumer_rights_requests (status, due_at ASC);

CREATE TABLE consumer_rights_request_events (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES consumer_rights_requests(id) ON DELETE RESTRICT,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_rights_events_type CHECK (event_type IN ('submitted', 'identity_verified', 'assigned', 'status_changed', 'fulfilled', 'rejected', 'withdrawn'))
);
CREATE INDEX consumer_rights_events_request_idx ON consumer_rights_request_events (request_id, created_at ASC);

COMMENT ON TABLE consumer_consent_records IS
  'Purpose-specific Nigeria consumer-discovery consent and other lawful-basis records. Revocation is append-only through revoked_at.';
COMMENT ON TABLE consumer_rights_requests IS
  'Data-subject access, correction, deletion, suppression, and objection requests. Raw contact data is intentionally not stored.';
COMMENT ON TABLE consumer_rights_request_events IS
  'Immutable operational event history for data-subject rights processing.';
