import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { getPgPool } from "./db";

type BiometricPurpose = "identity_verification" | "document_face_match" | "liveness_assurance";
type BiometricOperation = "enrollment" | "liveness" | "anti_spoofing" | "face_match" | "document_match" | "full_verification";

type TenantContext = { tenantId: number | null; user: { id: number } | null };

const MAX_CONSENT_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const REVIEW_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function requireTenantActor(ctx: TenantContext): { tenantId: number; userId: number } {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated biometric operator is required" });
  if (!Number.isInteger(ctx.tenantId) || (ctx.tenantId as number) <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Biometric operations require an explicit tenant context" });
  }
  return { tenantId: ctx.tenantId as number, userId: ctx.user.id };
}

async function poolOrFail() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Biometric consent and review storage is unavailable" });
  return pool;
}

export async function grantBiometricConsent(ctx: TenantContext, input: {
  subjectRef: string;
  purpose: BiometricPurpose;
  policyVersion: string;
  proofSha256: string;
  expiresAt: Date;
  candidateId?: number;
  kycRecordId?: number;
}) {
  const { tenantId, userId } = requireTenantActor(ctx);
  if (!/^[a-f0-9]{64}$/.test(input.proofSha256)) throw new TRPCError({ code: "BAD_REQUEST", message: "Consent proof must be a SHA-256 hex digest" });
  if (input.expiresAt.getTime() <= Date.now() || input.expiresAt.getTime() > Date.now() + MAX_CONSENT_LIFETIME_MS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Biometric consent expiry must be in the next 90 days" });
  }
  const pool = await poolOrFail();
  const id = randomUUID();
  await pool.query(
    `INSERT INTO biometric_consents
      (id, tenant_id, candidate_id, kyc_record_id, subject_ref, purpose, policy_version, granted_at, expires_at, proof_sha256, captured_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10)
     ON CONFLICT (tenant_id, subject_ref, purpose, policy_version) DO UPDATE
       SET candidate_id = EXCLUDED.candidate_id,
           kyc_record_id = EXCLUDED.kyc_record_id,
           granted_at = now(), expires_at = EXCLUDED.expires_at,
           withdrawn_at = NULL, withdrawal_reason = NULL,
           proof_sha256 = EXCLUDED.proof_sha256, captured_by = EXCLUDED.captured_by`,
    [id, tenantId, input.candidateId ?? null, input.kycRecordId ?? null, input.subjectRef, input.purpose, input.policyVersion, input.expiresAt, input.proofSha256, userId],
  );
  return { consentId: id, tenantId, subjectRef: input.subjectRef, purpose: input.purpose, expiresAt: input.expiresAt.toISOString() };
}

export async function withdrawBiometricConsent(ctx: TenantContext, input: { subjectRef: string; purpose?: BiometricPurpose; reason: string }) {
  const { tenantId } = requireTenantActor(ctx);
  const pool = await poolOrFail();
  const result = await pool.query(
    `UPDATE biometric_consents SET withdrawn_at = now(), withdrawal_reason = $3
     WHERE tenant_id = $1 AND subject_ref = $2 AND withdrawn_at IS NULL
       AND ($4::text IS NULL OR purpose = $4)
     RETURNING id`,
    [tenantId, input.subjectRef, input.reason.trim(), input.purpose ?? null],
  );
  await pool.query(
    `INSERT INTO biometric_deletion_requests (id, tenant_id, subject_ref, requested_by, reason, status)
     VALUES ($1, $2, $3, $4, 'consent_withdrawn', 'requested')
     ON CONFLICT DO NOTHING`,
    [randomUUID(), tenantId, input.subjectRef, ctx.user!.id],
  );
  return { withdrawn: result.rowCount ?? 0, deletionRequested: true };
}

export async function requireBiometricConsent(ctx: TenantContext, subjectRef: string, purposes: BiometricPurpose[]): Promise<{ tenantId: number; userId: number }> {
  const actor = requireTenantActor(ctx);
  if (!subjectRef || subjectRef.length > 128) throw new TRPCError({ code: "BAD_REQUEST", message: "A valid consent-bound subject reference is required" });
  const pool = await poolOrFail();
  const found = await pool.query<{ purpose: string }>(
    `SELECT purpose FROM biometric_consents
     WHERE tenant_id = $1 AND subject_ref = $2 AND purpose = ANY($3::text[])
       AND withdrawn_at IS NULL AND granted_at <= now() AND expires_at > now()
     FOR SHARE`,
    [actor.tenantId, subjectRef, purposes],
  );
  const actual = new Set(found.rows.map((row) => row.purpose));
  if (purposes.some((purpose) => !actual.has(purpose))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Active, purpose-specific biometric consent is required" });
  }
  return actor;
}

function normalizedScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function resultReasons(result: Record<string, unknown>): string[] {
  const candidate = Array.isArray(result.failure_reasons) ? result.failure_reasons : result.reason ? [result.reason] : result.spoof_type ? [result.spoof_type] : [];
  return candidate.filter((value): value is string => typeof value === "string" && /^[a-zA-Z0-9_:-]{1,96}$/.test(value)).slice(0, 12);
}

export async function createBiometricReviewCase(ctx: TenantContext, input: {
  subjectRef: string;
  kycRecordId?: number;
  operation: BiometricOperation;
  engineResult: Record<string, unknown>;
}) {
  const { tenantId } = requireTenantActor(ctx);
  const modelVersion = typeof input.engineResult.model_version === "string" ? input.engineResult.model_version
    : typeof input.engineResult.model === "string" ? input.engineResult.model : null;
  if (!modelVersion || modelVersion.length > 128) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "The biometric engine did not provide a model version; no decision was recorded" });
  }
  const verified = input.engineResult.verified === true || input.engineResult.enrolled === true || input.engineResult.live === true || input.engineResult.genuine === true || input.engineResult.match === true;
  const outcome = verified ? "verified" : "not_verified";
  const engineRequestId = createHash("sha256")
    .update(`${input.operation}:${tenantId}:${input.subjectRef}:${modelVersion}:${JSON.stringify(input.engineResult)}`)
    .digest("hex")
    .slice(0, 64);
  const id = randomUUID();
  const pool = await poolOrFail();
  await pool.query(
    `INSERT INTO biometric_review_cases
      (id, tenant_id, kyc_record_id, subject_ref, operation, engine_request_id, outcome, score, threshold, model_version, reason_codes, status, retention_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], 'pending_human_review', $12)`,
    [id, tenantId, input.kycRecordId ?? null, input.subjectRef, input.operation, engineRequestId, outcome, normalizedScore(input.engineResult.overall_score ?? input.engineResult.score), normalizedScore(input.engineResult.threshold), modelVersion, resultReasons(input.engineResult), new Date(Date.now() + REVIEW_RETENTION_MS)],
  );
  return { reviewCaseId: id, status: "pending_human_review" as const, automatedOutcome: outcome };
}

export async function resolveBiometricReview(ctx: TenantContext, input: { reviewCaseId: string; decision: "approve" | "reject"; rationale: string }) {
  const { tenantId, userId } = requireTenantActor(ctx);
  if (input.rationale.trim().length < 10) throw new TRPCError({ code: "BAD_REQUEST", message: "A substantive human-review rationale is required" });
  const pool = await poolOrFail();
  const result = await pool.query(
    `UPDATE biometric_review_cases
     SET status = $3, reviewed_by = $4, reviewed_at = now(), review_rationale = $5
     WHERE id = $1 AND tenant_id = $2 AND status = 'pending_human_review'
     RETURNING id, kyc_record_id, subject_ref`,
    [input.reviewCaseId, tenantId, input.decision === "approve" ? "approved" : "rejected", userId, input.rationale.trim()],
  );
  if (result.rowCount !== 1) throw new TRPCError({ code: "CONFLICT", message: "The biometric review case is unavailable or already resolved" });
  return { reviewCaseId: result.rows[0].id, status: input.decision === "approve" ? "approved" as const : "rejected" as const };
}

export const biometricGovernance = { requireTenantActor, requireBiometricConsent, createBiometricReviewCase };
