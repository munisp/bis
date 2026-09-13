-- 0023_share_links_and_plan_signups.sql
-- Shareable investigation reports (tokenised, expiring, redacted one-pagers)
-- and durable idempotency records for self-service plan signups.

BEGIN;

CREATE TABLE IF NOT EXISTS report_share_links (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL CHECK (tenant_id > 0),
  investigation_ref text NOT NULL,
  token_hash text NOT NULL,
  created_by integer,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS report_share_links_token_hash_idx
  ON report_share_links (token_hash);
CREATE INDEX IF NOT EXISTS report_share_links_tenant_idx
  ON report_share_links (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS report_share_links_investigation_idx
  ON report_share_links (tenant_id, investigation_ref);

COMMENT ON TABLE report_share_links IS
  'Expiring share links for redacted investigation one-pagers; only the SHA-256 digest of the bis_sl_ token is stored, never the plaintext token.';

CREATE TABLE IF NOT EXISTS plan_signups (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL CHECK (tenant_id > 0),
  plan_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'payment_failed', 'cancelled')),
  billing_ref text,
  idempotency_key text NOT NULL,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Idempotency keys are tenant-namespaced: per-tenant uniqueness prevents both
-- cross-tenant replay leaks and cross-tenant key squatting.
CREATE UNIQUE INDEX IF NOT EXISTS plan_signups_idempotency_key_unique
  ON plan_signups (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS plan_signups_tenant_idx
  ON plan_signups (tenant_id, created_at);

COMMENT ON TABLE plan_signups IS
  'Durable, tenant-scoped idempotency records for self-service plan signups; a replayed idempotency key returns the original result and never re-settles payment.';

COMMIT;
