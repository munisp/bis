import { describe, expect, it } from "vitest";
import { getCronTokenCandidate } from "./sdk";

function unsignedToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}

describe("Heartbeat cron token routing", () => {
  it("identifies a platform cron token as an exchange-only candidate", () => {
    const token = unsignedToken({ openId: "cron_force_credit_expiry", taskUid: "task-123" });
    expect(getCronTokenCandidate(token)).toBe("cron_force_credit_expiry");
  });

  it("does not classify normal, malformed, or missing tokens as cron candidates", () => {
    expect(getCronTokenCandidate(unsignedToken({ openId: "user-123" }))).toBeNull();
    expect(getCronTokenCandidate("not-a-jwt")).toBeNull();
    expect(getCronTokenCandidate(undefined)).toBeNull();
  });
});
