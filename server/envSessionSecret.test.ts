import { describe, expect, it } from "vitest";
import { resolveSessionSigningSecret, resolveSessionSigningSource } from "./_core/env";

describe("production session-signing secret resolution", () => {
  it("prioritizes an explicitly configured dedicated session secret", () => {
    const source = {
      BIS_SESSION_SIGNING_SECRET: "dedicated-session-secret-that-is-long-enough-for-production",
      BUILT_IN_FORGE_API_KEY: "forge-credential-that-must-not-win",
      JWT_SECRET: "legacy-jwt-secret",
    };

    expect(resolveSessionSigningSource(source)).toBe(source.BIS_SESSION_SIGNING_SECRET);
    expect(resolveSessionSigningSecret(source)).toBe(source.BIS_SESSION_SIGNING_SECRET);
  });

  it("derives a purpose-separated fixed-length root from the platform Forge credential", () => {
    const source = { BUILT_IN_FORGE_API_KEY: "platform-forge-credential-value" };
    const derived = resolveSessionSigningSecret(source);

    expect(resolveSessionSigningSource(source)).toBe(source.BUILT_IN_FORGE_API_KEY);
    expect(derived).toMatch(/^[a-f0-9]{64}$/);
    expect(derived).not.toBe(source.BUILT_IN_FORGE_API_KEY);
    expect(derived).toBe(resolveSessionSigningSecret(source));
  });

  it("changes the derived root when the platform credential changes", () => {
    const first = resolveSessionSigningSecret({ BUILT_IN_FORGE_API_KEY: "platform-credential-one" });
    const second = resolveSessionSigningSecret({ BUILT_IN_FORGE_API_KEY: "platform-credential-two" });
    expect(first).not.toBe(second);
  });

  it("uses JWT only when no dedicated or platform credential source exists", () => {
    const source = { JWT_SECRET: "legacy-session-secret" };
    expect(resolveSessionSigningSource(source)).toBe(source.JWT_SECRET);
    expect(resolveSessionSigningSecret(source)).toBe(source.JWT_SECRET);
  });
});
