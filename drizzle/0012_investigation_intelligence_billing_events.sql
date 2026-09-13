-- 0012_investigation_intelligence_billing_events.sql
-- Durable, tenant-scoped commercial metering for completed decision-support assessments.
-- This migration never treats a score as a payment authorization; a separate worker
-- settles only a tenant-authorized entitlement or prepaid ledger debit.

BEGIN;

CREATE TABLE IF NOT EXISTS intelligence_assessment_metering_policies (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  policy_code varchar(64) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  prepaid_price_kobo bigint NOT NULL DEFAULT 0 CHECK (prepaid_price_kobo >= 0),
  effective_from timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by integer REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intelligence_assessment_metering_policy_unique UNIQUE (tenant_id, policy_code),
  CHECK ((enabled = false) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > effective_from)
);

CREATE TABLE IF NOT EXISTS intelligence_assessment_billing_events (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assessment_id uuid NOT NULL REFERENCES investigation_score_assessments(id) ON DELETE RESTRICT,
  metering_policy_id uuid NOT NULL REFERENCES intelligence_assessment_metering_policies(id) ON DELETE RESTRICT,
  reservation_id uuid REFERENCES billing_check_reservations(id) ON DELETE RESTRICT,
  requested_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_kobo bigint NOT NULL CHECK (amount_kobo >= 0),
  currency char(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status varchar(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','settled','retryable_failure','payment_required','dead_letter','cancelled')),
  idempotency_key uuid NOT NULL UNIQUE,
  tigerbeetle_transfer_id varchar(64),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_at timestamptz,
  lease_owner varchar(128),
  settled_at timestamptz,
  last_error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intelligence_assessment_billing_one_per_assessment UNIQUE (assessment_id),
  CONSTRAINT intelligence_assessment_billing_transfer_unique UNIQUE (tigerbeetle_transfer_id)
);
CREATE INDEX IF NOT EXISTS intelligence_assessment_billing_ready_idx
  ON intelligence_assessment_billing_events (status, available_at)
  WHERE status IN ('pending','retryable_failure');

-- Include metered decision-support assessments in the existing reservation/usage
-- lifecycle. Existing rows retain their original allowed values.
ALTER TABLE billing_check_reservations
  DROP CONSTRAINT IF EXISTS billing_check_reservations_requested_tier_check;
ALTER TABLE billing_check_reservations
  ADD CONSTRAINT billing_check_reservations_requested_tier_check
  CHECK (requested_tier IN ('basic','standard','premium','intelligence_assessment'));
ALTER TABLE billing_usage_events
  DROP CONSTRAINT IF EXISTS billing_usage_events_usage_type_check;
ALTER TABLE billing_usage_events
  ADD CONSTRAINT billing_usage_events_usage_type_check
  CHECK (usage_type IN ('completed_authorized_check','intelligence_assessment','reversal'));

CREATE OR REPLACE FUNCTION enforce_intelligence_assessment_billing_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assessment_tenant integer; policy_tenant integer; reservation_tenant integer;
BEGIN
  SELECT tenant_id INTO assessment_tenant FROM investigation_score_assessments WHERE id = NEW.assessment_id;
  SELECT tenant_id INTO policy_tenant FROM intelligence_assessment_metering_policies WHERE id = NEW.metering_policy_id;
  IF assessment_tenant IS NULL OR assessment_tenant <> NEW.tenant_id OR policy_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'intelligence assessment billing tenant mismatch';
  END IF;
  IF NEW.reservation_id IS NOT NULL THEN
    SELECT tenant_id INTO reservation_tenant FROM billing_check_reservations WHERE id = NEW.reservation_id;
    IF reservation_tenant IS NULL OR reservation_tenant <> NEW.tenant_id THEN RAISE EXCEPTION 'intelligence assessment billing reservation tenant mismatch'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER intelligence_assessment_billing_tenant_guard
  BEFORE INSERT OR UPDATE ON intelligence_assessment_billing_events
  FOR EACH ROW EXECUTE FUNCTION enforce_intelligence_assessment_billing_tenant();

COMMIT;
