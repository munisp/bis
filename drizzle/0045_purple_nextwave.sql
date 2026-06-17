CREATE TYPE "public"."push_broadcast_status" AS ENUM('scheduled', 'sent', 'cancelled');--> statement-breakpoint
CREATE TABLE "kyc_ocr_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"documentId" integer NOT NULL,
	"fieldName" varchar(64) NOT NULL,
	"oldValue" text,
	"oldConfidence" real,
	"newValue" text,
	"newConfidence" real,
	"triggeredBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(128) NOT NULL,
	"body" varchar(512) NOT NULL,
	"url" text,
	"tag" varchar(64),
	"scheduledAt" bigint NOT NULL,
	"status" "push_broadcast_status" DEFAULT 'scheduled' NOT NULL,
	"createdBy" integer,
	"dispatchedAt" bigint,
	"broadcastId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kyc_ocr_history" ADD CONSTRAINT "kyc_ocr_history_documentId_kyc_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."kyc_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_ocr_history" ADD CONSTRAINT "kyc_ocr_history_triggeredBy_users_id_fk" FOREIGN KEY ("triggeredBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_broadcasts" ADD CONSTRAINT "scheduled_broadcasts_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_broadcasts" ADD CONSTRAINT "scheduled_broadcasts_broadcastId_push_broadcasts_id_fk" FOREIGN KEY ("broadcastId") REFERENCES "public"."push_broadcasts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kyc_ocr_hist_doc_idx" ON "kyc_ocr_history" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "kyc_ocr_hist_field_idx" ON "kyc_ocr_history" USING btree ("fieldName");--> statement-breakpoint
CREATE INDEX "kyc_ocr_hist_by_idx" ON "kyc_ocr_history" USING btree ("triggeredBy");--> statement-breakpoint
CREATE INDEX "sched_bc_status_idx" ON "scheduled_broadcasts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sched_bc_scheduled_idx" ON "scheduled_broadcasts" USING btree ("scheduledAt");--> statement-breakpoint
CREATE INDEX "sched_bc_created_by_idx" ON "scheduled_broadcasts" USING btree ("createdBy");