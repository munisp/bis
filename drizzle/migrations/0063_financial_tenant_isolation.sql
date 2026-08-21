-- Tenant isolation for financial and regulatory message records.
-- Backfill ownership only where the linked AML transaction already has a tenant;
-- existing unowned rows remain visible solely to platform administrators until reviewed.

ALTER TABLE swift_messages ADD COLUMN IF NOT EXISTS "tenantId" integer;
ALTER TABLE sepa_payments ADD COLUMN IF NOT EXISTS "tenantId" integer;
ALTER TABLE travel_rule_records ADD COLUMN IF NOT EXISTS "tenantId" integer;

UPDATE swift_messages AS message
SET "tenantId" = transaction."tenantId"
FROM transactions AS transaction
WHERE message."transactionId" = transaction.id
  AND message."tenantId" IS NULL
  AND transaction."tenantId" IS NOT NULL;

UPDATE sepa_payments AS payment
SET "tenantId" = transaction."tenantId"
FROM transactions AS transaction
WHERE payment."transactionId" = transaction.id
  AND payment."tenantId" IS NULL
  AND transaction."tenantId" IS NOT NULL;

UPDATE travel_rule_records AS record
SET "tenantId" = transaction."tenantId"
FROM transactions AS transaction
WHERE record."transactionId" = transaction.id
  AND record."tenantId" IS NULL
  AND transaction."tenantId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS swift_messages_tenant_created_idx
  ON swift_messages ("tenantId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS sepa_payments_tenant_created_idx
  ON sepa_payments ("tenantId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS travel_rule_records_tenant_created_idx
  ON travel_rule_records ("tenantId", "createdAt" DESC);
