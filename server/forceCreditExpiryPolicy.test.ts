import { describe, expect, it } from "vitest";
import { FORCE_CREDIT_APPROVAL_TTL_MS, getForceCreditApprovalExpiry, isForceCreditApprovalExpired } from "./forceCreditExpiryPolicy";

describe("Force Credit approval expiry policy", () => {
  it("sets a fixed 24-hour deadline from the request timestamp", () => {
    const requestedAt = new Date("2026-08-14T12:00:00.000Z");
    expect(getForceCreditApprovalExpiry(requestedAt).getTime()).toBe(requestedAt.getTime() + FORCE_CREDIT_APPROVAL_TTL_MS);
  });

  it("fails closed exactly at and after the durable expiration timestamp", () => {
    const expiry = new Date("2026-08-15T12:00:00.000Z");
    expect(isForceCreditApprovalExpired(expiry, new Date("2026-08-15T11:59:59.999Z"))).toBe(false);
    expect(isForceCreditApprovalExpired(expiry, expiry)).toBe(true);
    expect(isForceCreditApprovalExpired(expiry, new Date("2026-08-15T12:00:00.001Z"))).toBe(true);
  });
});
