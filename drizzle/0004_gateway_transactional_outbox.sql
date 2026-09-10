-- Durable gateway outbox. A row is written before asynchronous Kafka delivery and
-- is retained for audit after acknowledgement. Payloads are canonical JSON bytes.
CREATE TABLE gateway_transactional_outbox (
  id UUID PRIMARY KEY,
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gateway_transactional_outbox_state CHECK (state IN ('pending', 'dispatching', 'delivered', 'dead_letter')),
  CONSTRAINT gateway_transactional_outbox_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT gateway_transactional_outbox_hash CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT gateway_transactional_outbox_idempotency UNIQUE (topic, idempotency_key)
);
CREATE INDEX gateway_transactional_outbox_ready_idx
  ON gateway_transactional_outbox (available_at ASC, created_at ASC)
  WHERE state = 'pending';
CREATE INDEX gateway_transactional_outbox_state_idx
  ON gateway_transactional_outbox (state, updated_at DESC);

COMMENT ON TABLE gateway_transactional_outbox IS
  'Gateway durable event record. Kafka delivery is retried from this table; an event is acknowledged only after durable storage succeeds.';
