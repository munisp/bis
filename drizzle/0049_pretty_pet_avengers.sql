CREATE TYPE "public"."adverse_action_status" AS ENUM('pending_pre_adverse', 'pre_adverse_sent', 'dispute_received', 'dispute_resolved', 'final_adverse_sent', 'withdrawn', 'cleared');--> statement-breakpoint
CREATE TYPE "public"."assessment_outcome" AS ENUM('clear', 'consider', 'suspended_licence', 'revoked_licence', 'adverse', 'pending', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."candidate_status" AS ENUM('invited', 'applying', 'submitted', 'processing', 'completed', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('pre_employment', 'employment', 'contractor', 'volunteer', 'tenancy', 'financial_services', 'healthcare', 'government');--> statement-breakpoint
CREATE TYPE "public"."court_type" AS ENUM('magistrate', 'high_court', 'federal_high_court', 'court_of_appeal', 'supreme_court', 'national_industrial_court', 'sharia_court', 'customary_court');--> statement-breakpoint
CREATE TYPE "public"."package_tier" AS ENUM('basic', 'standard', 'executive', 'transport', 'healthcare', 'financial', 'custom');--> statement-breakpoint
CREATE TYPE "public"."professional_body" AS ENUM('COREN', 'NBA', 'MDCN', 'ICAN', 'CIBN', 'NIM', 'NSE', 'NIPR', 'TOPREC', 'ARCON', 'ICSAN', 'ACCA', 'CIS', 'CIPD', 'HRCI');--> statement-breakpoint
CREATE TYPE "public"."work_permit_type" AS ENUM('expatriate_quota', 'combined_expatriate_residence_permit', 'temporary_work_permit', 'subject_to_regularisation', 'business_visa');--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'nin_trace';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'bvn_fraud_check';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'nin_address_history';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'npf_criminal';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'efcc_watchlist';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'icpc_debarment';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'ndlea_drug';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'state_court';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'federal_court';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'pep_check';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'adverse_media_ng';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'frsc_mvr';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'frsc_commercial_driver';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'waec_education';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'neco_education';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'nabteb_education';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'employment_verification';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'pencom_history';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'nysc_discharge';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'professional_licence';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'cac_directorship';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'mdcn_licence';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'nis_work_permit';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'international_criminal';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'international_education';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'international_employment';--> statement-breakpoint
ALTER TYPE "public"."screening_type" ADD VALUE 'continuous_check';--> statement-breakpoint
CREATE TABLE "adverse_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"adverseRef" varchar(32) NOT NULL,
	"orderId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"status" "adverse_action_status" DEFAULT 'pending_pre_adverse' NOT NULL,
	"preAdverseSentAt" timestamp,
	"preAdverseDeadline" timestamp,
	"disputeReceivedAt" timestamp,
	"disputeResolvedAt" timestamp,
	"finalAdverseSentAt" timestamp,
	"candidateEmail" varchar(320),
	"preAdversePdfUrl" text,
	"finalAdversePdfUrl" text,
	"reason" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "adverse_actions_adverseRef_unique" UNIQUE("adverseRef")
);
--> statement-breakpoint
CREATE TABLE "adverse_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"adverseActionId" integer NOT NULL,
	"resultId" integer,
	"screeningType" "screening_type" NOT NULL,
	"description" text NOT NULL,
	"source" varchar(128),
	"date" date,
	"jurisdiction" varchar(128),
	"disputed" boolean DEFAULT false NOT NULL,
	"disputeNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"consentRef" varchar(32) NOT NULL,
	"candidateId" integer NOT NULL,
	"orderId" integer,
	"purpose" "consent_purpose" DEFAULT 'pre_employment' NOT NULL,
	"consentText" text NOT NULL,
	"signatureData" text,
	"signedAt" timestamp,
	"signerIp" varchar(45),
	"signerUserAgent" text,
	"pdfUrl" text,
	"revokedAt" timestamp,
	"revokeReason" text,
	"ndprVersion" varchar(16) DEFAULT '2019',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_consents_consentRef_unique" UNIQUE("consentRef")
);
--> statement-breakpoint
CREATE TABLE "candidate_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidateRef" varchar(32) NOT NULL,
	"tenantId" integer NOT NULL,
	"firstName" varchar(128) NOT NULL,
	"middleName" varchar(128),
	"lastName" varchar(128) NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(20),
	"nin" varchar(11),
	"bvn" varchar(11),
	"dob" date,
	"gender" varchar(16),
	"nationality" varchar(64) DEFAULT 'Nigerian',
	"stateOfOrigin" varchar(64),
	"lgaOfOrigin" varchar(64),
	"currentAddress" text,
	"currentState" varchar(64),
	"currentLga" varchar(64),
	"addressHistory" json DEFAULT '[]'::json,
	"passportNumber" varchar(20),
	"passportExpiry" date,
	"consentStatus" "candidate_status" DEFAULT 'invited' NOT NULL,
	"ndprConsentAt" timestamp,
	"ndprConsentIp" varchar(45),
	"inviteToken" varchar(128),
	"inviteExpiresAt" timestamp,
	"invitedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_profiles_candidateRef_unique" UNIQUE("candidateRef"),
	CONSTRAINT "candidate_profiles_inviteToken_unique" UNIQUE("inviteToken")
);
--> statement-breakpoint
CREATE TABLE "candidate_stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"screeningType" "screening_type" NOT NULL,
	"story" text NOT NULL,
	"attachmentUrls" json DEFAULT '[]'::json,
	"reviewedBy" integer,
	"reviewNote" text,
	"reviewedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "continuous_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"checkRef" varchar(32) NOT NULL,
	"tenantId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"screeningTypes" json DEFAULT '[]'::json NOT NULL,
	"frequency" varchar(32) DEFAULT 'monthly' NOT NULL,
	"status" "monitor_status" DEFAULT 'active' NOT NULL,
	"lastCheckedAt" timestamp,
	"nextCheckAt" timestamp,
	"alertCount" integer DEFAULT 0 NOT NULL,
	"lastAlertAt" timestamp,
	"expiresAt" timestamp,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "continuous_checks_checkRef_unique" UNIQUE("checkRef")
);
--> statement-breakpoint
CREATE TABLE "ng_court_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"resultId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"courtType" "court_type" NOT NULL,
	"courtName" varchar(255),
	"state" varchar(64),
	"caseNumber" varchar(128),
	"offence" text,
	"verdict" varchar(128),
	"sentence" text,
	"hearingDate" date,
	"dispositionDate" date,
	"isAppeal" boolean DEFAULT false,
	"rawData" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ng_professional_licences" (
	"id" serial PRIMARY KEY NOT NULL,
	"resultId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"professionalBody" "professional_body" NOT NULL,
	"licenceNumber" varchar(128),
	"membershipGrade" varchar(64),
	"issueDate" date,
	"expiryDate" date,
	"status" "assessment_outcome" DEFAULT 'pending' NOT NULL,
	"suspensionReason" text,
	"verificationDate" date,
	"rawData" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"color" varchar(16) DEFAULT '#6B7280',
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"packageId" integer,
	"screeningType" "screening_type" NOT NULL,
	"clearConditions" json,
	"considerConditions" json,
	"adverseConditions" json,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_geos" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"state" varchar(64) NOT NULL,
	"screeningType" "screening_type" NOT NULL,
	"lookbackYears" integer,
	"excludedOffences" json DEFAULT '[]'::json,
	"requiresConsent" boolean DEFAULT true NOT NULL,
	"disclosureText" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderRef" varchar(32) NOT NULL,
	"tenantId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"packageId" integer,
	"programId" integer,
	"status" "screening_status" DEFAULT 'pending' NOT NULL,
	"overallOutcome" "assessment_outcome",
	"screeningTypes" json DEFAULT '[]'::json NOT NULL,
	"etaAt" timestamp,
	"completedAt" timestamp,
	"tags" json DEFAULT '[]'::json,
	"temporalRunId" varchar(128),
	"tigerBeetleRef" varchar(64),
	"priceNgn" integer DEFAULT 0,
	"notes" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "screening_orders_orderRef_unique" UNIQUE("orderRef")
);
--> statement-breakpoint
CREATE TABLE "screening_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"packageRef" varchar(32) NOT NULL,
	"tenantId" integer,
	"name" varchar(128) NOT NULL,
	"description" text,
	"tier" "package_tier" DEFAULT 'standard' NOT NULL,
	"screeningTypes" json DEFAULT '[]'::json NOT NULL,
	"priceNgn" integer DEFAULT 0 NOT NULL,
	"etaHours" integer DEFAULT 48 NOT NULL,
	"isPublic" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"config" json,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "screening_packages_packageRef_unique" UNIQUE("packageRef")
);
--> statement-breakpoint
CREATE TABLE "screening_programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"programRef" varchar(32) NOT NULL,
	"tenantId" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"packageId" integer,
	"geoRules" json,
	"assessRules" json,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "screening_programs_programRef_unique" UNIQUE("programRef")
);
--> statement-breakpoint
CREATE TABLE "screening_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderId" integer NOT NULL,
	"screeningType" "screening_type" NOT NULL,
	"status" "screening_status" DEFAULT 'pending' NOT NULL,
	"outcome" "assessment_outcome",
	"rawResult" json,
	"summary" text,
	"riskScore" real,
	"dataSourceRef" varchar(64),
	"externalRef" varchar(128),
	"completedAt" timestamp,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_permits" (
	"id" serial PRIMARY KEY NOT NULL,
	"permitRef" varchar(32) NOT NULL,
	"candidateId" integer NOT NULL,
	"orderId" integer,
	"permitType" "work_permit_type" NOT NULL,
	"permitNumber" varchar(64),
	"issueDate" date,
	"expiryDate" date,
	"issuingAuthority" varchar(128) DEFAULT 'Nigerian Immigration Service',
	"employerName" varchar(255),
	"worksiteId" integer,
	"verificationStatus" "assessment_outcome" DEFAULT 'pending',
	"verificationData" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_permits_permitRef_unique" UNIQUE("permitRef")
);
--> statement-breakpoint
CREATE TABLE "worksites" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" text,
	"state" varchar(64),
	"lga" varchar(64),
	"rcNumber" varchar(32),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adverse_actions" ADD CONSTRAINT "adverse_actions_orderId_screening_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."screening_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adverse_actions" ADD CONSTRAINT "adverse_actions_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adverse_actions" ADD CONSTRAINT "adverse_actions_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adverse_items" ADD CONSTRAINT "adverse_items_adverseActionId_adverse_actions_id_fk" FOREIGN KEY ("adverseActionId") REFERENCES "public"."adverse_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adverse_items" ADD CONSTRAINT "adverse_items_resultId_screening_results_id_fk" FOREIGN KEY ("resultId") REFERENCES "public"."screening_results"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_consents" ADD CONSTRAINT "candidate_consents_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_consents" ADD CONSTRAINT "candidate_consents_orderId_screening_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."screening_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_invitedBy_users_id_fk" FOREIGN KEY ("invitedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_stories" ADD CONSTRAINT "candidate_stories_orderId_screening_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."screening_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_stories" ADD CONSTRAINT "candidate_stories_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_stories" ADD CONSTRAINT "candidate_stories_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuous_checks" ADD CONSTRAINT "continuous_checks_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuous_checks" ADD CONSTRAINT "continuous_checks_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuous_checks" ADD CONSTRAINT "continuous_checks_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ng_court_records" ADD CONSTRAINT "ng_court_records_resultId_screening_results_id_fk" FOREIGN KEY ("resultId") REFERENCES "public"."screening_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ng_court_records" ADD CONSTRAINT "ng_court_records_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ng_professional_licences" ADD CONSTRAINT "ng_professional_licences_resultId_screening_results_id_fk" FOREIGN KEY ("resultId") REFERENCES "public"."screening_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ng_professional_licences" ADD CONSTRAINT "ng_professional_licences_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_tags" ADD CONSTRAINT "report_tags_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_assessments" ADD CONSTRAINT "screening_assessments_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_assessments" ADD CONSTRAINT "screening_assessments_packageId_screening_packages_id_fk" FOREIGN KEY ("packageId") REFERENCES "public"."screening_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_assessments" ADD CONSTRAINT "screening_assessments_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_geos" ADD CONSTRAINT "screening_geos_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_orders" ADD CONSTRAINT "screening_orders_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_orders" ADD CONSTRAINT "screening_orders_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_orders" ADD CONSTRAINT "screening_orders_packageId_screening_packages_id_fk" FOREIGN KEY ("packageId") REFERENCES "public"."screening_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_orders" ADD CONSTRAINT "screening_orders_programId_screening_programs_id_fk" FOREIGN KEY ("programId") REFERENCES "public"."screening_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_orders" ADD CONSTRAINT "screening_orders_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_packages" ADD CONSTRAINT "screening_packages_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_packages" ADD CONSTRAINT "screening_packages_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_programs" ADD CONSTRAINT "screening_programs_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_programs" ADD CONSTRAINT "screening_programs_packageId_screening_packages_id_fk" FOREIGN KEY ("packageId") REFERENCES "public"."screening_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_programs" ADD CONSTRAINT "screening_programs_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_results" ADD CONSTRAINT "screening_results_orderId_screening_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."screening_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_orderId_screening_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."screening_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksites" ADD CONSTRAINT "worksites_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aa_order_idx" ON "adverse_actions" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "aa_candidate_idx" ON "adverse_actions" USING btree ("candidateId");--> statement-breakpoint
CREATE INDEX "aa_status_idx" ON "adverse_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_adverse_idx" ON "adverse_items" USING btree ("adverseActionId");--> statement-breakpoint
CREATE INDEX "cc_candidate_idx" ON "candidate_consents" USING btree ("candidateId");--> statement-breakpoint
CREATE INDEX "cc_order_idx" ON "candidate_consents" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "cp_tenant_idx" ON "candidate_profiles" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "cp_email_idx" ON "candidate_profiles" USING btree ("email");--> statement-breakpoint
CREATE INDEX "cp_nin_idx" ON "candidate_profiles" USING btree ("nin");--> statement-breakpoint
CREATE INDEX "cp_bvn_idx" ON "candidate_profiles" USING btree ("bvn");--> statement-breakpoint
CREATE INDEX "cs_order_idx" ON "candidate_stories" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "cs_candidate_idx" ON "candidate_stories" USING btree ("candidateId");--> statement-breakpoint
CREATE INDEX "cont_tenant_idx" ON "continuous_checks" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "cont_candidate_idx" ON "continuous_checks" USING btree ("candidateId");--> statement-breakpoint
CREATE INDEX "cont_status_idx" ON "continuous_checks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ncr_result_idx" ON "ng_court_records" USING btree ("resultId");--> statement-breakpoint
CREATE INDEX "ncr_candidate_idx" ON "ng_court_records" USING btree ("candidateId");--> statement-breakpoint
CREATE INDEX "ncr_state_idx" ON "ng_court_records" USING btree ("state");--> statement-breakpoint
CREATE INDEX "npl_result_idx" ON "ng_professional_licences" USING btree ("resultId");--> statement-breakpoint
CREATE INDEX "npl_candidate_idx" ON "ng_professional_licences" USING btree ("candidateId");--> statement-breakpoint
CREATE INDEX "npl_body_idx" ON "ng_professional_licences" USING btree ("professionalBody");--> statement-breakpoint
CREATE INDEX "rt_tenant_idx" ON "report_tags" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "sa_tenant_type_idx" ON "screening_assessments" USING btree ("tenantId","screeningType");--> statement-breakpoint
CREATE INDEX "sg_state_type_idx" ON "screening_geos" USING btree ("state","screeningType");--> statement-breakpoint
CREATE INDEX "so_tenant_idx" ON "screening_orders" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "so_candidate_idx" ON "screening_orders" USING btree ("candidateId");--> statement-breakpoint
CREATE INDEX "so_status_idx" ON "screening_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "so_created_idx" ON "screening_orders" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "sp_tenant_idx" ON "screening_packages" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "sp_tier_idx" ON "screening_packages" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "sprog_tenant_idx" ON "screening_programs" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "sr_order_idx" ON "screening_results" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "sr_type_idx" ON "screening_results" USING btree ("screeningType");--> statement-breakpoint
CREATE INDEX "sr_status_idx" ON "screening_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "wp_candidate_idx" ON "work_permits" USING btree ("candidateId");--> statement-breakpoint
CREATE INDEX "ws_tenant_idx" ON "worksites" USING btree ("tenantId");