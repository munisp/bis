CREATE TABLE IF NOT EXISTS "force_credit_approvals" (
  "id" serial PRIMARY KEY NOT NULL,
  "reference" varchar(256) NOT NULL,
  "tenantId" varchar(64) NOT NULL,
  "amountKobo" integer NOT NULL,
  "auditNote" text NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "requesterId" integer NOT NULL,
  "approverId" integer,
  "approvalNote" text,
  "ledgerTransferId" varchar(128),
  "requestedAt" timestamp DEFAULT now() NOT NULL,
  "approvedAt" timestamp,
  "executedAt" timestamp,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "force_credit_approvals_requesterId_users_id_fk"
    FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "force_credit_approvals_approverId_users_id_fk"
    FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fca_reference_idx" ON "force_credit_approvals" ("reference");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fca_status_idx" ON "force_credit_approvals" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fca_requester_idx" ON "force_credit_approvals" ("requesterId");
