-- Mission-critical payment retry reliability.
-- A provider reference is unique, and worker leases prevent concurrent retries
-- from producing more than one authoritative ledger posting.
CREATE TABLE IF NOT EXISTS webhook_retry_queue (
  id BIGSERIAL PRIMARY KEY,
  reference VARCHAR(256) NOT NULL UNIQUE,
  "tenantId" VARCHAR(64) NOT NULL,
  "amountKobo" INTEGER NOT NULL CHECK ("amountKobo" > 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  "nextRetryAt" TIMESTAMP NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'dead_letter')),
  "leasedAt" TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_retry_due_idx
  ON webhook_retry_queue (status, "nextRetryAt");
CREATE INDEX IF NOT EXISTS webhook_retry_lease_idx
  ON webhook_retry_queue (status, "leasedAt");
