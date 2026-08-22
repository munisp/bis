import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { __billingInternals, assertBillingTenantAccess, assertVerifiedTopupBinding } from "./billing";

describe("billing flow-of-funds invariants", () => {
  it("derives one stable 128-bit ledger transfer identifier per provider reference", () => {
    const first = __billingInternals.deterministicTopupTransferId("PAYSTACK-REF-1001");
    const retry = __billingInternals.deterministicTopupTransferId("PAYSTACK-REF-1001");
    const different = __billingInternals.deterministicTopupTransferId("PAYSTACK-REF-1002");

    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(retry).toBe(first);
    expect(different).not.toBe(first);
  });

  it("rejects a provider response whose reference is not the requested reference", () => {
    expect(() => assertVerifiedTopupBinding({
      expectedReference: "PAY-EXPECTED",
      expectedTenantId: "tenant-a",
      verifiedReference: "PAY-OTHER",
      verifiedTenantId: "tenant-a",
    })).toThrow(TRPCError);
  });

  it("rejects a successful payment response that is not bound to the caller tenant", () => {
    expect(() => assertVerifiedTopupBinding({
      expectedReference: "PAY-EXPECTED",
      expectedTenantId: "tenant-a",
      verifiedReference: "PAY-EXPECTED",
      verifiedTenantId: "tenant-b",
    })).toThrow(TRPCError);
  });

  it("accepts an exact reference and tenant binding", () => {
    expect(() => assertVerifiedTopupBinding({
      expectedReference: "PAY-EXPECTED",
      expectedTenantId: "tenant-a",
      verifiedReference: "PAY-EXPECTED",
      verifiedTenantId: "tenant-a",
    })).not.toThrow();
  });

  it("denies cross-tenant billing access for tenant-scoped users while retaining explicit platform-admin scope", () => {
    expect(() => assertBillingTenantAccess(12, "13")).toThrow(TRPCError);
    expect(() => assertBillingTenantAccess(12, "12")).not.toThrow();
    expect(() => assertBillingTenantAccess(null, "13")).not.toThrow();
  });
});
