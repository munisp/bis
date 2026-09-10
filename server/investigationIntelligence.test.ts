import { describe, expect, it } from "vitest";
import { calculateEvidenceScore } from "./investigationIntelligence";

const policy = {
  baseScore: 50,
  minimumCoverage: 0.7,
  minimumConfidence: 0.6,
  maxEvidenceAgeDays: 365,
  factors: [
    { code: "identity_consistency", weight: 30, required: true },
    { code: "verified_employment", weight: 20, required: true },
    { code: "document_integrity", weight: 20, required: false },
  ],
};
const now = new Date("2026-09-04T12:00:00.000Z");
const evidence = (overrides: Partial<{ id: string; factor_code: string; assertion_direction: number; confidence: number; observed_at: Date; expires_at: Date; provenance_status: string }> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  factor_code: "identity_consistency",
  assertion_direction: 1,
  confidence: 0.95,
  observed_at: new Date("2026-09-03T12:00:00.000Z"),
  expires_at: new Date("2026-12-03T12:00:00.000Z"),
  provenance_status: "independently_confirmed",
  ...overrides,
});

describe("evidence-grounded scoring", () => {
  it("is explainable, bounded, and marked as decision support only when coverage and confidence are adequate", () => {
    const result = calculateEvidenceScore(policy, [
      evidence(),
      evidence({ id: "22222222-2222-4222-8222-222222222222", factor_code: "verified_employment", confidence: 0.9 }),
      evidence({ id: "33333333-3333-4333-8333-333333333333", factor_code: "document_integrity", confidence: 0.85 }),
    ], 0, now);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.decisionSupportStatus).toBe("decision_support_only");
    expect(result.factors).toHaveLength(3);
    expect(result.reasonCodes).toEqual([]);
  });

  it("fails to decision support when required evidence is absent", () => {
    const result = calculateEvidenceScore(policy, [evidence()], 0, now);
    expect(result.decisionSupportStatus).toBe("insufficient_evidence");
    expect(result.reasonCodes).toContain("MISSING_REQUIRED_VERIFIED_EMPLOYMENT");
    expect(result.reasonCodes).toContain("INSUFFICIENT_EVIDENCE_COVERAGE");
  });

  it("discounts stale evidence rather than treating it as current", () => {
    const result = calculateEvidenceScore(policy, [
      evidence({ expires_at: new Date("2026-09-04T12:00:01.000Z"), observed_at: new Date("2025-09-04T12:00:00.000Z") }),
      evidence({ id: "22222222-2222-4222-8222-222222222222", factor_code: "verified_employment", expires_at: new Date("2026-09-04T12:00:01.000Z"), observed_at: new Date("2025-09-04T12:00:00.000Z") }),
    ], 0, now);
    expect(result.freshness).toBeLessThan(0.01);
    expect(result.reasonCodes).toContain("EVIDENCE_FRESHNESS_DEGRADED");
  });

  it("requires human review whenever unresolved contradictory evidence exists", () => {
    const result = calculateEvidenceScore(policy, [
      evidence(),
      evidence({ id: "22222222-2222-4222-8222-222222222222", factor_code: "verified_employment" }),
    ], 1, now);
    expect(result.decisionSupportStatus).toBe("manual_review_required");
    expect(result.reasonCodes).toContain("UNRESOLVED_EVIDENCE_CONTRADICTION");
  });

  it("does not score withdrawn or contradicted evidence", () => {
    const result = calculateEvidenceScore(policy, [
      evidence({ provenance_status: "withdrawn" }),
      evidence({ id: "22222222-2222-4222-8222-222222222222", factor_code: "verified_employment", provenance_status: "contradicted" }),
    ], 0, now);
    expect(result.coverage).toBe(0);
    expect(result.decisionSupportStatus).toBe("insufficient_evidence");
  });
});

// Policy validation is exercised through its tRPC procedure. This pure-function
// suite deliberately verifies no protected/sensitive input can increase a score.
describe("scoring policy prohibited factors", () => {
  it("does not accept an evidence factor that is not in the approved policy", () => {
    const result = calculateEvidenceScore(policy, [evidence({ factor_code: "biometric" })], 0, now);
    expect(result.factors).toHaveLength(0);
    expect(result.decisionSupportStatus).toBe("insufficient_evidence");
  });
});
