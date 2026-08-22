BEGIN;

ALTER TABLE letters_of_credit ADD COLUMN IF NOT EXISTS "tenantId" integer REFERENCES tenants(id);
ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS "tenantId" integer REFERENCES tenants(id);
ALTER TABLE regulatory_reports ADD COLUMN IF NOT EXISTS "tenantId" integer REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS letters_of_credit_tenant_idx ON letters_of_credit ("tenantId");
CREATE INDEX IF NOT EXISTS evidence_items_tenant_idx ON evidence_items ("tenantId");
CREATE INDEX IF NOT EXISTS regulatory_reports_tenant_idx ON regulatory_reports ("tenantId");

COMMIT;
