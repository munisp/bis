CREATE TYPE "public"."case_party_role" AS ENUM('subject', 'witness', 'associate', 'victim', 'entity');--> statement-breakpoint
CREATE TYPE "public"."case_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."case_stakeholder_role" AS ENUM('lead_analyst', 'reviewer', 'external_counsel', 'regulator', 'compliance_officer', 'subject_representative');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('draft', 'open', 'under_review', 'pending_decision', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."case_timeline_event_type" AS ENUM('case_created', 'status_changed', 'party_added', 'document_uploaded', 'comment_added', 'investigation_linked', 'stakeholder_invited', 'field_task_dispatched', 'alert_triggered', 'decision_recorded', 'case_closed');--> statement-breakpoint
CREATE TYPE "public"."case_type" AS ENUM('fraud', 'aml', 'kyc_failure', 'sanctions', 'corruption', 'cyber', 'regulatory', 'other');--> statement-breakpoint
CREATE TABLE "case_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"content" text NOT NULL,
	"authorId" integer,
	"authorName" varchar(200),
	"authorRole" varchar(100),
	"stakeholderId" integer,
	"confidential" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"filename" varchar(300) NOT NULL,
	"mimeType" varchar(100),
	"fileKey" varchar(500) NOT NULL,
	"url" text NOT NULL,
	"sizeBytes" integer,
	"category" varchar(100),
	"description" text,
	"confidential" boolean DEFAULT false NOT NULL,
	"uploadedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"role" "case_party_role" DEFAULT 'subject' NOT NULL,
	"name" varchar(200) NOT NULL,
	"nin" varchar(20),
	"bvn" varchar(20),
	"phone" varchar(20),
	"email" varchar(200),
	"address" text,
	"entityType" varchar(50),
	"notes" text,
	"investigationRef" varchar(50),
	"addedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_stakeholders" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"role" "case_stakeholder_role" NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(200) NOT NULL,
	"organisation" varchar(200),
	"accessToken" varchar(64),
	"accessExpiresAt" timestamp,
	"canComment" boolean DEFAULT false NOT NULL,
	"canViewDocuments" boolean DEFAULT true NOT NULL,
	"lastAccessedAt" timestamp,
	"invitedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "case_stakeholders_accessToken_unique" UNIQUE("accessToken")
);
--> statement-breakpoint
CREATE TABLE "case_timeline" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"eventType" "case_timeline_event_type" NOT NULL,
	"title" varchar(300) NOT NULL,
	"detail" json,
	"actorId" integer,
	"actorName" varchar(200),
	"actorRole" varchar(100),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref" varchar(30) NOT NULL,
	"title" varchar(300) NOT NULL,
	"type" "case_type" DEFAULT 'other' NOT NULL,
	"status" "case_status" DEFAULT 'draft' NOT NULL,
	"priority" "case_priority" DEFAULT 'medium' NOT NULL,
	"summary" text,
	"legalBasis" text,
	"jurisdiction" varchar(100),
	"regulatoryFramework" varchar(200),
	"leadAnalystId" integer,
	"tenantId" integer,
	"investigationRefs" json DEFAULT '[]'::json,
	"tags" json DEFAULT '[]'::json,
	"dueAt" timestamp,
	"closedAt" timestamp,
	"closureReason" text,
	"riskScore" integer,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cases_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "ollama_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"displayName" varchar(200),
	"family" varchar(50),
	"parameterSize" varchar(20),
	"quantization" varchar(20),
	"sizeBytes" integer,
	"status" varchar(20) DEFAULT 'available' NOT NULL,
	"useCase" json DEFAULT '[]'::json,
	"isDefault" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ollama_models_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "tokenQuota" integer;--> statement-breakpoint
ALTER TABLE "case_comments" ADD CONSTRAINT "case_comments_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_parties" ADD CONSTRAINT "case_parties_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_stakeholders" ADD CONSTRAINT "case_stakeholders_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_timeline" ADD CONSTRAINT "case_timeline_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;