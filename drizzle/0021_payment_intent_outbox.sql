-- Durable payment intent outbox: no HTTP request path may submit a rail transfer
-- directly. A payment claim and its workflow-start instruction are committed in
-- the same PostgreSQL transaction, then leased by exactly one dispatcher.

CREATE TABLE IF NOT EXISTS payment_intent_outbox (
  id BIGSERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  rail VARCHAR(32) NOT NULL CHECK (rail IN ('nip', 'mojaloop')),
  status VARCHAR(32) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'leased', 'workflow_started', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 10),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leased_at TIMESTAMPTZ,
  lease_owner TEXT,
  workflow_id VARCHAR(160) UNIQUE,
  workflow_run_id VARCHAR(160),
  last_error_code VARCHAR(96),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_intent_outbox_lease_shape CHECK (
    (status = 'leased' AND leased_at IS NOT NULL)
    OR (status <> 'leased' AND leased_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS payment_intent_outbox_due_idx
  ON payment_intent_outbox (status, next_attempt_at, id)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS payment_intent_outbox_stale_lease_idx
  ON payment_intent_outbox (leased_at)
  WHERE status = 'leased';

CREATE OR REPLACE FUNCTION payment_intent_outbox_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_intent_outbox_touch_updated_at_trigger ON payment_intent_outbox;
CREATE TRIGGER payment_intent_outbox_touch_updated_at_trigger
BEFORE UPDATE ON payment_intent_outbox
FOR EACH ROW EXECUTE FUNCTION payment_intent_outbox_touch_updated_at();

COMMENT ON TABLE payment_intent_outbox IS
  'Single-owner durable Temporal workflow-start instructions for payment intents; contains no counterparty payload because canonical fields remain in transactions.';
