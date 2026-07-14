-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback: 0055_drizzle_orm_improvements
-- Reverts all changes made in 0055_drizzle_orm_improvements.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 7. Drop GIN jsonb indexes ─────────────────────────────────────────────────
DROP INDEX CONCURRENTLY IF EXISTS "aml_alerts_matched_rules_gin_idx";
DROP INDEX CONCURRENTLY IF EXISTS "cases_tags_gin_idx";
DROP INDEX CONCURRENTLY IF EXISTS "kyc_records_nin_result_gin_idx";
DROP INDEX CONCURRENTLY IF EXISTS "investigations_risk_factors_gin_idx";

-- ── 6. Drop missing table indexes ────────────────────────────────────────────
DROP INDEX CONCURRENTLY IF EXISTS "sar_filings_deleted_at_idx";
DROP INDEX CONCURRENTLY IF EXISTS "aml_alerts_deleted_at_idx";
DROP INDEX CONCURRENTLY IF EXISTS "transactions_deleted_at_idx";
DROP INDEX CONCURRENTLY IF EXISTS "transactions_tenant_id_idx";
DROP INDEX CONCURRENTLY IF EXISTS "alerts_deleted_at_idx";
DROP INDEX CONCURRENTLY IF EXISTS "kyc_records_deleted_at_idx";
DROP INDEX CONCURRENTLY IF EXISTS "cases_tenant_idx";
DROP INDEX CONCURRENTLY IF EXISTS "cases_created_by_idx";
DROP INDEX CONCURRENTLY IF EXISTS "cases_deleted_at_idx";
DROP INDEX CONCURRENTLY IF EXISTS "investigations_deleted_at_idx";

-- ── 5. Drop composite unique index ───────────────────────────────────────────
DROP INDEX IF EXISTS "investigations_tenant_status_idx";

-- ── 4. Drop CHECK constraints ─────────────────────────────────────────────────
ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "cases_risk_score_check";
ALTER TABLE "kyc_records" DROP CONSTRAINT IF EXISTS "kyc_records_risk_score_check";
ALTER TABLE "investigations" DROP CONSTRAINT IF EXISTS "investigations_risk_score_check";

-- ── 3. Drop GIN full-text search indexes ─────────────────────────────────────
DROP INDEX CONCURRENTLY IF EXISTS "cases_search_idx";
DROP INDEX CONCURRENTLY IF EXISTS "kyc_records_search_idx";
DROP INDEX CONCURRENTLY IF EXISTS "investigations_search_idx";

-- ── 2. Remove soft-delete columns ────────────────────────────────────────────
ALTER TABLE "criminal_record_requests" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "field_visit_reports" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "sar_filings" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "aml_alerts" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "lex_submissions" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "candidate_profiles" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "screening_orders" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "field_agents" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "reports" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "field_tasks" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "alerts" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "kyc_records" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "cases" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "investigations" DROP COLUMN IF EXISTS "deletedBy", DROP COLUMN IF EXISTS "deletedAt";

-- ── 1. Downgrade jsonb → json ─────────────────────────────────────────────────
-- NOTE: jsonb → json is safe (no data loss); json → jsonb was also safe.
ALTER TABLE "aml_alerts"
  ALTER COLUMN "matchedRules" TYPE json USING "matchedRules"::json,
  ALTER COLUMN "transactionIds" TYPE json USING "transactionIds"::json;

ALTER TABLE "sar_filings"
  ALTER COLUMN "suspiciousActivities" TYPE json USING "suspiciousActivities"::json,
  ALTER COLUMN "relatedTransactions" TYPE json USING "relatedTransactions"::json,
  ALTER COLUMN "attachments" TYPE json USING "attachments"::json;

ALTER TABLE "screening_results"
  ALTER COLUMN "rawData" TYPE json USING "rawData"::json,
  ALTER COLUMN "flags" TYPE json USING "flags"::json;

ALTER TABLE "onboarding_applications"
  ALTER COLUMN "formData" TYPE json USING "formData"::json,
  ALTER COLUMN "verificationResults" TYPE json USING "verificationResults"::json;

ALTER TABLE "biometric_session_logs"
  ALTER COLUMN "livenessResult" TYPE json USING "livenessResult"::json,
  ALTER COLUMN "matchResult" TYPE json USING "matchResult"::json;

ALTER TABLE "criminal_records"
  ALTER COLUMN "charges" TYPE json USING "charges"::json,
  ALTER COLUMN "courtDetails" TYPE json USING "courtDetails"::json,
  ALTER COLUMN "attachmentUrls" TYPE json USING "attachmentUrls"::json;

ALTER TABLE "field_visit_reports"
  ALTER COLUMN "structuredFindings" TYPE json USING "structuredFindings"::json,
  ALTER COLUMN "photoUrls" TYPE json USING "photoUrls"::json,
  ALTER COLUMN "sourcesChecked" TYPE json USING "sourcesChecked"::json,
  ALTER COLUMN "sourcesReturned" TYPE json USING "sourcesReturned"::json,
  ALTER COLUMN "recommendedNextSteps" TYPE json USING "recommendedNextSteps"::json;

ALTER TABLE "cases"
  ALTER COLUMN "investigationRefs" TYPE json USING "investigationRefs"::json,
  ALTER COLUMN "tags" TYPE json USING "tags"::json;

ALTER TABLE "transactions"
  ALTER COLUMN "metadata" TYPE json USING "metadata"::json;

ALTER TABLE "reports"
  ALTER COLUMN "sections" TYPE json USING "sections"::json;

ALTER TABLE "field_tasks"
  ALTER COLUMN "result" TYPE json USING "result"::json;

ALTER TABLE "audit_log"
  ALTER COLUMN "detail" TYPE json USING "detail"::json;

ALTER TABLE "kyc_records"
  ALTER COLUMN "ninResult" TYPE json USING "ninResult"::json,
  ALTER COLUMN "bvnResult" TYPE json USING "bvnResult"::json,
  ALTER COLUMN "sanctionsResult" TYPE json USING "sanctionsResult"::json,
  ALTER COLUMN "pepResult" TYPE json USING "pepResult"::json,
  ALTER COLUMN "creditResult" TYPE json USING "creditResult"::json,
  ALTER COLUMN "documentOcrData" TYPE json USING "documentOcrData"::json;

ALTER TABLE "investigations"
  ALTER COLUMN "dataSources" TYPE json USING "dataSources"::json,
  ALTER COLUMN "gatewayResults" TYPE json USING "gatewayResults"::json,
  ALTER COLUMN "riskFactors" TYPE json USING "riskFactors"::json;
