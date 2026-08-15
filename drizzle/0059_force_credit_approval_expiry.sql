ALTER TABLE "force_credit_approvals" ADD COLUMN IF NOT EXISTS "expiresAt" timestamp;
UPDATE "force_credit_approvals"
SET "expiresAt" = "requestedAt" + INTERVAL '24 hours'
WHERE "expiresAt" IS NULL;
ALTER TABLE "force_credit_approvals" ALTER COLUMN "expiresAt" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "fca_expires_idx" ON "force_credit_approvals" ("status", "expiresAt");
