CREATE TABLE "data_source_health_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"dataSourceId" integer NOT NULL,
	"status" "data_source_status" NOT NULL,
	"responseMs" integer DEFAULT 0 NOT NULL,
	"httpStatus" integer,
	"error" text,
	"checkedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_scheduled_reruns" (
	"id" serial PRIMARY KEY NOT NULL,
	"kycRecordId" integer NOT NULL,
	"subjectName" varchar(255) NOT NULL,
	"nin" varchar(20),
	"bvn" varchar(22),
	"dob" varchar(20),
	"phone" varchar(20),
	"scheduledAt" timestamp NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"resultKycRecordId" integer,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_source_health_logs" ADD CONSTRAINT "data_source_health_logs_dataSourceId_data_sources_id_fk" FOREIGN KEY ("dataSourceId") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_scheduled_reruns" ADD CONSTRAINT "kyc_scheduled_reruns_kycRecordId_kyc_records_id_fk" FOREIGN KEY ("kycRecordId") REFERENCES "public"."kyc_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_scheduled_reruns" ADD CONSTRAINT "kyc_scheduled_reruns_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_logs_ds_idx" ON "data_source_health_logs" USING btree ("dataSourceId");--> statement-breakpoint
CREATE INDEX "health_logs_checked_at_idx" ON "data_source_health_logs" USING btree ("checkedAt");--> statement-breakpoint
CREATE INDEX "kyc_reruns_status_idx" ON "kyc_scheduled_reruns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kyc_reruns_scheduled_at_idx" ON "kyc_scheduled_reruns" USING btree ("scheduledAt");--> statement-breakpoint
CREATE INDEX "kyc_reruns_kyc_record_idx" ON "kyc_scheduled_reruns" USING btree ("kycRecordId");