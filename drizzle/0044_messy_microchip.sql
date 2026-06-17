CREATE TABLE "push_broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(128) NOT NULL,
	"body" varchar(512) NOT NULL,
	"url" text,
	"tag" varchar(64),
	"sentCount" integer DEFAULT 0 NOT NULL,
	"failedCount" integer DEFAULT 0 NOT NULL,
	"deactivatedCount" integer DEFAULT 0 NOT NULL,
	"createdBy" integer,
	"sentAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "previousOcrData" json;--> statement-breakpoint
ALTER TABLE "push_broadcasts" ADD CONSTRAINT "push_broadcasts_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_bc_sent_at_idx" ON "push_broadcasts" USING btree ("sentAt");--> statement-breakpoint
CREATE INDEX "push_bc_created_by_idx" ON "push_broadcasts" USING btree ("createdBy");