-- Four-eyes, evidence-bound resolution for payment intents that could not be
-- dispatched safely. A case records a durable decision; it never stores raw
-- provider payloads, account numbers, request bodies, or authentication values.

BEGIN;

CREATE TABLE IF NOT EXISTS payment_reconciliation_cases (
  id UUID PRIMARY KEY,
  transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  outbox_id BIGINT NOT NULL UNIQUE REFERENCES payment_intent_outbox(id) ON DELETE RESTRICT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  status VARCHAR(32) NOT NULL CHECK (status IN (
    'open', 'under_review', 'approved_retry', 'confirmed_settled',
    'confirmed_not_settled', 'compensation_required', 'cancelled'
  )),
  last_error_code VARCHAR(96) NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  claimed_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at TIMESTAMPTZ,
  resolution_rationale TEXT,
  ledger_evidence_ref VARCHAR(256),
  ledger_evidence_sha256 CHAR(64),
  provider_evidence_ref VARCHAR(256),
  provider_evidence_sha256 CHAR(64),
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_reconciliation_claim_shape CHECK (
    (status = 'under_review' AND claimed_by IS NOT NULL AND claimed_at IS NOT NULL)
    OR (status <> 'under_review')
  ),
  CONSTRAINT payment_reconciliation_resolution_shape CHECK (
    (status IN ('approved_retry','confirmed_settled','confirmed_not_settled','compensation_required','cancelled')
      AND claimed_by IS NOT NULL
      AND resolved_by IS NOT NULL
      AND resolved_by <> claimed_by
      AND resolved_at IS NOT NULL
      AND closed_at IS NOT NULL
      AND length(trim(coalesce(resolution_rationale, ''))) >= 20)
    OR status IN ('open','under_review')
  ),
  CONSTRAINT payment_reconciliation_evidence_digest_shape CHECK (
    (ledger_evidence_sha256 IS NULL OR ledger_evidence_sha256 ~ '^[0-9a-f]{64}$')
    AND (provider_evidence_sha256 IS NULL OR provider_evidence_sha256 ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT payment_reconciliation_settled_evidence CHECK (
    status <> 'confirmed_settled'
    OR (ledger_evidence_ref IS NOT NULL AND ledger_evidence_sha256 IS NOT NULL
        AND provider_evidence_ref IS NOT NULL AND provider_evidence_sha256 IS NOT NULL)
  ),
  CONSTRAINT payment_reconciliation_not_settled_evidence CHECK (
    status NOT IN ('confirmed_not_settled','approved_retry','compensation_required')
    OR (ledger_evidence_ref IS NOT NULL AND ledger_evidence_sha256 IS NOT NULL
        AND provider_evidence_ref IS NOT NULL AND provider_evidence_sha256 IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS payment_reconciliation_cases_open_idx
  ON payment_reconciliation_cases (tenant_id, status, opened_at)
  WHERE status IN ('open','under_review');

CREATE OR REPLACE FUNCTION enforce_payment_reconciliation_case_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  transaction_tenant INTEGER;
  outbox_tenant INTEGER;
  outbox_transaction INTEGER;
BEGIN
  SELECT "tenantId" INTO transaction_tenant FROM transactions WHERE id = NEW.transaction_id;
  SELECT tenant_id, transaction_id INTO outbox_tenant, outbox_transaction
    FROM payment_intent_outbox WHERE id = NEW.outbox_id;
  IF transaction_tenant IS NULL OR outbox_tenant IS NULL
     OR transaction_tenant <> NEW.tenant_id
     OR outbox_tenant <> NEW.tenant_id
     OR outbox_transaction <> NEW.transaction_id THEN
    RAISE EXCEPTION 'payment reconciliation case tenant or payment-intent mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_reconciliation_case_tenant_guard ON payment_reconciliation_cases;
CREATE TRIGGER payment_reconciliation_case_tenant_guard
  BEFORE INSERT OR UPDATE ON payment_reconciliation_cases
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_reconciliation_case_tenant();

CREATE TABLE IF NOT EXISTS payment_reconciliation_events (
  id UUID PRIMARY KEY,
  reconciliation_case_id UUID NOT NULL REFERENCES payment_reconciliation_cases(id) ON DELETE RESTRICT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type VARCHAR(48) NOT NULL CHECK (event_type IN (
    'case_opened','case_claimed','settlement_confirmed','not_settled_confirmed','retry_approved','compensation_required','case_cancelled'
  )),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  reason_code VARCHAR(96) NOT NULL,
  ledger_evidence_sha256 CHAR(64),
  provider_evidence_sha256 CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((ledger_evidence_sha256 IS NULL OR ledger_evidence_sha256 ~ '^[0-9a-f]{64}$')
     AND (provider_evidence_sha256 IS NULL OR provider_evidence_sha256 ~ '^[0-9a-f]{64}$'))
);

CREATE OR REPLACE FUNCTION enforce_payment_reconciliation_event_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_tenant INTEGER;
BEGIN
  SELECT tenant_id INTO case_tenant FROM payment_reconciliation_cases WHERE id = NEW.reconciliation_case_id;
  IF case_tenant IS NULL OR case_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'payment reconciliation event tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_reconciliation_event_tenant_guard
  BEFORE INSERT ON payment_reconciliation_events
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_reconciliation_event_tenant();

CREATE OR REPLACE FUNCTION deny_payment_reconciliation_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment reconciliation events are append-only';
END;
$$;
CREATE TRIGGER payment_reconciliation_event_immutable_update
  BEFORE UPDATE OR DELETE ON payment_reconciliation_events
  FOR EACH ROW EXECUTE FUNCTION deny_payment_reconciliation_event_mutation();

CREATE OR REPLACE FUNCTION create_payment_reconciliation_case_on_under_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linked_outbox RECORD;
  new_case_id UUID;
BEGIN
  IF NEW.status <> 'under_review' OR OLD.status = 'under_review' OR NEW."tenantId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id, tenant_id, last_error_code INTO linked_outbox
  FROM payment_intent_outbox
  WHERE transaction_id = NEW.id AND tenant_id = NEW."tenantId"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Deterministic identifiers prevent duplicate case/event insertion during
  -- transaction retry. These are identifiers, not secrets or authentication values.
  new_case_id := format('00000000-0000-5000-8000-%012s', lpad(to_hex(NEW.id), 12, '0'))::uuid;
  INSERT INTO payment_reconciliation_cases
    (id, transaction_id, outbox_id, tenant_id, status, last_error_code)
  VALUES
    (new_case_id, NEW.id, linked_outbox.id, NEW."tenantId", 'open', COALESCE(linked_outbox.last_error_code, 'UNDER_REVIEW'))
  ON CONFLICT (transaction_id) DO NOTHING;

  IF FOUND THEN
    INSERT INTO payment_reconciliation_events
      (id, reconciliation_case_id, tenant_id, event_type, to_status, reason_code)
    VALUES
      (format('00000000-0000-5000-8001-%012s', lpad(to_hex(NEW.id), 12, '0'))::uuid,
       new_case_id, NEW."tenantId", 'case_opened', 'open', COALESCE(linked_outbox.last_error_code, 'UNDER_REVIEW'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_reconciliation_case_auto_open ON transactions;
CREATE TRIGGER payment_reconciliation_case_auto_open
  AFTER UPDATE OF status ON transactions
  FOR EACH ROW EXECUTE FUNCTION create_payment_reconciliation_case_on_under_review();

-- Migrate already-escalated payments into the same state machine before the
-- table policy is forced. The deterministic identifiers make this retry-safe.
WITH inserted_cases AS (
  INSERT INTO payment_reconciliation_cases
    (id, transaction_id, outbox_id, tenant_id, status, last_error_code)
  SELECT
    format('00000000-0000-5000-8000-%012s', lpad(to_hex(t.id), 12, '0'))::uuid,
    t.id, o.id, t."tenantId", 'open', COALESCE(o.last_error_code, 'PREEXISTING_UNDER_REVIEW')
  FROM transactions t
  JOIN payment_intent_outbox o ON o.transaction_id = t.id AND o.tenant_id = t."tenantId"
  WHERE t.status = 'under_review' AND t."tenantId" IS NOT NULL
  ON CONFLICT (transaction_id) DO NOTHING
  RETURNING id, tenant_id, transaction_id, last_error_code
)
INSERT INTO payment_reconciliation_events
  (id, reconciliation_case_id, tenant_id, event_type, to_status, reason_code)
SELECT
  format('00000000-0000-5000-8001-%012s', lpad(to_hex(transaction_id), 12, '0'))::uuid,
  id, tenant_id, 'case_opened', 'open', last_error_code
FROM inserted_cases;

REVOKE ALL ON payment_reconciliation_cases FROM PUBLIC;
ALTER TABLE payment_reconciliation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reconciliation_cases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_reconciliation_cases_tenant_rls ON payment_reconciliation_cases;
CREATE POLICY payment_reconciliation_cases_tenant_rls ON payment_reconciliation_cases
  USING (tenant_id = bis_current_tenant_id())
  WITH CHECK (tenant_id = bis_current_tenant_id());

REVOKE ALL ON payment_reconciliation_events FROM PUBLIC;
ALTER TABLE payment_reconciliation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reconciliation_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_reconciliation_events_tenant_rls ON payment_reconciliation_events;
CREATE POLICY payment_reconciliation_events_tenant_rls ON payment_reconciliation_events
  USING (tenant_id = bis_current_tenant_id())
  WITH CHECK (tenant_id = bis_current_tenant_id());

CREATE OR REPLACE FUNCTION payment_reconciliation_case_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_reconciliation_case_touch_updated_at_trigger ON payment_reconciliation_cases;
CREATE TRIGGER payment_reconciliation_case_touch_updated_at_trigger
  BEFORE UPDATE ON payment_reconciliation_cases
  FOR EACH ROW EXECUTE FUNCTION payment_reconciliation_case_touch_updated_at();

COMMIT;
