CREATE TYPE "public"."criminal_request_status" AS ENUM('draft', 'submitted', 'acknowledged', 'processing', 'completed', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."criminal_verdict" AS ENUM('convicted', 'acquitted', 'discharged', 'pending', 'nolle_prosequi', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."law_enforcement_agency" AS ENUM('npf', 'efcc', 'icpc', 'dss', 'ndlea', 'nscdc', 'frsc', 'custom_state');--> statement-breakpoint
CREATE TYPE "public"."offence_category" AS ENUM('violent', 'financial', 'drug', 'cybercrime', 'terrorism', 'corruption', 'traffic', 'sexual', 'property', 'other');--> statement-breakpoint
CREATE TABLE "criminal_record_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"attachmentRef" varchar(32) NOT NULL,
	"recordRef" varchar(32),
	"requestRef" varchar(32),
	"tenantId" integer,
	"fileName" text NOT NULL,
	"fileUrl" text NOT NULL,
	"fileKey" text NOT NULL,
	"mimeType" varchar(128),
	"fileSize" integer,
	"documentType" varchar(64),
	"description" text,
	"uploadedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "criminal_record_attachments_attachmentRef_unique" UNIQUE("attachmentRef")
);
--> statement-breakpoint
CREATE TABLE "criminal_record_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"auditRef" varchar(32) NOT NULL,
	"requestRef" varchar(32),
	"recordRef" varchar(32),
	"tenantId" integer,
	"action" varchar(64) NOT NULL,
	"actorId" integer,
	"actorName" text,
	"details" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "criminal_record_audit_auditRef_unique" UNIQUE("auditRef")
);
--> statement-breakpoint
CREATE TABLE "criminal_record_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requestRef" varchar(32) NOT NULL,
	"tenantId" integer,
	"investigationRef" varchar(32),
	"subjectName" text NOT NULL,
	"subjectType" "subject_type" DEFAULT 'individual' NOT NULL,
	"nin" varchar(20),
	"bvn" varchar(20),
	"dob" date,
	"gender" varchar(16),
	"nationality" varchar(64) DEFAULT 'Nigerian',
	"agency" "law_enforcement_agency" NOT NULL,
	"stateCommand" varchar(64),
	"agencyRefNumber" varchar(64),
	"contactOfficer" text,
	"contactEmail" varchar(320),
	"contactPhone" varchar(32),
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"status" "criminal_request_status" DEFAULT 'draft' NOT NULL,
	"purpose" text,
	"requestedChecks" json DEFAULT '[]'::json,
	"submittedAt" timestamp,
	"acknowledgedAt" timestamp,
	"processingAt" timestamp,
	"completedAt" timestamp,
	"rejectedAt" timestamp,
	"rejectedReason" text,
	"expiresAt" timestamp,
	"requestedBy" integer,
	"assignedTo" integer,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "criminal_record_requests_requestRef_unique" UNIQUE("requestRef")
);
--> statement-breakpoint
CREATE TABLE "criminal_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"recordRef" varchar(32) NOT NULL,
	"requestRef" varchar(32),
	"investigationRef" varchar(32),
	"tenantId" integer,
	"agency" "law_enforcement_agency" NOT NULL,
	"agencyRef" varchar(64),
	"stateCommand" varchar(64),
	"subjectName" text NOT NULL,
	"nin" varchar(20),
	"dob" date,
	"gender" varchar(16),
	"nationality" varchar(64),
	"aliases" json DEFAULT '[]'::json,
	"offenceCategory" "offence_category" NOT NULL,
	"offenceCode" varchar(32),
	"offenceDescription" text NOT NULL,
	"offenceDate" date,
	"offenceLocation" text,
	"offenceState" varchar(64),
	"dateArrested" date,
	"arrestingStation" text,
	"dateCharged" date,
	"chargingAuthority" text,
	"courtName" text,
	"caseNumber" varchar(64),
	"verdict" "criminal_verdict" DEFAULT 'unknown',
	"dateConvicted" date,
	"sentence" text,
	"dateReleased" date,
	"outstandingWarrant" boolean DEFAULT false,
	"warrantDetails" text,
	"warrantIssuedBy" text,
	"warrantIssuedAt" date,
	"dataSource" varchar(64) DEFAULT 'agency_response',
	"confidence" real,
	"verifiedBy" integer,
	"verifiedAt" timestamp,
	"rawPayload" json,
	"recordedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "criminal_records_recordRef_unique" UNIQUE("recordRef")
);
--> statement-breakpoint
ALTER TABLE "criminal_record_attachments" ADD CONSTRAINT "criminal_record_attachments_uploadedBy_users_id_fk" FOREIGN KEY ("uploadedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criminal_record_audit" ADD CONSTRAINT "criminal_record_audit_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criminal_record_requests" ADD CONSTRAINT "criminal_record_requests_requestedBy_users_id_fk" FOREIGN KEY ("requestedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criminal_record_requests" ADD CONSTRAINT "criminal_record_requests_assignedTo_users_id_fk" FOREIGN KEY ("assignedTo") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criminal_records" ADD CONSTRAINT "criminal_records_verifiedBy_users_id_fk" FOREIGN KEY ("verifiedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criminal_records" ADD CONSTRAINT "criminal_records_recordedBy_users_id_fk" FOREIGN KEY ("recordedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cra_rec_idx" ON "criminal_record_attachments" USING btree ("recordRef");--> statement-breakpoint
CREATE INDEX "cra_req_idx" ON "criminal_record_attachments" USING btree ("requestRef");--> statement-breakpoint
CREATE INDEX "cra2_req_idx" ON "criminal_record_audit" USING btree ("requestRef");--> statement-breakpoint
CREATE INDEX "cra2_rec_idx" ON "criminal_record_audit" USING btree ("recordRef");--> statement-breakpoint
CREATE INDEX "crr_ref_idx" ON "criminal_record_requests" USING btree ("requestRef");--> statement-breakpoint
CREATE INDEX "crr_inv_idx" ON "criminal_record_requests" USING btree ("investigationRef");--> statement-breakpoint
CREATE INDEX "crr_nin_idx" ON "criminal_record_requests" USING btree ("nin");--> statement-breakpoint
CREATE INDEX "crr_stat_idx" ON "criminal_record_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "crr_agcy_idx" ON "criminal_record_requests" USING btree ("agency");--> statement-breakpoint
CREATE INDEX "cr_ref_idx" ON "criminal_records" USING btree ("recordRef");--> statement-breakpoint
CREATE INDEX "cr_req_idx" ON "criminal_records" USING btree ("requestRef");--> statement-breakpoint
CREATE INDEX "cr_inv_idx" ON "criminal_records" USING btree ("investigationRef");--> statement-breakpoint
CREATE INDEX "cr_nin_idx" ON "criminal_records" USING btree ("nin");--> statement-breakpoint
CREATE INDEX "cr_agcy_idx" ON "criminal_records" USING btree ("agency");--> statement-breakpoint
CREATE INDEX "cr_cat_idx" ON "criminal_records" USING btree ("offenceCategory");--> statement-breakpoint
CREATE INDEX "cr_warr_idx" ON "criminal_records" USING btree ("outstandingWarrant");