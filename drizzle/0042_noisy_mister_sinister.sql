CREATE TYPE "public"."kyc_document_review_status" AS ENUM('pending', 'approved', 'rejected', 'reupload_requested');--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"kycRecordId" integer NOT NULL,
	"tenantId" integer,
	"documentType" varchar(64) NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"fileKey" varchar(512) NOT NULL,
	"fileUrl" text NOT NULL,
	"fileSizeBytes" integer,
	"mimeType" varchar(64),
	"reviewStatus" "kyc_document_review_status" DEFAULT 'pending' NOT NULL,
	"reviewedBy" integer,
	"reviewNote" text,
	"reviewedAt" timestamp,
	"uploadedBy" integer NOT NULL,
	"capturedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_kycRecordId_kyc_records_id_fk" FOREIGN KEY ("kycRecordId") REFERENCES "public"."kyc_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kyc_docs_record_idx" ON "kyc_documents" USING btree ("kycRecordId");--> statement-breakpoint
CREATE INDEX "kyc_docs_status_idx" ON "kyc_documents" USING btree ("reviewStatus");--> statement-breakpoint
CREATE INDEX "kyc_docs_tenant_idx" ON "kyc_documents" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "kyc_docs_created_at_idx" ON "kyc_documents" USING btree ("createdAt");