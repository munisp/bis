import { describe, expect, it } from "vitest";
import { getCronTokenCandidate, hasAuthoritativeCronTask } from "./sdk";

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

  it("requires the OAuth-authoritative cron identity and task UID before allowing scheduled work", () => {
    expect(hasAuthoritativeCronTask({ openId: "cron_force_credit_expiry", taskUid: "task-123" } as any)).toBe(true);
    expect(hasAuthoritativeCronTask({ openId: "user-123", taskUid: "task-123" } as any)).toBe(false);
    expect(hasAuthoritativeCronTask({ openId: "cron_force_credit_expiry", taskUid: undefined } as any)).toBe(false);
  });
});
