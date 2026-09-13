-- 0025_monitoring.sql
-- Ongoing monitoring (continuous re-screening) engine.
--
-- Enrollments bind a tenant investigation subject to a recurring screening
-- schedule. The scheduler (server/monitoringScheduler.ts) re-runs the existing
-- sanctions/PEP/watchlist screening pipeline, diffs the result against the
-- stored baseline snapshot, and raises tenant-scoped alerts on any delta.
--
-- Tables are consumed through raw pg SQL only (same precedent as the
-- informal_verification tables in 0010); they are intentionally not added to
-- drizzle/schema.ts.

BEGIN;

-- ─── monitoring_enrollments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  investigation_ref text NOT NULL,
  subject_name text NOT NULL,
  subject_identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  list_set text[] NOT NULL DEFAULT ARRAY['sanctions', 'pep', 'watchlist']::text[]
    CHECK (list_set <@ ARRAY['sanctions', 'pep', 'watchlist']::text[] AND cardinality(list_set) > 0),
  frequency varchar(16) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL,
  baseline_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitoring_enrollments_due_idx
  ON monitoring_enrollments (next_run_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS monitoring_enrollments_tenant_idx
  ON monitoring_enrollments (tenant_id, status);
-- One live enrollment per subject per investigation per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS monitoring_enrollments_live_subject_uniq
  ON monitoring_enrollments (tenant_id, investigation_ref, subject_name)
  WHERE status IN ('active', 'paused');

-- ─── monitoring_runs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES monitoring_enrollments(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result varchar(24) NOT NULL CHECK (result IN ('no_change', 'change_detected', 'error')),
  snapshot jsonb,
  error text
);
CREATE INDEX IF NOT EXISTS monitoring_runs_enrollment_idx
  ON monitoring_runs (enrollment_id, started_at DESC);

-- ─── monitoring_alerts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  enrollment_id uuid NOT NULL REFERENCES monitoring_enrollments(id) ON DELETE CASCADE,
  alert_type varchar(24) NOT NULL CHECK (alert_type IN ('new_hit', 'status_change', 'removed_hit')),
  severity varchar(16) NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  delta jsonb NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitoring_alerts_tenant_open_idx
  ON monitoring_alerts (tenant_id, created_at DESC)
  WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS monitoring_alerts_enrollment_idx
  ON monitoring_alerts (enrollment_id, created_at DESC);

COMMENT ON TABLE monitoring_enrollments IS
  'Tenant-scoped ongoing-monitoring subscriptions: a subject is re-screened on the configured frequency and the result is diffed against baseline_snapshot.';
COMMENT ON TABLE monitoring_runs IS
  'Immutable history of scheduler re-screening passes per enrollment, including fail-closed error records.';
COMMENT ON TABLE monitoring_alerts IS
  'Tenant-scoped delta alerts (new hit / removed hit / status change) raised by the monitoring scheduler; acknowledgment is restricted to admin/supervisor roles.';

COMMIT;
