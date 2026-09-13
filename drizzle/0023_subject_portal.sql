-- Subject portal (WP3): consumer self-check + subject-facing portal.
-- Access tokens are stored ONLY as SHA-256 hashes (same scheme as
-- api_tokens."tokenHash"); dispute statements are stored encrypted
-- (Vault Transit envelope) with a SHA-256 integrity digest. No plaintext PII.

BEGIN;

-- consent_purpose gains the self-check purpose used by the subject portal.
ALTER TYPE consent_purpose ADD VALUE IF NOT EXISTS 'consumer_self_check';

CREATE TYPE subject_access_token_purpose AS ENUM ('self_check', 'status', 'dispute');
CREATE TYPE subject_dispute_status AS ENUM ('received', 'under_review', 'resolved');

CREATE TABLE IF NOT EXISTS subject_access_tokens (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id INTEGER NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  purpose subject_access_token_purpose NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sat_candidate_idx ON subject_access_tokens (tenant_id, candidate_id);
CREATE INDEX IF NOT EXISTS sat_expiry_idx ON subject_access_tokens (expires_at);

CREATE TABLE IF NOT EXISTS subject_disputes (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id INTEGER NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  case_id UUID REFERENCES informal_verification_cases(id) ON DELETE RESTRICT,
  statement_sha256 CHAR(64) NOT NULL CHECK (statement_sha256 ~ '^[0-9a-f]{64}$'),
  statement_enc TEXT,
  status subject_dispute_status NOT NULL DEFAULT 'received',
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sd_candidate_idx ON subject_disputes (tenant_id, candidate_id);
CREATE INDEX IF NOT EXISTS sd_status_idx ON subject_disputes (tenant_id, status);

COMMIT;
