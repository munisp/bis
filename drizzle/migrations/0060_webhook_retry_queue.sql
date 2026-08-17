DO $$
BEGIN
  CREATE TYPE "webhook_retry_status" AS ENUM ('pending', 'dead_letter', 'completed', 'resolved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "webhook_retry_queue" (
  "id" serial PRIMARY KEY NOT NULL,
  "reference" varchar(256) NOT NULL,
  "tenantId" varchar(64) NOT NULL,
  "amountKobo" integer NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "nextRetryAt" timestamp NOT NULL,
  "status" "webhook_retry_status" DEFAULT 'pending' NOT NULL,
  "lastError" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_retry_queue_reference_unique" UNIQUE("reference")
);

CREATE INDEX IF NOT EXISTS "webhook_retry_reference_idx" ON "webhook_retry_queue" ("reference");
CREATE INDEX IF NOT EXISTS "webhook_retry_due_idx" ON "webhook_retry_queue" ("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "webhook_retry_tenant_idx" ON "webhook_retry_queue" ("tenantId");
