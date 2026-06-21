CREATE TABLE "velocity_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"accountId" varchar(128) NOT NULL,
	"tenantId" varchar(64),
	"txRef" varchar(128),
	"amountKobo" bigint NOT NULL,
	"windowCount" integer NOT NULL,
	"windowSeconds" integer NOT NULL,
	"threshold" integer NOT NULL,
	"decision" varchar(32) DEFAULT 'block' NOT NULL,
	"reason" text,
	"reviewedAt" timestamp,
	"reviewedBy" integer,
	"reviewNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "velocity_blocks" ADD CONSTRAINT "velocity_blocks_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "velocity_blocks_account_idx" ON "velocity_blocks" USING btree ("accountId");--> statement-breakpoint
CREATE INDEX "velocity_blocks_tenant_idx" ON "velocity_blocks" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "velocity_blocks_created_idx" ON "velocity_blocks" USING btree ("createdAt");