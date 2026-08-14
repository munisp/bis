import { describe, expect, it } from "vitest";
import { generateTotpSecret } from "./platform";

describe("TOTP enrollment secrets", () => {
  it("generates a complete RFC 4648 Base32 secret for a 20-byte authenticator seed", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("does not reuse authenticator secrets", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});
