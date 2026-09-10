import { describe, expect, it } from "vitest";
import { checkoutFailureOutcome } from "./piiRotationWorker";

describe("checkoutFailureOutcome", () => {
  it.each([
    [new Error("timeout exceeded when trying to connect"), "node-postgres checkout timeout"],
    [new Error("Connection timed out"), "case-insensitive timeout"],
    [new Error("operation TIMED OUT"), "spaced timeout"],
  ])("classifies %s as a bounded checkout timeout", (error) => {
    expect(checkoutFailureOutcome(error)).toBe("checkout_timeout");
  });

  it.each([
    [new Error("ECONNREFUSED"), "connection refused"],
    [new Error("remaining connection slots are reserved"), "PostgreSQL capacity error"],
    [new Error("authentication failed"), "authentication error"],
    ["timeout", "non-Error input"],
  ])("does not misclassify %s as a checkout timeout", (error) => {
    expect(checkoutFailureOutcome(error)).toBe("checkout_failed");
  });
});
