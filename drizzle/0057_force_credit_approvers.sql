CREATE TABLE IF NOT EXISTS "force_credit_approvers" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "active" boolean NOT NULL DEFAULT true,
  "designatedBy" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "designatedAt" timestamp DEFAULT now() NOT NULL,
  "revokedAt" timestamp,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "force_credit_approvers_user_unique" ON "force_credit_approvers" USING btree ("userId");
CREATE INDEX IF NOT EXISTS "force_credit_approvers_active_idx" ON "force_credit_approvers" USING btree ("active");
