CREATE TABLE "billing_topups" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" varchar(64) NOT NULL,
	"reference" varchar(256) NOT NULL,
	"amountKobo" integer NOT NULL,
	"channel" varchar(64) DEFAULT 'unknown' NOT NULL,
	"tbTransferId" varchar(64),
	"verifiedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_topups_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "archivedTier" varchar(8);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "archivedAt" timestamp;--> statement-breakpoint
CREATE INDEX "billing_topups_ref_idx" ON "billing_topups" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "billing_topups_tenant_idx" ON "billing_topups" USING btree ("tenantId");