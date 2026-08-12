CREATE TYPE "public"."biometric_modality" AS ENUM('fingerprint', 'face', 'iris', 'voice');--> statement-breakpoint
CREATE TYPE "public"."collection_site_status" AS ENUM('active', 'inactive', 'suspended');--> statement-breakpoint
CREATE TABLE "biometric_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"subjectRef" varchar(64) NOT NULL,
	"tenantId" integer,
	"modality" "biometric_modality" NOT NULL,
	"templateData" text NOT NULL,
	"quality" real,
	"deviceId" varchar(128),
	"enrolledBy" integer,
	"enrolledAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"name" varchar(256) NOT NULL,
	"address" text NOT NULL,
	"city" varchar(128) NOT NULL,
	"state" varchar(64) NOT NULL,
	"phone" varchar(32),
	"email" varchar(320),
	"lat" real,
	"lng" real,
	"labPartner" varchar(128),
	"panelTypes" json DEFAULT '[]'::json NOT NULL,
	"turnaround" varchar(64),
	"status" "collection_site_status" DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"eventType" varchar(128) NOT NULL,
	"aggregateId" varchar(128),
	"tenantId" integer,
	"actorId" integer,
	"payload" json,
	"source" varchar(64),
	"traceId" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "biometric_templates" ADD CONSTRAINT "biometric_templates_enrolledBy_users_id_fk" FOREIGN KEY ("enrolledBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bt_subject_idx" ON "biometric_templates" USING btree ("subjectRef");--> statement-breakpoint
CREATE INDEX "bt_tenant_idx" ON "biometric_templates" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "bt_modality_idx" ON "biometric_templates" USING btree ("modality");--> statement-breakpoint
CREATE INDEX "site_state_idx" ON "collection_sites" USING btree ("state");--> statement-breakpoint
CREATE INDEX "site_status_idx" ON "collection_sites" USING btree ("status");--> statement-breakpoint
CREATE INDEX "el_type_idx" ON "event_log" USING btree ("eventType");--> statement-breakpoint
CREATE INDEX "el_aggregate_idx" ON "event_log" USING btree ("aggregateId");--> statement-breakpoint
CREATE INDEX "el_tenant_idx" ON "event_log" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "el_created_idx" ON "event_log" USING btree ("createdAt");