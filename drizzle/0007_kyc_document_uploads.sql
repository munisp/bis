-- Secure KYC document upload sessions and immutable chain-of-custody events.
-- Content is uploaded directly to SSE-KMS object storage; the BFF stores only encrypted metadata.
CREATE TABLE kyc_document_uploads (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  kyc_record_id INTEGER NOT NULL REFERENCES kyc_records(id) ON DELETE RESTRICT,
  actor_user_id INTEGER NOT NULL,
  document_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  expected_sha256 CHAR(64) NOT NULL,
  content_type TEXT NOT NULL,
  content_length BIGINT NOT NULL CHECK (content_length > 0 AND content_length <= 5242880),
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
  CONSTRAINT kyc_document_upload_status CHECK (status IN ('initiated', 'verified', 'expired', 'rejected')),
  CONSTRAINT kyc_document_upload_type CHECK (document_type IN ('nin_slip', 'passport', 'drivers_license', 'voters_card', 'utility_bill', 'bank_statement', 'cac_certificate', 'other')),
  CONSTRAINT kyc_document_upload_expected_digest CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT kyc_document_upload_observed_digest CHECK (observed_sha256 IS NULL OR observed_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX kyc_document_uploads_idempotency_idx
  ON kyc_document_uploads (tenant_id, actor_user_id, idempotency_key);
CREATE INDEX kyc_document_uploads_record_idx
  ON kyc_document_uploads (tenant_id, kyc_record_id, status, created_at DESC);
CREATE INDEX kyc_document_uploads_expiry_idx
  ON kyc_document_uploads (status, expires_at);

CREATE TABLE kyc_document_custody_events (
  id UUID PRIMARY KEY,
  kyc_document_upload_id UUID NOT NULL REFERENCES kyc_document_uploads(id) ON DELETE RESTRICT,
  actor_user_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_sha256 CHAR(64) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT kyc_document_custody_event_type CHECK (event_type IN ('upload_initiated', 'upload_verified', 'upload_rejected', 'upload_expired')),
  CONSTRAINT kyc_document_custody_event_digest CHECK (event_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX kyc_document_custody_events_upload_idx
  ON kyc_document_custody_events (kyc_document_upload_id, occurred_at ASC);

COMMENT ON TABLE kyc_document_uploads IS
  'Short-lived, tenant-scoped direct-to-object-storage KYC document upload authorizations. Content never transits the BFF.';
COMMENT ON TABLE kyc_document_custody_events IS
  'Append-only integrity and custody evidence for KYC document upload authorizations.';
