CREATE TYPE "public"."lex_agency_status" AS ENUM('active', 'suspended', 'retired');--> statement-breakpoint
CREATE TYPE "public"."lex_agency_type" AS ENUM('npf', 'efcc', 'icpc', 'dss', 'nscdc', 'customs', 'immigration', 'other');--> statement-breakpoint
CREATE TYPE "public"."lex_channel" AS ENUM('web', 'sms', 'physical');--> statement-breakpoint
CREATE TYPE "public"."lex_incident_type" AS ENUM('arrest', 'seizure', 'witness_statement', 'court_order', 'intel_tip', 'missing_person', 'homicide', 'fraud', 'cybercrime', 'other');--> statement-breakpoint
CREATE TYPE "public"."lex_submission_status" AS ENUM('pending', 'under_review', 'validated', 'rejected', 'escalated', 'expunged');--> statement-breakpoint
CREATE TYPE "public"."lex_submitter_status" AS ENUM('active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."nigerian_state" AS ENUM('AB', 'AD', 'AK', 'AN', 'BA', 'BY', 'BE', 'BO', 'CR', 'DE', 'EB', 'ED', 'EK', 'EN', 'GO', 'IM', 'JI', 'KD', 'KN', 'KT', 'KE', 'KO', 'KW', 'LA', 'NA', 'NI', 'OG', 'ON', 'OS', 'OY', 'PL', 'RI', 'SO', 'TA', 'YO', 'ZA', 'FC');--> statement-breakpoint
CREATE TABLE "lex_agencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"agencyCode" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "lex_agency_type" NOT NULL,
	"state" "nigerian_state" NOT NULL,
	"lga" varchar(100),
	"commandUnit" varchar(255),
	"contactName" varchar(255),
	"contactPhone" varchar(20),
	"contactEmail" varchar(320),
	"status" "lex_agency_status" DEFAULT 'active' NOT NULL,
	"registeredBy" integer,
	"registeredAt" timestamp DEFAULT now() NOT NULL,
	"suspendedAt" timestamp,
	"suspendedReason" text,
	"notes" text,
	CONSTRAINT "lex_agencies_agencyCode_unique" UNIQUE("agencyCode")
);
--> statement-breakpoint
CREATE TABLE "lex_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"submissionRef" varchar(32) NOT NULL,
	"agencyId" integer NOT NULL,
	"submitterId" integer,
	"channel" "lex_channel" DEFAULT 'web' NOT NULL,
	"incidentType" "lex_incident_type" NOT NULL,
	"incidentState" "nigerian_state" NOT NULL,
	"incidentLga" varchar(100),
	"incidentAddress" text,
	"gpsLat" real,
	"gpsLng" real,
	"incidentDate" timestamp,
	"subjectName" varchar(255),
	"subjectNin" varchar(11),
	"subjectPhone" varchar(20),
	"subjectAddress" text,
	"narrative" text NOT NULL,
	"documents" json DEFAULT '[]'::json,
	"status" "lex_submission_status" DEFAULT 'pending' NOT NULL,
	"validationScore" integer,
	"validationNotes" json,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"linkedCaseId" integer,
	"rejectionReason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lex_submissions_submissionRef_unique" UNIQUE("submissionRef")
);
--> statement-breakpoint
CREATE TABLE "lex_submitters" (
	"id" serial PRIMARY KEY NOT NULL,
	"submitterId" varchar(64) NOT NULL,
	"agencyId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"rank" varchar(100),
	"phone" varchar(20) NOT NULL,
	"pinHash" varchar(255) NOT NULL,
	"reputationScore" integer DEFAULT 50 NOT NULL,
	"status" "lex_submitter_status" DEFAULT 'active' NOT NULL,
	"lastSubmissionAt" timestamp,
	"totalSubmissions" integer DEFAULT 0 NOT NULL,
	"validatedSubmissions" integer DEFAULT 0 NOT NULL,
	"rejectedSubmissions" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"revokedAt" timestamp,
	CONSTRAINT "lex_submitters_submitterId_unique" UNIQUE("submitterId")
);
--> statement-breakpoint
ALTER TABLE "lex_submissions" ADD CONSTRAINT "lex_submissions_agencyId_lex_agencies_id_fk" FOREIGN KEY ("agencyId") REFERENCES "public"."lex_agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lex_submissions" ADD CONSTRAINT "lex_submissions_submitterId_lex_submitters_id_fk" FOREIGN KEY ("submitterId") REFERENCES "public"."lex_submitters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lex_submissions" ADD CONSTRAINT "lex_submissions_linkedCaseId_cases_id_fk" FOREIGN KEY ("linkedCaseId") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lex_submitters" ADD CONSTRAINT "lex_submitters_agencyId_lex_agencies_id_fk" FOREIGN KEY ("agencyId") REFERENCES "public"."lex_agencies"("id") ON DELETE cascade ON UPDATE no action;