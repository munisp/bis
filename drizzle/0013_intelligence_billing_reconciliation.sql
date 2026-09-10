-- 0013_intelligence_billing_reconciliation.sql
-- Human, four-eyes resolution for uncertain TigerBeetle intelligence-assessment charges.

BEGIN;

ALTER TABLE intelligence_assessment_billing_events
  DROP CONSTRAINT IF EXISTS intelligence_assessment_billing_events_status_check;
ALTER TABLE intelligence_assessment_billing_events
  ADD CONSTRAINT intelligence_assessment_billing_events_status_check
  CHECK (status IN ('pending','leased','settled','retryable_failure','payment_required','awaiting_reconciliation','dead_letter','cancelled'));

CREATE TABLE IF NOT EXISTS intelligence_assessment_billing_reconciliations (
  id uuid PRIMARY KEY,
  billing_event_id uuid NOT NULL UNIQUE REFERENCES intelligence_assessment_billing_events(id) ON DELETE RESTRICT,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  deterministic_transfer_id varchar(64) NOT NULL,
  status varchar(32) NOT NULL CHECK (status IN ('open','under_review','approved_retry','confirmed_settled','confirmed_not_settled','cancelled')),
  last_error_code varchar(64) NOT NULL,
  ledger_evidence_ref varchar(256),
  ledger_evidence_sha256 char(64),
  requested_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by integer REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  resolution_rationale text,
  requeued_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((ledger_evidence_sha256 IS NULL) OR ledger_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK ((status NOT IN ('approved_retry','confirmed_settled','confirmed_not_settled','cancelled')) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by <> requested_by AND length(trim(coalesce(resolution_rationale, ''))) >= 20)),
  CHECK ((status <> 'confirmed_settled') OR (ledger_evidence_ref IS NOT NULL AND ledger_evidence_sha256 IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS intelligence_assessment_billing_reconciliation_open_idx
  ON intelligence_assessment_billing_reconciliations (tenant_id, status, requested_at)
  WHERE status IN ('open','under_review');

CREATE OR REPLACE FUNCTION enforce_intelligence_billing_reconciliation_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_tenant integer; event_transfer varchar(64);
BEGIN
  SELECT tenant_id, tigerbeetle_transfer_id INTO event_tenant, event_transfer
  FROM intelligence_assessment_billing_events WHERE id = NEW.billing_event_id;
  IF event_tenant IS NULL OR event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'billing reconciliation tenant mismatch';
  END IF;
  IF NEW.deterministic_transfer_id <> COALESCE(event_transfer, NEW.deterministic_transfer_id) THEN
    RAISE EXCEPTION 'billing reconciliation transfer identifier mismatch';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER intelligence_billing_reconciliation_tenant_guard
  BEFORE INSERT OR UPDATE ON intelligence_assessment_billing_reconciliations
  FOR EACH ROW EXECUTE FUNCTION enforce_intelligence_billing_reconciliation_tenant();

COMMIT;
