CREATE TYPE "public"."compliance_report_status" AS ENUM('generating', 'ready', 'submitted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."compliance_report_type" AS ENUM('sar_xml', 'goaml_str', 'goaml_ctr', 'cbn_monthly', 'cbn_quarterly', 'fatf_risk', 'nfiu_annual', 'custom');--> statement-breakpoint
CREATE TYPE "public"."document_vault_status" AS ENUM('pending', 'verified', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."field_visit_schedule_status" AS ENUM('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled');--> statement-breakpoint
CREATE TYPE "public"."ml_model_status" AS ENUM('training', 'staging', 'production', 'deprecated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mojaloop_status" AS ENUM('initiated', 'pending', 'completed', 'failed', 'reversed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."risk_profile_status" AS ENUM('active', 'under_review', 'escalated', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sanctions_list_type" AS ENUM('un_sc', 'ofac_sdn', 'eu_consolidated', 'uk_hmt', 'cbn_watchlist', 'nfiu_watchlist', 'interpol_red', 'custom');--> statement-breakpoint
CREATE TYPE "public"."sanctions_match_status" AS ENUM('pending_review', 'confirmed_hit', 'false_positive', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."stablecoin_status" AS ENUM('pending', 'confirmed', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."waf_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TABLE "apisix_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"requestId" varchar(64),
	"routeId" varchar(64),
	"clientIp" varchar(45),
	"method" varchar(10),
	"uri" text,
	"statusCode" integer,
	"latencyMs" integer,
	"wafStatus" varchar(32),
	"wafAttackType" varchar(64),
	"tenantId" integer,
	"userId" integer,
	"rawLog" jsonb,
	"loggedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"reportType" "compliance_report_type" NOT NULL,
	"status" "compliance_report_status" DEFAULT 'generating' NOT NULL,
	"title" varchar(255) NOT NULL,
	"periodStart" timestamp,
	"periodEnd" timestamp,
	"xmlPayload" text,
	"pdfUrl" varchar(512),
	"submittedTo" varchar(64),
	"submittedAt" timestamp,
	"referenceNumber" varchar(128),
	"errorMessage" text,
	"metadata" jsonb,
	"generatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dapr_event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(128) NOT NULL,
	"pubsubName" varchar(64) DEFAULT 'bis-pubsub' NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'published' NOT NULL,
	"tenantId" integer,
	"entityRef" varchar(128),
	"publishedAt" timestamp DEFAULT now() NOT NULL,
	"failReason" text
);
--> statement-breakpoint
CREATE TABLE "document_vault" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"ownerId" integer,
	"ownerRef" varchar(128),
	"documentType" varchar(64) NOT NULL,
	"documentName" varchar(255) NOT NULL,
	"storageKey" varchar(512) NOT NULL,
	"mimeType" varchar(128),
	"sizeBytes" bigint,
	"checksum" varchar(128),
	"status" "document_vault_status" DEFAULT 'pending' NOT NULL,
	"expiresAt" timestamp,
	"verifiedBy" integer,
	"verifiedAt" timestamp,
	"tags" jsonb,
	"metadata" jsonb,
	"deletedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_visit_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"investigationId" integer,
	"caseId" integer,
	"agentId" integer,
	"subjectName" varchar(255),
	"subjectAddress" text,
	"visitType" varchar(64) DEFAULT 'residential' NOT NULL,
	"status" "field_visit_schedule_status" DEFAULT 'scheduled' NOT NULL,
	"scheduledAt" timestamp NOT NULL,
	"confirmedAt" timestamp,
	"completedAt" timestamp,
	"cancelledAt" timestamp,
	"cancellationReason" text,
	"notes" text,
	"coordinates" jsonb,
	"metadata" jsonb,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fluvio_topic_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"topicName" varchar(128) NOT NULL,
	"description" text,
	"partitions" integer DEFAULT 1,
	"replication" integer DEFAULT 1,
	"retentionMs" bigint DEFAULT 604800000,
	"isActive" boolean DEFAULT true,
	"lastMessageAt" timestamp,
	"messageCount" bigint DEFAULT 0,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fluvio_topic_registry_topicName_unique" UNIQUE("topicName")
);
--> statement-breakpoint
CREATE TABLE "keycloak_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"keycloakId" varchar(128),
	"bisUserId" integer,
	"operation" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"detail" jsonb,
	"errorMessage" text,
	"syncedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ml_model_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"modelName" varchar(128) NOT NULL,
	"version" varchar(32) NOT NULL,
	"modelType" varchar(64) NOT NULL,
	"status" "ml_model_status" DEFAULT 'staging' NOT NULL,
	"artifactPath" varchar(512),
	"metrics" jsonb,
	"hyperparams" jsonb,
	"trainedOn" timestamp,
	"promotedAt" timestamp,
	"deprecatedAt" timestamp,
	"promotedBy" integer,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mojaloop_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"txRef" varchar(128) NOT NULL,
	"externalRef" varchar(128),
	"rail" varchar(32) DEFAULT 'mojaloop' NOT NULL,
	"originatorAccount" varchar(64) NOT NULL,
	"originatorName" varchar(255),
	"beneficiaryAccount" varchar(64) NOT NULL,
	"beneficiaryName" varchar(255),
	"beneficiaryBankCode" varchar(16),
	"amountKobo" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"narration" text,
	"status" "mojaloop_status" DEFAULT 'initiated' NOT NULL,
	"failureReason" text,
	"metadata" jsonb,
	"completedAt" timestamp,
	"initiatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_transfers_txRef_unique" UNIQUE("txRef"),
	CONSTRAINT "mjl_amount_check" CHECK ("amountKobo" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_rails_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"txRef" varchar(128) NOT NULL,
	"rail" varchar(32) NOT NULL,
	"direction" varchar(8) DEFAULT 'outbound' NOT NULL,
	"amountKobo" bigint,
	"currency" varchar(3) DEFAULT 'NGN',
	"status" varchar(32) NOT NULL,
	"requestBody" jsonb,
	"responseBody" jsonb,
	"errorMessage" text,
	"latencyMs" integer,
	"initiatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permify_relationship_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" varchar(64) NOT NULL,
	"entityId" varchar(128) NOT NULL,
	"relation" varchar(64) NOT NULL,
	"subject" varchar(64) NOT NULL,
	"subjectId" varchar(128) NOT NULL,
	"operation" varchar(16) DEFAULT 'write' NOT NULL,
	"tenantId" integer,
	"actorId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"subjectRef" varchar(128) NOT NULL,
	"subjectName" varchar(255),
	"subjectType" varchar(32) DEFAULT 'individual' NOT NULL,
	"overallScore" real,
	"amlScore" real,
	"kycScore" real,
	"sanctionsScore" real,
	"fraudScore" real,
	"pepExposure" boolean DEFAULT false,
	"sanctionsHit" boolean DEFAULT false,
	"adverseMedia" boolean DEFAULT false,
	"riskBand" varchar(16) DEFAULT 'medium' NOT NULL,
	"status" "risk_profile_status" DEFAULT 'active' NOT NULL,
	"mlModelVersion" varchar(64),
	"factors" jsonb,
	"lastScoredAt" timestamp,
	"nextReviewAt" timestamp,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rp_score_check" CHECK ("overallScore" IS NULL OR ("overallScore" >= 0 AND "overallScore" <= 100))
);
--> statement-breakpoint
CREATE TABLE "sanctions_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"listType" "sanctions_list_type" NOT NULL,
	"listName" varchar(128) NOT NULL,
	"source" varchar(255),
	"version" varchar(32),
	"entryCount" integer DEFAULT 0,
	"isActive" boolean DEFAULT true,
	"lastSyncAt" timestamp,
	"nextSyncAt" timestamp,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sanctions_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"listId" integer,
	"subjectRef" varchar(128) NOT NULL,
	"subjectName" varchar(255),
	"matchedName" varchar(255),
	"matchScore" real,
	"matchType" varchar(32),
	"status" "sanctions_match_status" DEFAULT 'pending_review' NOT NULL,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"reviewNotes" text,
	"linkedAlertId" integer,
	"metadata" jsonb,
	"detectedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sm_score_check" CHECK ("matchScore" IS NULL OR ("matchScore" >= 0 AND "matchScore" <= 100))
);
--> statement-breakpoint
CREATE TABLE "service_health_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"latencyMs" integer,
	"detail" jsonb,
	"checkedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stablecoin_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"txRef" varchar(128) NOT NULL,
	"txHash" varchar(128),
	"network" varchar(32) NOT NULL,
	"currency" varchar(16) NOT NULL,
	"fromAddress" varchar(128),
	"toAddress" varchar(128),
	"amountUnits" varchar(64) NOT NULL,
	"status" "stablecoin_status" DEFAULT 'pending' NOT NULL,
	"blockNumber" bigint,
	"gasUsed" varchar(64),
	"sandbox" boolean DEFAULT false,
	"metadata" jsonb,
	"confirmedAt" timestamp,
	"initiatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stablecoin_transactions_txRef_unique" UNIQUE("txRef")
);
--> statement-breakpoint
CREATE TABLE "temporal_workflow_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflowId" varchar(256) NOT NULL,
	"runId" varchar(256),
	"workflowType" varchar(128) NOT NULL,
	"namespace" varchar(128) DEFAULT 'bis' NOT NULL,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"input" jsonb,
	"result" jsonb,
	"errorMessage" text,
	"tenantId" integer,
	"initiatedBy" integer,
	"entityRef" varchar(128),
	"entityType" varchar(64),
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "temporal_workflow_state_workflowId_unique" UNIQUE("workflowId")
);
--> statement-breakpoint
CREATE TABLE "tenant_billing_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"tigerbeetleAccountId" varchar(64),
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"balanceKobo" bigint DEFAULT 0 NOT NULL,
	"creditLimitKobo" bigint DEFAULT 0,
	"billingEmail" varchar(255),
	"billingCycle" varchar(16) DEFAULT 'monthly' NOT NULL,
	"nextBillingAt" timestamp,
	"lastBilledAt" timestamp,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_billing_accounts_tenantId_unique" UNIQUE("tenantId"),
	CONSTRAINT "tba_balance_check" CHECK ("balanceKobo" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tigerbeetle_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"accountId" varchar(64) NOT NULL,
	"tenantId" integer,
	"ledger" integer DEFAULT 1 NOT NULL,
	"code" integer DEFAULT 700 NOT NULL,
	"creditsPending" bigint DEFAULT 0,
	"creditsPosted" bigint DEFAULT 0,
	"debitsPending" bigint DEFAULT 0,
	"debitsPosted" bigint DEFAULT 0,
	"flags" integer DEFAULT 0,
	"lastReconciledAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tigerbeetle_accounts_accountId_unique" UNIQUE("accountId")
);
--> statement-breakpoint
CREATE TABLE "tigerbeetle_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transferId" varchar(64) NOT NULL,
	"debitAccountId" varchar(64) NOT NULL,
	"creditAccountId" varchar(64) NOT NULL,
	"amount" bigint NOT NULL,
	"ledger" integer DEFAULT 1 NOT NULL,
	"code" integer DEFAULT 1 NOT NULL,
	"flags" integer DEFAULT 0,
	"userData" jsonb,
	"tenantId" integer,
	"txRef" varchar(128),
	"reconciledAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tigerbeetle_transfers_transferId_unique" UNIQUE("transferId")
);
--> statement-breakpoint
CREATE TABLE "waf_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"sourceIp" varchar(45),
	"method" varchar(10),
	"uri" text,
	"attackType" varchar(64),
	"severity" "waf_severity" DEFAULT 'medium' NOT NULL,
	"blocked" boolean DEFAULT true NOT NULL,
	"ruleId" varchar(64),
	"userAgent" text,
	"requestBody" text,
	"responseCode" integer,
	"country" varchar(3),
	"apisixRouteId" varchar(128),
	"openappsecEventId" varchar(128),
	"metadata" jsonb,
	"resolvedAt" timestamp,
	"resolvedBy" integer,
	"occurredAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_reviews" ALTER COLUMN "permifyChanges" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "permissions" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "api_tokens" ALTER COLUMN "scopes" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "api_tokens" ALTER COLUMN "scopes" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "detail" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ALTER COLUMN "addressHistory" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ALTER COLUMN "addressHistory" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "candidate_stories" ALTER COLUMN "attachmentUrls" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "candidate_stories" ALTER COLUMN "attachmentUrls" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "case_timeline" ALTER COLUMN "detail" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "investigationRefs" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "investigationRefs" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "tags" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "tags" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "continuous_checks" ALTER COLUMN "screeningTypes" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "continuous_checks" ALTER COLUMN "screeningTypes" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "corporate_screening_profiles" ALTER COLUMN "cacResult" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "corporate_screening_profiles" ALTER COLUMN "firsResult" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "corporate_screening_profiles" ALTER COLUMN "directorsResult" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "corporate_screening_profiles" ALTER COLUMN "sanctionsResult" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "correspondent_banks" ALTER COLUMN "services" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "correspondent_banks" ALTER COLUMN "currencies" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "criminal_record_audit" ALTER COLUMN "details" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "criminal_record_requests" ALTER COLUMN "requestedChecks" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "criminal_record_requests" ALTER COLUMN "requestedChecks" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "criminal_records" ALTER COLUMN "aliases" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "criminal_records" ALTER COLUMN "aliases" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "criminal_records" ALTER COLUMN "rawPayload" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "data_sources" ALTER COLUMN "config" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "evidence_items" ALTER COLUMN "chainOfCustody" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "export_schedules" ALTER COLUMN "filters" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "field_agents" ALTER COLUMN "specializations" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "field_agents" ALTER COLUMN "specializations" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "field_tasks" ALTER COLUMN "result" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "field_visit_reports" ALTER COLUMN "structuredFindings" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "field_visit_reports" ALTER COLUMN "photoUrls" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "field_visit_reports" ALTER COLUMN "photoUrls" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "field_visit_reports" ALTER COLUMN "sourcesChecked" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "field_visit_reports" ALTER COLUMN "sourcesChecked" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "field_visit_reports" ALTER COLUMN "sourcesReturned" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "field_visit_reports" ALTER COLUMN "sourcesReturned" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "field_visit_reports" ALTER COLUMN "recommendedNextSteps" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "field_visit_reports" ALTER COLUMN "recommendedNextSteps" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "insider_events" ALTER COLUMN "evidence" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "investigations" ALTER COLUMN "dataSources" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "investigations" ALTER COLUMN "gatewayResults" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "investigations" ALTER COLUMN "riskFactors" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "kyc_documents" ALTER COLUMN "previousOcrData" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "kyc_records" ALTER COLUMN "ninResult" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "kyc_records" ALTER COLUMN "bvnResult" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "kyc_records" ALTER COLUMN "sanctionsResult" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "kyc_records" ALTER COLUMN "pepResult" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "kyc_records" ALTER COLUMN "creditResult" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "kyc_records" ALTER COLUMN "documentOcrData" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "letters_of_credit" ALTER COLUMN "documents" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "letters_of_credit" ALTER COLUMN "amendments" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "letters_of_credit" ALTER COLUMN "discrepancies" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "lex_submissions" ALTER COLUMN "documents" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "lex_submissions" ALTER COLUMN "documents" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "lex_submissions" ALTER COLUMN "validationNotes" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "monitors" ALTER COLUMN "config" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "ng_court_records" ALTER COLUMN "rawData" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "ng_professional_licences" ALTER COLUMN "rawData" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "nigerian_data_bundle_runs" ALTER COLUMN "selectedSources" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "nigerian_data_bundle_runs" ALTER COLUMN "results" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "ollama_models" ALTER COLUMN "useCase" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "ollama_models" ALTER COLUMN "useCase" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "onboarding_applications" ALTER COLUMN "stakeholders" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "onboarding_applications" ALTER COLUMN "stakeholders" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "onboarding_applications" ALTER COLUMN "documentUrls" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "onboarding_applications" ALTER COLUMN "documentUrls" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "onboarding_applications" ALTER COLUMN "reviewerLog" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "onboarding_applications" ALTER COLUMN "reviewerLog" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "platform_settings" ALTER COLUMN "value" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "regulatory_reports" ALTER COLUMN "metadata" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "sections" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "sar_filings" ALTER COLUMN "relatedTransactions" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_ai_summaries" ALTER COLUMN "orderRefs" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_ai_summaries" ALTER COLUMN "orderRefs" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "screening_ai_summaries" ALTER COLUMN "keyFindings" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_ai_summaries" ALTER COLUMN "keyFindings" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "screening_ai_summaries" ALTER COLUMN "redFlags" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_ai_summaries" ALTER COLUMN "redFlags" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "screening_ai_summaries" ALTER COLUMN "recommendations" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_ai_summaries" ALTER COLUMN "recommendations" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "screening_assessments" ALTER COLUMN "clearConditions" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_assessments" ALTER COLUMN "considerConditions" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_assessments" ALTER COLUMN "adverseConditions" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_geos" ALTER COLUMN "excludedOffences" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_geos" ALTER COLUMN "excludedOffences" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "screening_orders" ALTER COLUMN "screeningTypes" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_orders" ALTER COLUMN "screeningTypes" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "screening_orders" ALTER COLUMN "tags" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_orders" ALTER COLUMN "tags" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "screening_packages" ALTER COLUMN "screeningTypes" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_packages" ALTER COLUMN "screeningTypes" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "screening_packages" ALTER COLUMN "config" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_programs" ALTER COLUMN "geoRules" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_programs" ALTER COLUMN "assessRules" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_requests" ALTER COLUMN "requestData" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_requests" ALTER COLUMN "result" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "screening_results" ALTER COLUMN "rawResult" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "swift_messages" ALTER COLUMN "parsedFields" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "amlFlags" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "ueba_profiles" ALTER COLUMN "hourHistogram" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "ueba_profiles" ALTER COLUMN "dayHistogram" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "user_totp_secrets" ALTER COLUMN "backupCodes" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "user_totp_secrets" ALTER COLUMN "backupCodes" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "webhooks" ALTER COLUMN "events" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "webhooks" ALTER COLUMN "events" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "work_permits" ALTER COLUMN "verificationData" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "aml_alerts" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "aml_alerts" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "field_agents" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "field_agents" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "field_tasks" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "field_tasks" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "kyc_records" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "kyc_records" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "lex_submissions" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "lex_submissions" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "sar_filings" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "sar_filings" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "screening_orders" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "screening_orders" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deletedBy" integer;--> statement-breakpoint
ALTER TABLE "apisix_audit_log" ADD CONSTRAINT "apisix_audit_log_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apisix_audit_log" ADD CONSTRAINT "apisix_audit_log_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD CONSTRAINT "compliance_reports_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD CONSTRAINT "compliance_reports_generatedBy_users_id_fk" FOREIGN KEY ("generatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dapr_event_log" ADD CONSTRAINT "dapr_event_log_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_vault" ADD CONSTRAINT "document_vault_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_vault" ADD CONSTRAINT "document_vault_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_vault" ADD CONSTRAINT "document_vault_verifiedBy_users_id_fk" FOREIGN KEY ("verifiedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_visit_schedules" ADD CONSTRAINT "field_visit_schedules_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_visit_schedules" ADD CONSTRAINT "field_visit_schedules_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_visit_schedules" ADD CONSTRAINT "field_visit_schedules_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_visit_schedules" ADD CONSTRAINT "field_visit_schedules_agentId_field_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."field_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_visit_schedules" ADD CONSTRAINT "field_visit_schedules_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keycloak_sync_log" ADD CONSTRAINT "keycloak_sync_log_bisUserId_users_id_fk" FOREIGN KEY ("bisUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ml_model_versions" ADD CONSTRAINT "ml_model_versions_promotedBy_users_id_fk" FOREIGN KEY ("promotedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mojaloop_transfers" ADD CONSTRAINT "mojaloop_transfers_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mojaloop_transfers" ADD CONSTRAINT "mojaloop_transfers_initiatedBy_users_id_fk" FOREIGN KEY ("initiatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_rails_log" ADD CONSTRAINT "payment_rails_log_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_rails_log" ADD CONSTRAINT "payment_rails_log_initiatedBy_users_id_fk" FOREIGN KEY ("initiatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permify_relationship_log" ADD CONSTRAINT "permify_relationship_log_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permify_relationship_log" ADD CONSTRAINT "permify_relationship_log_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_profiles" ADD CONSTRAINT "risk_profiles_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_profiles" ADD CONSTRAINT "risk_profiles_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions_matches" ADD CONSTRAINT "sanctions_matches_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions_matches" ADD CONSTRAINT "sanctions_matches_listId_sanctions_lists_id_fk" FOREIGN KEY ("listId") REFERENCES "public"."sanctions_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions_matches" ADD CONSTRAINT "sanctions_matches_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stablecoin_transactions" ADD CONSTRAINT "stablecoin_transactions_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stablecoin_transactions" ADD CONSTRAINT "stablecoin_transactions_initiatedBy_users_id_fk" FOREIGN KEY ("initiatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_workflow_state" ADD CONSTRAINT "temporal_workflow_state_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_workflow_state" ADD CONSTRAINT "temporal_workflow_state_initiatedBy_users_id_fk" FOREIGN KEY ("initiatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_accounts" ADD CONSTRAINT "tenant_billing_accounts_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_accounts" ADD CONSTRAINT "tigerbeetle_accounts_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_transfers" ADD CONSTRAINT "tigerbeetle_transfers_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waf_incidents" ADD CONSTRAINT "waf_incidents_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waf_incidents" ADD CONSTRAINT "waf_incidents_resolvedBy_users_id_fk" FOREIGN KEY ("resolvedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aal_ip_idx" ON "apisix_audit_log" USING btree ("clientIp");--> statement-breakpoint
CREATE INDEX "aal_route_idx" ON "apisix_audit_log" USING btree ("routeId");--> statement-breakpoint
CREATE INDEX "aal_status_idx" ON "apisix_audit_log" USING btree ("statusCode");--> statement-breakpoint
CREATE INDEX "aal_ts_idx" ON "apisix_audit_log" USING btree ("loggedAt");--> statement-breakpoint
CREATE INDEX "aal_tenant_idx" ON "apisix_audit_log" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "cr_tenant_idx" ON "compliance_reports" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "cr_type_idx" ON "compliance_reports" USING btree ("reportType");--> statement-breakpoint
CREATE INDEX "cr_status_idx" ON "compliance_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "del_topic_idx" ON "dapr_event_log" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "del_entity_idx" ON "dapr_event_log" USING btree ("entityRef");--> statement-breakpoint
CREATE INDEX "del_tenant_idx" ON "dapr_event_log" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "del_ts_idx" ON "dapr_event_log" USING btree ("publishedAt");--> statement-breakpoint
CREATE INDEX "dv_owner_idx" ON "document_vault" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "dv_ref_idx" ON "document_vault" USING btree ("ownerRef");--> statement-breakpoint
CREATE INDEX "dv_tenant_idx" ON "document_vault" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "dv_type_idx" ON "document_vault" USING btree ("documentType");--> statement-breakpoint
CREATE INDEX "dv_deleted_idx" ON "document_vault" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "fvs_agent_idx" ON "field_visit_schedules" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "fvs_inv_idx" ON "field_visit_schedules" USING btree ("investigationId");--> statement-breakpoint
CREATE INDEX "fvs_sched_idx" ON "field_visit_schedules" USING btree ("scheduledAt");--> statement-breakpoint
CREATE INDEX "fvs_status_idx" ON "field_visit_schedules" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ftr_topic_idx" ON "fluvio_topic_registry" USING btree ("topicName");--> statement-breakpoint
CREATE INDEX "ksl_keycloak_idx" ON "keycloak_sync_log" USING btree ("keycloakId");--> statement-breakpoint
CREATE INDEX "ksl_user_idx" ON "keycloak_sync_log" USING btree ("bisUserId");--> statement-breakpoint
CREATE INDEX "ksl_op_idx" ON "keycloak_sync_log" USING btree ("operation");--> statement-breakpoint
CREATE INDEX "mlm_name_idx" ON "ml_model_versions" USING btree ("modelName");--> statement-breakpoint
CREATE INDEX "mlm_status_idx" ON "ml_model_versions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "mlm_version_uniq" ON "ml_model_versions" USING btree ("modelName","version");--> statement-breakpoint
CREATE INDEX "mjl_txref_idx" ON "mojaloop_transfers" USING btree ("txRef");--> statement-breakpoint
CREATE INDEX "mjl_tenant_idx" ON "mojaloop_transfers" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "mjl_status_idx" ON "mojaloop_transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "prl_txref_idx" ON "payment_rails_log" USING btree ("txRef");--> statement-breakpoint
CREATE INDEX "prl_log_tenant_idx" ON "payment_rails_log" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "prl_rail_idx" ON "payment_rails_log" USING btree ("rail");--> statement-breakpoint
CREATE INDEX "prl_time_idx" ON "payment_rails_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "prl_entity_idx" ON "permify_relationship_log" USING btree ("entity","entityId");--> statement-breakpoint
CREATE INDEX "prl_subject_idx" ON "permify_relationship_log" USING btree ("subject","subjectId");--> statement-breakpoint
CREATE INDEX "prl_tenant_idx" ON "permify_relationship_log" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "rp_subject_idx" ON "risk_profiles" USING btree ("subjectRef");--> statement-breakpoint
CREATE INDEX "rp_tenant_idx" ON "risk_profiles" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "rp_band_idx" ON "risk_profiles" USING btree ("riskBand");--> statement-breakpoint
CREATE INDEX "rp_score_idx" ON "risk_profiles" USING btree ("overallScore");--> statement-breakpoint
CREATE UNIQUE INDEX "rp_subject_uniq" ON "risk_profiles" USING btree ("tenantId","subjectRef");--> statement-breakpoint
CREATE INDEX "sl_type_idx" ON "sanctions_lists" USING btree ("listType");--> statement-breakpoint
CREATE INDEX "sl_active_idx" ON "sanctions_lists" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "sm_subject_idx" ON "sanctions_matches" USING btree ("subjectRef");--> statement-breakpoint
CREATE INDEX "sm_tenant_idx" ON "sanctions_matches" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "sm_status_idx" ON "sanctions_matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sm_score_idx" ON "sanctions_matches" USING btree ("matchScore");--> statement-breakpoint
CREATE INDEX "shh_service_idx" ON "service_health_history" USING btree ("service");--> statement-breakpoint
CREATE INDEX "shh_ts_idx" ON "service_health_history" USING btree ("checkedAt");--> statement-breakpoint
CREATE INDEX "shh_status_idx" ON "service_health_history" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sc_txref_idx" ON "stablecoin_transactions" USING btree ("txRef");--> statement-breakpoint
CREATE INDEX "sc_txhash_idx" ON "stablecoin_transactions" USING btree ("txHash");--> statement-breakpoint
CREATE INDEX "sc_tenant_idx" ON "stablecoin_transactions" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "sc_status_idx" ON "stablecoin_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tws_entity_idx" ON "temporal_workflow_state" USING btree ("entityRef","entityType");--> statement-breakpoint
CREATE INDEX "tws_status_idx" ON "temporal_workflow_state" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tws_tenant_idx" ON "temporal_workflow_state" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "tws_type_idx" ON "temporal_workflow_state" USING btree ("workflowType");--> statement-breakpoint
CREATE INDEX "tba_tenant_idx" ON "tenant_billing_accounts" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "tb_tenant_idx" ON "tigerbeetle_accounts" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "tb_account_idx" ON "tigerbeetle_accounts" USING btree ("accountId");--> statement-breakpoint
CREATE INDEX "tbt_debit_idx" ON "tigerbeetle_transfers" USING btree ("debitAccountId");--> statement-breakpoint
CREATE INDEX "tbt_credit_idx" ON "tigerbeetle_transfers" USING btree ("creditAccountId");--> statement-breakpoint
CREATE INDEX "tbt_tenant_idx" ON "tigerbeetle_transfers" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "tbt_txref_idx" ON "tigerbeetle_transfers" USING btree ("txRef");--> statement-breakpoint
CREATE INDEX "waf_ip_idx" ON "waf_incidents" USING btree ("sourceIp");--> statement-breakpoint
CREATE INDEX "waf_sev_idx" ON "waf_incidents" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "waf_time_idx" ON "waf_incidents" USING btree ("occurredAt");--> statement-breakpoint
CREATE INDEX "waf_tenant_idx" ON "waf_incidents" USING btree ("tenantId");--> statement-breakpoint
ALTER TABLE "biometric_templates" ADD CONSTRAINT "biometric_templates_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_sites" ADD CONSTRAINT "collection_sites_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_created_by_idx" ON "cases" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "cases_tenant_idx" ON "cases" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "cases_deleted_at_idx" ON "cases" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "cases_search_idx" ON "cases" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("ref", '') || ' ' || coalesce("summary", '')));--> statement-breakpoint
CREATE UNIQUE INDEX "investigations_tenant_status_idx" ON "investigations" USING btree ("tenantId","ref");--> statement-breakpoint
CREATE INDEX "investigations_deleted_at_idx" ON "investigations" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "investigations_search_idx" ON "investigations" USING gin (to_tsvector('english', coalesce("subjectName", '') || ' ' || coalesce("ref", '') || ' ' || coalesce("nin", '') || ' ' || coalesce("bvn", '')));--> statement-breakpoint
CREATE INDEX "kyc_records_search_idx" ON "kyc_records" USING gin (to_tsvector('english', coalesce("subjectName", '') || ' ' || coalesce("nin", '') || ' ' || coalesce("bvn", '')));--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_risk_score_check" CHECK ("riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100));--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_risk_score_check" CHECK ("riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100));--> statement-breakpoint
ALTER TABLE "kyc_records" ADD CONSTRAINT "kyc_records_risk_score_check" CHECK ("riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100));