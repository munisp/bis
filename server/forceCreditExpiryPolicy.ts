export const FORCE_CREDIT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export function getForceCreditApprovalExpiry(requestedAt = new Date()): Date {
  return new Date(requestedAt.getTime() + FORCE_CREDIT_APPROVAL_TTL_MS);
}

export function isForceCreditApprovalExpired(expiresAt: Date | string, now = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}
