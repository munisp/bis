-- Run outside a transaction through the PostgreSQL migration runner because this
-- index is built concurrently to avoid blocking forensic audit writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS pii_forensic_audit_events_tenant_created_id_desc_idx
  ON pii_forensic_audit_events (tenant_id, created_at DESC, id DESC);
