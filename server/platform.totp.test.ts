import { describe, expect, it } from "vitest";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, hashTotpBackupCode, isEncryptedTotpSecret } from "./platform";

describe("TOTP enrollment secrets", () => {
  it("generates a complete RFC 4648 Base32 secret for a 20-byte authenticator seed", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("does not reuse authenticator secrets", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });

  it("creates a user-scoped one-way verifier for backup codes", () => {
    const rawCode = "A1B2C3D4";
    expect(hashTotpBackupCode(10, rawCode)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashTotpBackupCode(10, rawCode)).not.toBe(rawCode);
    expect(hashTotpBackupCode(10, rawCode)).not.toBe(hashTotpBackupCode(11, rawCode));
  });

  it("encrypts TOTP seeds at rest and recovers the exact seed only with the runtime key", () => {
    const seed = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    const encrypted = encryptTotpSecret(seed);
    expect(isEncryptedTotpSecret(encrypted)).toBe(true);
    expect(encrypted).not.toContain(seed);
    expect(decryptTotpSecret(encrypted)).toBe(seed);
    expect(isEncryptedTotpSecret(seed)).toBe(false);
  });
});
