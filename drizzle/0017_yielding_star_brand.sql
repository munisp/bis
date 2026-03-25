CREATE TYPE "public"."duplicate_check_status" AS ENUM('pending', 'no_match', 'possible_match', 'confirmed_duplicate');--> statement-breakpoint
CREATE TYPE "public"."hosted_link_status" AS ENUM('active', 'completed', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."playbook_category" AS ENUM('kyc_physical', 'kyb_premises', 'asset_verification', 'surveillance', 'address_verification', 'interview', 'evidence_collection', 'emergency');--> statement-breakpoint
CREATE TABLE "duplicate_identity_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"investigationRef" varchar(50),
	"subjectName" varchar(200) NOT NULL,
	"faceImageUrl" varchar(500),
	"nin" varchar(20),
	"bvn" varchar(20),
	"phone" varchar(20),
	"status" "duplicate_check_status" DEFAULT 'pending' NOT NULL,
	"matchCount" integer DEFAULT 0 NOT NULL,
	"matchDetails" text,
	"confidenceScore" integer DEFAULT 0 NOT NULL,
	"requestedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "field_agent_playbooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"category" "playbook_category" NOT NULL,
	"description" text NOT NULL,
	"estimatedHours" integer DEFAULT 4 NOT NULL,
	"requiredTier" "agent_tier" DEFAULT 'junior' NOT NULL,
	"steps" text NOT NULL,
	"dataToCollect" text NOT NULL,
	"safetyNotes" text,
	"legalNotes" text,
	"nigeriaContext" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosted_verification_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" varchar(64) NOT NULL,
	"tenantId" integer,
	"investigationRef" varchar(50),
	"subjectName" varchar(200),
	"requiredChecks" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"status" "hosted_link_status" DEFAULT 'active' NOT NULL,
	"completedAt" timestamp,
	"resultRef" varchar(50),
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hosted_verification_links_token_unique" UNIQUE("token")
);
