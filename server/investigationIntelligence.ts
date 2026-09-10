import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { getPgPool } from "./db";

const FACTOR_CODE = /^[a-z][a-z0-9_]{2,63}$/;
const PROHIBITED_FACTORS = new Set([
  "biometric", "race", "ethnicity", "religion", "gender", "disability", "health",
  "political_opinion", "union_membership", "sexual_orientation",
]);
const POLICY_SCHEMA = z.object({
  baseScore: z.number().int().min(0).max(100).default(50),
  minimumCoverage: z.number().min(0.1).max(1).default(0.7),
  minimumConfidence: z.number().min(0.1).max(1).default(0.6),
  maxEvidenceAgeDays: z.number().int().min(1).max(3650).default(365),
  factors: z.array(z.object({
    code: z.string().regex(FACTOR_CODE),
    weight: z.number().positive().max(40),
    required: z.boolean().default(false),
  })).min(1).max(20),
}).superRefine((value, ctx) => {
  const codes = new Set<string>();
  let totalWeight = 0;
  for (let index = 0; index < value.factors.length; index += 1) {
    const factor = value.factors[index];
    if (PROHIBITED_FACTORS.has(factor.code)) ctx.addIssue({ code: "custom", path: ["factors", index, "code"], message: "Protected, biometric, or sensitive factors are prohibited" });
    if (codes.has(factor.code)) ctx.addIssue({ code: "custom", path: ["factors", index, "code"], message: "Factor codes must be unique" });
    codes.add(factor.code); totalWeight += factor.weight;
  }
  if (totalWeight > 100) ctx.addIssue({ code: "custom", path: ["factors"], message: "Total configured factor weight cannot exceed 100" });
});

type Policy = z.infer<typeof POLICY_SCHEMA>;
type Ctx = { tenantId: number | null; user: { id: number; role?: string | null } | null };

type Evidence = { id: string; factor_code: string; assertion_direction: number; confidence: string | number; observed_at: Date; expires_at: Date; provenance_status: string };

function sha256(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function clamp(value: number, floor: number, ceiling: number): number { return Math.max(floor, Math.min(ceiling, value)); }
function requireTenant(ctx: Ctx): { tenantId: number; userId: number } {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication is required" });
  if (!Number.isInteger(ctx.tenantId) || (ctx.tenantId ?? 0) <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "An explicit tenant context is required" });
  return { tenantId: ctx.tenantId as number, userId: ctx.user.id };
}
async function poolOrFail() { const pool = await getPgPool(); if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Investigation intelligence storage is unavailable" }); return pool; }
async function assertCandidateTenant(tenantId: number, candidateId: number) {
  const pool = await poolOrFail();
  const result = await pool.query('SELECT id FROM candidate_profiles WHERE id = $1 AND "tenantId" = $2', [candidateId, tenantId]);
  if (result.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Candidate was not found in this tenant" });
}
async function appendAudit(tenantId: number, actorUserId: number, eventType: string, resourceType: string, resourceId: string | null, metadata: Record<string, unknown>, candidateId?: number) {
  const pool = await poolOrFail();
  const canonical = { tenantId, actorUserId, eventType, resourceType, resourceId, candidateId: candidateId ?? null, metadata };
  await pool.query(
    "INSERT INTO intelligence_audit_events (id, tenant_id, event_type, actor_user_id, subject_candidate_id, resource_type, resource_id, event_sha256, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
    [randomUUID(), tenantId, eventType, actorUserId, candidateId ?? null, resourceType, resourceId, sha256(canonical), JSON.stringify(metadata)],
  );
}

export function calculateEvidenceScore(policy: Policy, evidence: Evidence[], contradictions: number, now = new Date()) {
  const byCode = new Map(evidence.map(item => [item.factor_code, item]));
  let raw = policy.baseScore;
  let weightedConfidence = 0;
  let weightedFreshness = 0;
  let observedWeight = 0;
  const factors: Array<{ evidenceId: string; factorCode: string; direction: -1 | 1; configuredWeight: number; confidence: number; freshness: number; contribution: number; reasonCode: string }> = [];
  const reasonCodes: string[] = [];
  for (const factor of policy.factors) {
    const item = byCode.get(factor.code);
    if (!item || item.provenance_status === "withdrawn" || item.provenance_status === "contradicted") {
      if (factor.required) reasonCodes.push(`MISSING_REQUIRED_${factor.code.toUpperCase()}`);
      continue;
    }
    const confidence = clamp(Number(item.confidence), 0, 1);
    const lifetime = Math.max(1, item.expires_at.getTime() - item.observed_at.getTime());
    const remaining = clamp((item.expires_at.getTime() - now.getTime()) / lifetime, 0, 1);
    const contribution = Number((factor.weight * confidence * remaining * item.assertion_direction).toFixed(4));
    raw += contribution;
    observedWeight += factor.weight;
    weightedConfidence += factor.weight * confidence;
    weightedFreshness += factor.weight * remaining;
    factors.push({ evidenceId: item.id, factorCode: factor.code, direction: item.assertion_direction === -1 ? -1 : 1, configuredWeight: factor.weight, confidence, freshness: remaining, contribution, reasonCode: `${item.assertion_direction === -1 ? "ADVERSE" : "SUPPORTING"}_${factor.code.toUpperCase()}` });
  }
  const totalWeight = policy.factors.reduce((sum, item) => sum + item.weight, 0);
  const coverage = totalWeight === 0 ? 0 : observedWeight / totalWeight;
  const confidence = observedWeight === 0 ? 0 : weightedConfidence / observedWeight;
  const freshness = observedWeight === 0 ? 0 : weightedFreshness / observedWeight;
  if (contradictions > 0) reasonCodes.push("UNRESOLVED_EVIDENCE_CONTRADICTION");
  if (coverage < policy.minimumCoverage) reasonCodes.push("INSUFFICIENT_EVIDENCE_COVERAGE");
  if (confidence < policy.minimumConfidence) reasonCodes.push("INSUFFICIENT_EVIDENCE_CONFIDENCE");
  if (freshness < 0.5) reasonCodes.push("EVIDENCE_FRESHNESS_DEGRADED");
  const decisionSupportStatus = contradictions > 0 || coverage < policy.minimumCoverage || confidence < policy.minimumConfidence
    ? (coverage < policy.minimumCoverage || confidence < policy.minimumConfidence ? "insufficient_evidence" : "manual_review_required")
    : "decision_support_only";
  return { score: Math.round(clamp(raw, 0, 100)), confidence: Number(confidence.toFixed(4)), coverage: Number(coverage.toFixed(4)), freshness: Number(freshness.toFixed(4)), factors, reasonCodes: Array.from(new Set(reasonCodes)), decisionSupportStatus } as const;
}

async function activePolicy(tenantId: number, policyCode: string): Promise<{ id: string; methodology: Policy }> {
  const pool = await poolOrFail();
  const result = await pool.query("SELECT id, methodology FROM investigation_score_policies WHERE tenant_id = $1 AND policy_code = $2 AND status = 'active' AND effective_from <= now()", [tenantId, policyCode]);
  if (result.rowCount !== 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No active approved scoring policy is available" });
  return { id: result.rows[0].id, methodology: POLICY_SCHEMA.parse(result.rows[0].methodology) };
}

export const investigationIntelligenceRouter = router({
  createScorePolicy: adminProcedure.input(z.object({ policyCode: z.string().regex(FACTOR_CODE), methodology: POLICY_SCHEMA })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx); const pool = await poolOrFail();
    const existing = await pool.query("SELECT COALESCE(MAX(version), 0) AS version FROM investigation_score_policies WHERE tenant_id = $1 AND policy_code = $2", [tenantId, input.policyCode]);
    const id = randomUUID(); const version = Number(existing.rows[0].version) + 1;
    await pool.query("INSERT INTO investigation_score_policies (id, tenant_id, policy_code, version, status, methodology, created_by) VALUES ($1,$2,$3,$4,'draft',$5::jsonb,$6)", [id, tenantId, input.policyCode, version, JSON.stringify(input.methodology), userId]);
    await appendAudit(tenantId, userId, "score_policy_created", "score_policy", id, { policyCode: input.policyCode, version });
    return { id, version, status: "draft" as const };
  }),
  activateScorePolicy: adminProcedure.input(z.object({ policyId: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx); const pool = await poolOrFail();
    const current = await pool.query("SELECT policy_code, created_by FROM investigation_score_policies WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [input.policyId, tenantId]);
    if (current.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Scoring policy was not found" });
    if (Number(current.rows[0].created_by) === userId) throw new TRPCError({ code: "FORBIDDEN", message: "A different administrator must approve a scoring policy" });
    await pool.query("UPDATE investigation_score_policies SET status = 'retired', retired_at = now(), updated_at = now() WHERE tenant_id = $1 AND policy_code = $2 AND status = 'active'", [tenantId, current.rows[0].policy_code]);
    await pool.query("UPDATE investigation_score_policies SET status = 'active', approved_by = $1, approved_at = now(), effective_from = now(), updated_at = now() WHERE id = $2 AND tenant_id = $3 AND status = 'draft'", [userId, input.policyId, tenantId]);
    await appendAudit(tenantId, userId, "score_policy_activated", "score_policy", input.policyId, { policyCode: current.rows[0].policy_code });
    return { activated: true };
  }),
  registerSource: adminProcedure.input(z.object({ sourceCode: z.string().regex(FACTOR_CODE), sourceClass: z.enum(["subject_provided","field_verified","informal_reference","licensed_provider","public_record","government_authorized","internal_case_record"]), authorityLevel: z.enum(["unverified","declared","verified","licensed","government_authorized"]), providerAuthorizationId: z.coerce.number().int().positive().optional(), jurisdiction: z.string().min(2).max(96), permittedPurposes: z.array(z.string().min(3).max(64)).min(1).max(16), retentionDays: z.number().int().min(1).max(3650) })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx); if (["licensed", "government_authorized"].includes(input.authorityLevel) && !input.providerAuthorizationId) throw new TRPCError({ code: "BAD_REQUEST", message: "Licensed and government sources require an approved provider authorization" });
    const id = randomUUID(); const pool = await poolOrFail();
    if (input.providerAuthorizationId) {
      const authorization = await pool.query("SELECT id FROM data_provider_authorizations WHERE id = $1 AND status = 'active' AND effective_at <= now() AND expires_at > now() AND (tenant_id = $2 OR tenant_id IS NULL)", [input.providerAuthorizationId, tenantId]);
      if (authorization.rowCount !== 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Provider authorization is inactive, expired, or outside this tenant" });
    }
    await pool.query("INSERT INTO intelligence_source_catalog (id, tenant_id, source_code, source_class, authority_level, provider_authorization_id, jurisdiction, permitted_purposes, retention_days, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, tenantId, input.sourceCode, input.sourceClass, input.authorityLevel, input.providerAuthorizationId ?? null, input.jurisdiction, input.permittedPurposes, input.retentionDays, userId]);
    await appendAudit(tenantId, userId, "intelligence_source_registered", "intelligence_source", id, { sourceCode: input.sourceCode, authorityLevel: input.authorityLevel }); return { id };
  }),
  recordEvidence: protectedProcedure.input(z.object({ candidateId: z.number().int().positive(), investigationId: z.number().int().positive().optional(), sourceId: z.string().uuid(), purposeCode: z.string().regex(FACTOR_CODE), factorCode: z.string().regex(FACTOR_CODE), assertionDirection: z.union([z.literal(-1), z.literal(1)]), confidence: z.number().min(0).max(1), observedAt: z.date(), expiresAt: z.date(), evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/), provenanceStatus: z.enum(["claimed","attested","independently_confirmed","contradicted","withdrawn"]) })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx); if (PROHIBITED_FACTORS.has(input.factorCode)) throw new TRPCError({ code: "BAD_REQUEST", message: "Sensitive and biometric factors cannot be scored" });
    if (input.expiresAt <= input.observedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Evidence expiry must be after observation" }); await assertCandidateTenant(tenantId, input.candidateId); const pool = await poolOrFail();
    const source = await pool.query("SELECT s.retention_days FROM intelligence_source_catalog s LEFT JOIN data_provider_authorizations p ON p.id = s.provider_authorization_id WHERE s.id = $1 AND s.tenant_id = $2 AND s.active = true AND $3 = ANY(s.permitted_purposes) AND (s.provider_authorization_id IS NULL OR (p.status = 'active' AND p.effective_at <= now() AND p.expires_at > now() AND (p.tenant_id = $2 OR p.tenant_id IS NULL)))", [input.sourceId, tenantId, input.purposeCode]);
    if (source.rowCount !== 1) throw new TRPCError({ code: "FORBIDDEN", message: "Source is inactive, unapproved, or not authorized for this purpose" });
    const id = randomUUID(); await pool.query("INSERT INTO intelligence_evidence_records (id, tenant_id, candidate_id, investigation_id, source_id, purpose_code, factor_code, assertion_direction, confidence, observed_at, expires_at, evidence_sha256, provenance_status, withdrawn_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $13='withdrawn' THEN now() ELSE NULL END,$14)", [id, tenantId, input.candidateId, input.investigationId ?? null, input.sourceId, input.purposeCode, input.factorCode, input.assertionDirection, input.confidence, input.observedAt, input.expiresAt, input.evidenceSha256, input.provenanceStatus, userId]);
    await appendAudit(tenantId, userId, "intelligence_evidence_recorded", "intelligence_evidence", id, { factorCode: input.factorCode, provenanceStatus: input.provenanceStatus }, input.candidateId); return { id };
  }),
  calculateScore: protectedProcedure.input(z.object({ candidateId: z.number().int().positive(), investigationId: z.number().int().positive().optional(), policyCode: z.string().regex(FACTOR_CODE) })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx); await assertCandidateTenant(tenantId, input.candidateId); const pool = await poolOrFail(); const policy = await activePolicy(tenantId, input.policyCode);
    const evidenceResult = await pool.query<Evidence>("SELECT id, factor_code, assertion_direction, confidence, observed_at, expires_at, provenance_status FROM intelligence_evidence_records WHERE tenant_id = $1 AND candidate_id = $2 AND expires_at > now() AND provenance_status NOT IN ('withdrawn','contradicted')", [tenantId, input.candidateId]);
    const conflict = await pool.query("SELECT COUNT(*)::integer AS count FROM intelligence_evidence_conflicts WHERE tenant_id = $1 AND candidate_id = $2 AND status IN ('open','under_review')", [tenantId, input.candidateId]);
    const result = calculateEvidenceScore(policy.methodology, evidenceResult.rows, Number(conflict.rows[0].count)); const id = randomUUID(); const expiresAt = new Date(Date.now() + Math.min(policy.methodology.maxEvidenceAgeDays, 365) * 86_400_000);
    await pool.query("UPDATE investigation_score_assessments SET superseded_at = now() WHERE tenant_id = $1 AND candidate_id = $2 AND policy_id = $3 AND superseded_at IS NULL", [tenantId, input.candidateId, policy.id]);
    await pool.query("INSERT INTO investigation_score_assessments (id, tenant_id, candidate_id, investigation_id, policy_id, score, confidence, coverage, freshness, contradiction_count, decision_support_status, reason_codes, input_sha256, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)", [id, tenantId, input.candidateId, input.investigationId ?? null, policy.id, result.score, result.confidence, result.coverage, result.freshness, Number(conflict.rows[0].count), result.decisionSupportStatus, result.reasonCodes, sha256({ policy: policy.id, evidence: evidenceResult.rows.map(v => v.id).sort(), contradictions: Number(conflict.rows[0].count) }), expiresAt, userId]);
    for (const factor of result.factors) await pool.query("INSERT INTO investigation_score_factors (assessment_id, evidence_id, factor_code, direction, configured_weight, confidence, freshness, contribution, reason_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, factor.evidenceId, factor.factorCode, factor.direction, factor.configuredWeight, factor.confidence, factor.freshness, factor.contribution, factor.reasonCode]);
    if (result.decisionSupportStatus !== "decision_support_only") await pool.query("INSERT INTO intelligence_review_cases (id, tenant_id, candidate_id, investigation_id, assessment_id, review_type, priority, status, due_at, created_by) VALUES ($1,$2,$3,$4,$5,'score',$6,'open',$7,$8)", [randomUUID(), tenantId, input.candidateId, input.investigationId ?? null, id, Number(conflict.rows[0].count) > 0 ? "high" : "normal", new Date(Date.now() + 48 * 3_600_000), userId]);
    await appendAudit(tenantId, userId, "investigation_score_calculated", "score_assessment", id, { score: result.score, status: result.decisionSupportStatus, reasonCodes: result.reasonCodes }, input.candidateId);
    return { assessmentId: id, ...result, expiresAt, disclaimer: "Decision support only. It is not an automated employment, tenancy, credit, government, or law-enforcement decision." };
  }),
  reportConflict: protectedProcedure.input(z.object({ candidateId: z.number().int().positive(), leftEvidenceId: z.string().uuid(), rightEvidenceId: z.string().uuid(), factorCode: z.string().regex(FACTOR_CODE) })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx); await assertCandidateTenant(tenantId, input.candidateId); const id = randomUUID(); const pool = await poolOrFail();
    await pool.query("INSERT INTO intelligence_evidence_conflicts (id, tenant_id, candidate_id, left_evidence_id, right_evidence_id, factor_code, status) VALUES ($1,$2,$3,$4,$5,$6,'open') ON CONFLICT (left_evidence_id, right_evidence_id) DO NOTHING", [id, tenantId, input.candidateId, input.leftEvidenceId, input.rightEvidenceId, input.factorCode]);
    await appendAudit(tenantId, userId, "evidence_conflict_reported", "evidence_conflict", id, { factorCode: input.factorCode }, input.candidateId); return { id };
  }),
  requestHumanReview: protectedProcedure.input(z.object({ candidateId: z.number().int().positive(), assessmentId: z.string().uuid(), priority: z.enum(["low","normal","high","critical"]).default("normal"), reason: z.string().min(10).max(4000) })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx); await assertCandidateTenant(tenantId, input.candidateId); const id = randomUUID(); const pool = await poolOrFail();
    await pool.query("INSERT INTO intelligence_review_cases (id, tenant_id, candidate_id, assessment_id, review_type, priority, status, due_at, created_by) VALUES ($1,$2,$3,$4,'score',$5,'open',$6,$7)", [id, tenantId, input.candidateId, input.assessmentId, input.priority, new Date(Date.now() + (input.priority === 'critical' ? 4 : 48) * 3_600_000), userId]);
    await appendAudit(tenantId, userId, "human_review_requested", "review_case", id, { reason: input.reason, priority: input.priority }, input.candidateId); return { id, status: "open" as const };
  }),
  resolveHumanReview: adminProcedure.input(z.object({ reviewCaseId: z.string().uuid(), outcome: z.enum(["manual_review_required","decision_support_only","insufficient_evidence"]), rationale: z.string().min(20).max(4000) })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx); const pool = await poolOrFail(); const review = await pool.query("SELECT assessment_id, candidate_id, status FROM intelligence_review_cases WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [input.reviewCaseId, tenantId]);
    if (review.rowCount !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Review case was not found" }); if (review.rows[0].status === "resolved") return { resolved: true, idempotent: true };
    await pool.query("UPDATE intelligence_review_cases SET status='resolved', resolved_by=$1, resolved_at=now(), resolution_rationale=$2, updated_at=now() WHERE id=$3 AND tenant_id=$4", [userId, input.rationale, input.reviewCaseId, tenantId]);
    await pool.query("INSERT INTO intelligence_human_overrides (id, tenant_id, assessment_id, review_case_id, prior_status, overridden_status, rationale, approved_by) SELECT $1,$2,assessment_id,id,'manual_review_required',$3,$4,$5 FROM intelligence_review_cases WHERE id=$6", [randomUUID(), tenantId, input.outcome, input.rationale, userId, input.reviewCaseId]);
    await appendAudit(tenantId, userId, "human_review_resolved", "review_case", input.reviewCaseId, { outcome: input.outcome }, Number(review.rows[0].candidate_id)); return { resolved: true, idempotent: false };
  }),
  registerMonitoring: adminProcedure.input(z.object({ candidateId: z.number().int().positive(), purposeCode: z.string().regex(FACTOR_CODE), consentRef: z.string().min(3).max(32).optional(), providerAuthorizationId: z.coerce.number().int().positive().optional(), expiresAt: z.date() })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx); await assertCandidateTenant(tenantId, input.candidateId); if (input.expiresAt <= new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Monitoring expiry must be in the future" });
    const requestedActivation = Boolean(input.consentRef && input.providerAuthorizationId); const id = randomUUID(); const pool = await poolOrFail();
    let active = false;
    if (requestedActivation) {
      const binding = await pool.query("SELECT 1 FROM candidate_consents c JOIN data_provider_authorizations p ON p.id = $2 WHERE c.\"consentRef\" = $1 AND c.\"candidateId\" = $3 AND c.\"tenantId\" = $4 AND p.status = 'active' AND p.effective_at <= now() AND p.expires_at > now() AND (p.tenant_id = $4 OR p.tenant_id IS NULL)", [input.consentRef, input.providerAuthorizationId, input.candidateId, tenantId]);
      if (binding.rowCount !== 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Active candidate consent and tenant-authorized provider approval are required for monitoring" });
      active = true;
    }
    await pool.query("INSERT INTO intelligence_monitoring_registrations (id, tenant_id, candidate_id, purpose_code, provider_authorization_id, consent_ref, status, next_review_at, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, tenantId, input.candidateId, input.purposeCode, input.providerAuthorizationId ?? null, input.consentRef ?? null, active ? "active" : "disabled_pending_provider_authorization", active ? new Date(Date.now() + 24 * 3_600_000) : null, input.expiresAt, userId]);
    await appendAudit(tenantId, userId, "monitoring_registered", "monitoring_registration", id, { active }, input.candidateId); return { id, status: active ? "active" as const : "disabled_pending_provider_authorization" as const };
  }),
  recordFraudSignal: adminProcedure.input(z.object({ candidateId: z.number().int().positive(), investigationId: z.number().int().positive().optional(), signalType: z.enum(["identity_inconsistency","document_reuse","evidence_checksum_mismatch","velocity_anomaly","unusual_access","provider_response_anomaly"]), severity: z.enum(["low","medium","high","critical"]), evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/) })).mutation(async ({ input, ctx }) => {
    const { tenantId, userId } = requireTenant(ctx); await assertCandidateTenant(tenantId, input.candidateId); const id = randomUUID(); const pool = await poolOrFail();
    await pool.query("INSERT INTO intelligence_fraud_signals (id, tenant_id, candidate_id, investigation_id, signal_type, severity, evidence_sha256, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'open') ON CONFLICT (tenant_id,candidate_id,signal_type,evidence_sha256) DO NOTHING", [id, tenantId, input.candidateId, input.investigationId ?? null, input.signalType, input.severity, input.evidenceSha256]);
    await appendAudit(tenantId, userId, "fraud_signal_recorded", "fraud_signal", id, { signalType: input.signalType, severity: input.severity }, input.candidateId); return { id };
  }),
});
