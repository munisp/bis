-- Enforce tenant-scoped PostgreSQL access for Vault Transit PII custody state.
-- Runtime and worker clients must call set_config('bis.tenant_id', <trusted id>, true)
-- inside every protected-table transaction; no role DDL is included because database
-- roles are infrastructure-owned and must be provisioned outside application migration credentials.

CREATE OR REPLACE FUNCTION bis_current_tenant_id() RETURNS INTEGER
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('bis.tenant_id', true), '')::integer
$$;

CREATE TABLE pii_rotation_dispatch_queue (
  rotation_job_id UUID PRIMARY KEY REFERENCES pii_rotation_jobs(id) ON DELETE CASCADE,
  rotation_ref TEXT NOT NULL UNIQUE CHECK (rotation_ref ~ '^BIS-PR-[A-Z0-9]{18}$'),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','leased')),
  leased_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 12),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX pii_rotation_dispatch_queue_claim_idx ON pii_rotation_dispatch_queue (state, created_at ASC) WHERE state = 'queued';

CREATE OR REPLACE FUNCTION sync_pii_rotation_dispatch_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state IN ('queued','leased') THEN
      INSERT INTO pii_rotation_dispatch_queue (rotation_job_id,rotation_ref,tenant_id,state,leased_at,attempt_count)
      VALUES (NEW.id,NEW.rotation_ref,NEW.tenant_id,NEW.state,NEW.leased_at,NEW.attempt_count)
      ON CONFLICT (rotation_job_id) DO NOTHING;
    END IF;
  ELSIF NEW.state IN ('queued','leased') THEN
    INSERT INTO pii_rotation_dispatch_queue (rotation_job_id,rotation_ref,tenant_id,state,leased_at,attempt_count,updated_at)
    VALUES (NEW.id,NEW.rotation_ref,NEW.tenant_id,NEW.state,NEW.leased_at,NEW.attempt_count,NOW())
    ON CONFLICT (rotation_job_id) DO UPDATE SET state=EXCLUDED.state, leased_at=EXCLUDED.leased_at, attempt_count=EXCLUDED.attempt_count, updated_at=NOW();
  ELSE
    DELETE FROM pii_rotation_dispatch_queue WHERE rotation_job_id=NEW.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER pii_rotation_dispatch_queue_sync
AFTER INSERT OR UPDATE OF state ON pii_rotation_jobs
FOR EACH ROW EXECUTE FUNCTION sync_pii_rotation_dispatch_queue();

INSERT INTO pii_rotation_dispatch_queue (rotation_job_id,rotation_ref,tenant_id,state,leased_at,attempt_count)
SELECT id,rotation_ref,tenant_id,state,leased_at,attempt_count
FROM pii_rotation_jobs
WHERE state IN ('queued','leased')
ON CONFLICT (rotation_job_id) DO NOTHING;

REVOKE ALL ON pii_rotation_dispatch_queue FROM PUBLIC;
REVOKE ALL ON pii_encryption_key_registry, pii_blind_index_key_registry, pii_envelope_records, pii_blind_indexes,
  pii_rotation_jobs, pii_rotation_job_items, pii_forensic_audit_events, pii_key_compromise_incidents, pii_key_compromise_impacts
  FROM PUBLIC;

ALTER TABLE pii_encryption_key_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_encryption_key_registry FORCE ROW LEVEL SECURITY;
CREATE POLICY pii_encryption_key_registry_tenant_rls ON pii_encryption_key_registry
  USING (tenant_id = bis_current_tenant_id())
  WITH CHECK (tenant_id = bis_current_tenant_id());

ALTER TABLE pii_blind_index_key_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_blind_index_key_registry FORCE ROW LEVEL SECURITY;
CREATE POLICY pii_blind_index_key_registry_tenant_rls ON pii_blind_index_key_registry
  USING (tenant_id = bis_current_tenant_id())
  WITH CHECK (tenant_id = bis_current_tenant_id());

ALTER TABLE pii_envelope_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_envelope_records FORCE ROW LEVEL SECURITY;
CREATE POLICY pii_envelope_records_tenant_rls ON pii_envelope_records
  USING (tenant_id = bis_current_tenant_id())
  WITH CHECK (tenant_id = bis_current_tenant_id());

ALTER TABLE pii_blind_indexes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_blind_indexes FORCE ROW LEVEL SECURITY;
CREATE POLICY pii_blind_indexes_tenant_rls ON pii_blind_indexes
  USING (tenant_id = bis_current_tenant_id())
  WITH CHECK (tenant_id = bis_current_tenant_id());

ALTER TABLE pii_rotation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_rotation_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY pii_rotation_jobs_tenant_rls ON pii_rotation_jobs
  USING (tenant_id = bis_current_tenant_id())
  WITH CHECK (tenant_id = bis_current_tenant_id());

ALTER TABLE pii_rotation_job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_rotation_job_items FORCE ROW LEVEL SECURITY;
CREATE POLICY pii_rotation_job_items_tenant_rls ON pii_rotation_job_items
  USING (tenant_id = bis_current_tenant_id())
  WITH CHECK (tenant_id = bis_current_tenant_id());

ALTER TABLE pii_key_compromise_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_key_compromise_incidents FORCE ROW LEVEL SECURITY;
CREATE POLICY pii_key_compromise_incidents_tenant_rls ON pii_key_compromise_incidents
  USING (tenant_id = bis_current_tenant_id())
  WITH CHECK (tenant_id = bis_current_tenant_id());

ALTER TABLE pii_forensic_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_forensic_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY pii_forensic_audit_events_tenant_rls ON pii_forensic_audit_events
  USING (tenant_id = bis_current_tenant_id())
  WITH CHECK (tenant_id = bis_current_tenant_id());

ALTER TABLE pii_key_compromise_impacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_key_compromise_impacts FORCE ROW LEVEL SECURITY;
CREATE POLICY pii_key_compromise_impacts_tenant_rls ON pii_key_compromise_impacts
  USING (EXISTS (
    SELECT 1 FROM pii_key_compromise_incidents i
    WHERE i.id = pii_key_compromise_impacts.incident_id
      AND i.tenant_id = bis_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM pii_key_compromise_incidents i
    WHERE i.id = pii_key_compromise_impacts.incident_id
      AND i.tenant_id = bis_current_tenant_id()
  ));
