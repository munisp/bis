/**
 * Four-eyes control policy for manual payment recovery.
 *
 * The threshold is configured in kobo to avoid floating-point currency math.
 * The conservative default is ₦50,000 (5,000,000 kobo).
 */
export const DEFAULT_FORCE_CREDIT_DUAL_APPROVAL_THRESHOLD_KOBO = 5_000_000;

export function getForceCreditDualApprovalThresholdKobo(value = process.env.FORCE_CREDIT_DUAL_APPROVAL_THRESHOLD_KOBO): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_FORCE_CREDIT_DUAL_APPROVAL_THRESHOLD_KOBO;
}

export function requiresForceCreditDualApproval(amountKobo: number, thresholdKobo = getForceCreditDualApprovalThresholdKobo()): boolean {
  return Number.isSafeInteger(amountKobo) && amountKobo >= thresholdKobo;
}
