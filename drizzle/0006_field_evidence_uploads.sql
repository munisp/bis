-- Secure field-evidence upload sessions and immutable chain-of-custody events.
CREATE TABLE field_evidence_uploads (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  investigation_id INTEGER NOT NULL,
  actor_user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  expected_sha256 CHAR(64) NOT NULL,
  content_type TEXT NOT NULL,
  content_length BIGINT NOT NULL CHECK (content_length > 0 AND content_length <= 26214400),
  description_ciphertext BYTEA NOT NULL,
  description_nonce BYTEA NOT NULL CHECK (octet_length(description_nonce) = 12),
  description_key_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated',
  object_version_id TEXT,
  observed_sha256 CHAR(64),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT field_evidence_upload_status CHECK (status IN ('initiated', 'uploaded', 'verified', 'expired', 'rejected')),
  CONSTRAINT field_evidence_upload_expected_digest CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT field_evidence_upload_observed_digest CHECK (observed_sha256 IS NULL OR observed_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT field_evidence_upload_encryption_algorithm CHECK (description_key_version <> '')
);
CREATE UNIQUE INDEX field_evidence_uploads_idempotency_idx
  ON field_evidence_uploads (tenant_id, actor_user_id, idempotency_key);
CREATE INDEX field_evidence_uploads_expiry_idx
  ON field_evidence_uploads (status, expires_at);

CREATE TABLE field_evidence_custody_events (
  id UUID PRIMARY KEY,
  evidence_upload_id UUID NOT NULL REFERENCES field_evidence_uploads(id) ON DELETE RESTRICT,
  actor_user_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_sha256 CHAR(64) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT field_evidence_custody_event_type CHECK (event_type IN ('upload_initiated', 'upload_verified', 'upload_rejected', 'upload_expired')),
  CONSTRAINT field_evidence_custody_event_digest CHECK (event_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX field_evidence_custody_events_evidence_idx
  ON field_evidence_custody_events (evidence_upload_id, occurred_at ASC);

COMMENT ON TABLE field_evidence_uploads IS
  'Short-lived direct-to-object-store evidence upload authorizations. Content never transits the BFF.';
COMMENT ON TABLE field_evidence_custody_events IS
  'Append-only custody evidence for each field upload authorization and verification result.';
