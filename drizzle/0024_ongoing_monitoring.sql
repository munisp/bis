-- WP2: Ongoing monitoring — continuous re-screening of investigation subjects.
-- Enrollments store a baseline snapshot of screening hits; the monitoring
-- scheduler re-runs the existing gateway screening entry points
-- (/v1/sanctions/:name, /v1/pep/:name) on the configured frequency and diffs
-- against the baseline, fanning out alerts on any delta.

BEGIN;

CREATE TYPE monitoring_frequency AS ENUM ('daily', 'weekly', 'monthly');
--> statement-breakpoint
CREATE TYPE monitoring_status AS ENUM ('active', 'paused', 'cancelled');
--> statement-breakpoint
CREATE TYPE monitoring_alert_type AS ENUM ('new_hit', 'status_change', 'removed_hit');
--> statement-breakpoint
CREATE TYPE monitoring_run_result AS ENUM ('no_change', 'change_detected', 'error');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS monitoring_enrollments (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  investigation_ref TEXT NOT NULL,
  subject_name TEXT,
  subject_identifiers JSONB,
  list_set TEXT[] NOT NULL,
  frequency monitoring_frequency NOT NULL,
  status monitoring_status NOT NULL DEFAULT 'active',
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  baseline_snapshot JSONB,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS me_tenant_idx ON monitoring_enrollments (tenant_id);
--> statement-breakpoint
-- Partial index so the scheduler's due-row scan stays cheap as history grows.
CREATE INDEX IF NOT EXISTS me_due_idx ON monitoring_enrollments (status, next_run_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS me_investigation_idx ON monitoring_enrollments (tenant_id, investigation_ref);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES monitoring_enrollments(id) ON DELETE CASCADE,
  alert_type monitoring_alert_type NOT NULL,
  severity TEXT,
  delta JSONB,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ma_tenant_idx ON monitoring_alerts (tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ma_enrollment_idx ON monitoring_alerts (enrollment_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ma_unacked_idx ON monitoring_alerts (tenant_id, acknowledged_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS monitoring_runs (
  id UUID PRIMARY KEY,
  enrollment_id UUID NOT NULL REFERENCES monitoring_enrollments(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  result monitoring_run_result NOT NULL,
  snapshot JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mr_enrollment_idx ON monitoring_runs (enrollment_id, started_at);

COMMIT;
