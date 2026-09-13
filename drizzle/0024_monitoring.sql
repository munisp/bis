-- Ongoing monitoring (continuous re-screening) engine.
-- Enrollments bind a tenant-owned investigation subject to a watchlist set and a
-- cadence; the scheduler re-runs the existing screening pipeline, records every
-- run, and raises tenant-scoped alerts only on a verified delta against the
-- stored baseline snapshot. All statements are idempotent.

CREATE TABLE IF NOT EXISTS monitoring_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  investigation_ref VARCHAR(32) NOT NULL,
  subject_name VARCHAR(255) NOT NULL,
  subject_identifiers JSONB NOT NULL DEFAULT '{}'::jsonb,
  list_set TEXT[] NOT NULL CHECK (cardinality(list_set) > 0),
  frequency VARCHAR(16) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  baseline_snapshot JSONB,
  created_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monitoring_enrollments_schedule_shape CHECK (
    (status = 'active' AND next_run_at IS NOT NULL)
    OR (status <> 'active')
  )
);

-- At most one live (non-cancelled) enrollment per tenant investigation.
CREATE UNIQUE INDEX IF NOT EXISTS monitoring_enrollments_live_idx
  ON monitoring_enrollments (tenant_id, investigation_ref)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS monitoring_enrollments_due_idx
  ON monitoring_enrollments (next_run_at, id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS monitoring_enrollments_tenant_idx
  ON monitoring_enrollments (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS monitoring_runs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  enrollment_id UUID NOT NULL REFERENCES monitoring_enrollments(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result VARCHAR(24) NOT NULL CHECK (result IN ('no_change', 'change_detected', 'error')),
  snapshot JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS monitoring_runs_enrollment_idx
  ON monitoring_runs (enrollment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS monitoring_runs_tenant_idx
  ON monitoring_runs (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  enrollment_id UUID NOT NULL REFERENCES monitoring_enrollments(id) ON DELETE CASCADE,
  run_id BIGINT REFERENCES monitoring_runs(id) ON DELETE SET NULL,
  alert_type VARCHAR(24) NOT NULL CHECK (alert_type IN ('new_hit', 'status_change', 'removed_hit')),
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  delta JSONB NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS monitoring_alerts_unack_idx
  ON monitoring_alerts (tenant_id, created_at DESC)
  WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS monitoring_alerts_enrollment_idx
  ON monitoring_alerts (enrollment_id, created_at DESC);

CREATE OR REPLACE FUNCTION monitoring_enrollments_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS monitoring_enrollments_touch_updated_at_trigger ON monitoring_enrollments;
CREATE TRIGGER monitoring_enrollments_touch_updated_at_trigger
BEFORE UPDATE ON monitoring_enrollments
FOR EACH ROW EXECUTE FUNCTION monitoring_enrollments_touch_updated_at();

COMMENT ON TABLE monitoring_enrollments IS
  'Tenant-scoped continuous re-screening enrollments; the scheduler claims due active rows FOR UPDATE SKIP LOCKED and never screens across tenant boundaries.';
COMMENT ON TABLE monitoring_runs IS
  'Immutable execution ledger for monitoring re-screening runs, including fail-closed error rows; snapshots enable delta replay.';
COMMENT ON TABLE monitoring_alerts IS
  'Tenant-scoped monitoring alerts raised only on a verified snapshot delta; acknowledgement requires an admin or supervisor.';
