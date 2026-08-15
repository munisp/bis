import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORCE_CREDIT_DUAL_APPROVAL_THRESHOLD_KOBO,
  getForceCreditDualApprovalThresholdKobo,
  requiresForceCreditDualApproval,
} from "./forceCreditPolicy";

describe("Force Credit dual-approval policy", () => {
  it("uses the conservative default when no valid configuration exists", () => {
    expect(getForceCreditDualApprovalThresholdKobo(undefined)).toBe(DEFAULT_FORCE_CREDIT_DUAL_APPROVAL_THRESHOLD_KOBO);
    expect(getForceCreditDualApprovalThresholdKobo("not-a-number")).toBe(DEFAULT_FORCE_CREDIT_DUAL_APPROVAL_THRESHOLD_KOBO);
    expect(getForceCreditDualApprovalThresholdKobo("0")).toBe(DEFAULT_FORCE_CREDIT_DUAL_APPROVAL_THRESHOLD_KOBO);
  });

  it("requires approval at and above the configured kobo threshold", () => {
    const threshold = 5_000_000;
    expect(requiresForceCreditDualApproval(threshold - 1, threshold)).toBe(false);
    expect(requiresForceCreditDualApproval(threshold, threshold)).toBe(true);
    expect(requiresForceCreditDualApproval(threshold + 1, threshold)).toBe(true);
  });

  it("fails safely for non-integer amounts", () => {
    expect(requiresForceCreditDualApproval(1.5, 1)).toBe(false);
  });
});
