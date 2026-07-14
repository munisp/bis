-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0055_drizzle_orm_improvements
-- Description: Drizzle ORM layer improvements
--   1. Upgrade json → jsonb for all JSON columns (GIN indexing, containment)
--   2. Add soft-delete columns (deletedAt, deletedBy) to 11 core entities
--   3. Add GIN full-text search indexes on investigations, cases, kyc_records
--   4. Add CHECK constraints on riskScore columns
--   5. Add composite uniqueIndex on investigations(tenantId, ref)
--   6. Add missing table indexes for tenant, createdBy, deletedAt columns
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Upgrade json → jsonb ──────────────────────────────────────────────────

-- investigations
ALTER TABLE "investigations"
  ALTER COLUMN "dataSources" TYPE jsonb USING "dataSources"::jsonb,
  ALTER COLUMN "gatewayResults" TYPE jsonb USING "gatewayResults"::jsonb,
  ALTER COLUMN "riskFactors" TYPE jsonb USING "riskFactors"::jsonb;

-- kyc_records
ALTER TABLE "kyc_records"
  ALTER COLUMN "ninResult" TYPE jsonb USING "ninResult"::jsonb,
  ALTER COLUMN "bvnResult" TYPE jsonb USING "bvnResult"::jsonb,
  ALTER COLUMN "sanctionsResult" TYPE jsonb USING "sanctionsResult"::jsonb,
  ALTER COLUMN "pepResult" TYPE jsonb USING "pepResult"::jsonb,
  ALTER COLUMN "creditResult" TYPE jsonb USING "creditResult"::jsonb,
  ALTER COLUMN "documentOcrData" TYPE jsonb USING "documentOcrData"::jsonb;

-- audit_log
ALTER TABLE "audit_log"
  ALTER COLUMN "detail" TYPE jsonb USING "detail"::jsonb;

-- field_tasks
ALTER TABLE "field_tasks"
  ALTER COLUMN "result" TYPE jsonb USING "result"::jsonb;

-- reports
ALTER TABLE "reports"
  ALTER COLUMN "sections" TYPE jsonb USING "sections"::jsonb;

-- alerts (no json columns — skip)

-- cases
ALTER TABLE "cases"
  ALTER COLUMN "investigationRefs" TYPE jsonb USING "investigationRefs"::jsonb,
  ALTER COLUMN "tags" TYPE jsonb USING "tags"::jsonb;

-- transactions
ALTER TABLE "transactions"
  ALTER COLUMN "metadata" TYPE jsonb USING "metadata"::jsonb;

-- field_visit_reports
ALTER TABLE "field_visit_reports"
  ALTER COLUMN "structuredFindings" TYPE jsonb USING "structuredFindings"::jsonb,
  ALTER COLUMN "photoUrls" TYPE jsonb USING "photoUrls"::jsonb,
  ALTER COLUMN "sourcesChecked" TYPE jsonb USING "sourcesChecked"::jsonb,
  ALTER COLUMN "sourcesReturned" TYPE jsonb USING "sourcesReturned"::jsonb,
  ALTER COLUMN "recommendedNextSteps" TYPE jsonb USING "recommendedNextSteps"::jsonb;

-- criminal_records
ALTER TABLE "criminal_records"
  ALTER COLUMN "charges" TYPE jsonb USING "charges"::jsonb,
  ALTER COLUMN "courtDetails" TYPE jsonb USING "courtDetails"::jsonb,
  ALTER COLUMN "attachmentUrls" TYPE jsonb USING "attachmentUrls"::jsonb;

-- biometric_session_logs
ALTER TABLE "biometric_session_logs"
  ALTER COLUMN "livenessResult" TYPE jsonb USING "livenessResult"::jsonb,
  ALTER COLUMN "matchResult" TYPE jsonb USING "matchResult"::jsonb;

-- onboarding_applications
ALTER TABLE "onboarding_applications"
  ALTER COLUMN "formData" TYPE jsonb USING "formData"::jsonb,
  ALTER COLUMN "verificationResults" TYPE jsonb USING "verificationResults"::jsonb;

-- screening_results
ALTER TABLE "screening_results"
  ALTER COLUMN "rawData" TYPE jsonb USING "rawData"::jsonb,
  ALTER COLUMN "flags" TYPE jsonb USING "flags"::jsonb;

-- aml_alerts
ALTER TABLE "aml_alerts"
  ALTER COLUMN "matchedRules" TYPE jsonb USING "matchedRules"::jsonb,
  ALTER COLUMN "transactionIds" TYPE jsonb USING "transactionIds"::jsonb;

-- sar_filings
ALTER TABLE "sar_filings"
  ALTER COLUMN "suspiciousActivities" TYPE jsonb USING "suspiciousActivities"::jsonb,
  ALTER COLUMN "relatedTransactions" TYPE jsonb USING "relatedTransactions"::jsonb,
  ALTER COLUMN "attachments" TYPE jsonb USING "attachments"::jsonb;

-- ── 2. Add soft-delete columns ───────────────────────────────────────────────

ALTER TABLE "investigations"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "kyc_records"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "alerts"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "field_tasks"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "reports"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "field_agents"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "screening_orders"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "candidate_profiles"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "lex_submissions"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "aml_alerts"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "sar_filings"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "field_visit_reports"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

ALTER TABLE "criminal_record_requests"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "deletedBy" integer;

-- ── 3. GIN full-text search indexes ─────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS "investigations_search_idx"
  ON "investigations"
  USING gin(
    to_tsvector('english',
      coalesce("subjectName", '') || ' ' ||
      coalesce("ref", '') || ' ' ||
      coalesce("nin", '') || ' ' ||
      coalesce("bvn", '')
    )
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS "kyc_records_search_idx"
  ON "kyc_records"
  USING gin(
    to_tsvector('english',
      coalesce("subjectName", '') || ' ' ||
      coalesce("nin", '') || ' ' ||
      coalesce("bvn", '')
    )
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS "cases_search_idx"
  ON "cases"
  USING gin(
    to_tsvector('english',
      coalesce("title", '') || ' ' ||
      coalesce("ref", '') || ' ' ||
      coalesce("summary", '')
    )
  );

-- ── 4. CHECK constraints ─────────────────────────────────────────────────────

ALTER TABLE "investigations"
  ADD CONSTRAINT "investigations_risk_score_check"
  CHECK ("riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100));

ALTER TABLE "kyc_records"
  ADD CONSTRAINT "kyc_records_risk_score_check"
  CHECK ("riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100));

ALTER TABLE "cases"
  ADD CONSTRAINT "cases_risk_score_check"
  CHECK ("riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100));

-- ── 5. Composite unique index on investigations(tenantId, ref) ────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "investigations_tenant_status_idx"
  ON "investigations" ("tenantId", "ref");

-- ── 6. Missing table indexes ─────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS "investigations_deleted_at_idx"
  ON "investigations" ("deletedAt") WHERE "deletedAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "cases_deleted_at_idx"
  ON "cases" ("deletedAt") WHERE "deletedAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "cases_created_by_idx"
  ON "cases" ("createdBy");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "cases_tenant_idx"
  ON "cases" ("tenantId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "kyc_records_deleted_at_idx"
  ON "kyc_records" ("deletedAt") WHERE "deletedAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "alerts_deleted_at_idx"
  ON "alerts" ("deletedAt") WHERE "deletedAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_tenant_id_idx"
  ON "transactions" ("tenantId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_deleted_at_idx"
  ON "transactions" ("deletedAt") WHERE "deletedAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "aml_alerts_deleted_at_idx"
  ON "aml_alerts" ("deletedAt") WHERE "deletedAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "sar_filings_deleted_at_idx"
  ON "sar_filings" ("deletedAt") WHERE "deletedAt" IS NOT NULL;

-- ── 7. GIN indexes on jsonb columns for containment queries ──────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS "investigations_risk_factors_gin_idx"
  ON "investigations" USING gin("riskFactors");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "kyc_records_nin_result_gin_idx"
  ON "kyc_records" USING gin("ninResult");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "cases_tags_gin_idx"
  ON "cases" USING gin("tags");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "aml_alerts_matched_rules_gin_idx"
  ON "aml_alerts" USING gin("matchedRules");
