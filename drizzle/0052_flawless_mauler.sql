ALTER TYPE "public"."screening_type" ADD VALUE 'cac_full_profile' BEFORE 'mdcn_licence';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'firs_tax_clearance' BEFORE 'mdcn_licence';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'beneficial_owner' BEFORE 'mdcn_licence';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'corporate_sanctions' BEFORE 'mdcn_licence';--> statement-breakpoint
CREATE TABLE "corporate_screening_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"profileRef" varchar(32) NOT NULL,
	"investigationRef" varchar(32),
	"tenantId" integer NOT NULL,
	"companyName" varchar(255) NOT NULL,
	"rcNumber" varchar(20) NOT NULL,
	"tinNumber" varchar(20),
	"incorporationDate" timestamp,
	"companyType" varchar(64),
	"registeredAddress" text,
	"status" "screening_status" DEFAULT 'pending' NOT NULL,
	"overallOutcome" "assessment_outcome",
	"cacResult" json,
	"firsResult" json,
	"directorsResult" json,
	"sanctionsResult" json,
	"riskScore" real,
	"notes" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_screening_profiles_profileRef_unique" UNIQUE("profileRef")
);
--> statement-breakpoint
CREATE TABLE "screening_ai_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"summaryRef" varchar(32) NOT NULL,
	"investigationRef" varchar(32) NOT NULL,
	"orderRefs" json DEFAULT '[]'::json NOT NULL,
	"overallRisk" varchar(16) NOT NULL,
	"headline" text NOT NULL,
	"keyFindings" json DEFAULT '[]'::json NOT NULL,
	"redFlags" json DEFAULT '[]'::json NOT NULL,
	"recommendations" json DEFAULT '[]'::json NOT NULL,
	"fullNarrative" text NOT NULL,
	"compositeScore" real,
	"modelVersion" varchar(32) DEFAULT 'gpt-4o',
	"generatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "screening_ai_summaries_summaryRef_unique" UNIQUE("summaryRef")
);
--> statement-breakpoint
ALTER TABLE "corporate_screening_profiles" ADD CONSTRAINT "corporate_screening_profiles_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_screening_profiles" ADD CONSTRAINT "corporate_screening_profiles_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_ai_summaries" ADD CONSTRAINT "screening_ai_summaries_generatedBy_users_id_fk" FOREIGN KEY ("generatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "csp_inv_idx" ON "corporate_screening_profiles" USING btree ("investigationRef");--> statement-breakpoint
CREATE INDEX "csp_tenant_idx" ON "corporate_screening_profiles" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "csp_rc_idx" ON "corporate_screening_profiles" USING btree ("rcNumber");--> statement-breakpoint
CREATE INDEX "sas_inv_idx" ON "screening_ai_summaries" USING btree ("investigationRef");