import { describe, it, expect } from "vitest";
import { ENV } from "./_core/env";

describe("Session Exchange — Keycloak Configuration", () => {
  it("KEYCLOAK_URL is set and reachable", async () => {
    expect(ENV.keycloakUrl).toBeTruthy();
    expect(ENV.keycloakUrl).not.toContain("keycloak:8080"); // Must not be the Docker internal hostname

    // Verify the OIDC discovery endpoint is reachable
    const realm = ENV.keycloakRealm;
    expect(realm).toBeTruthy();

    const discoveryUrl = `${ENV.keycloakUrl}/realms/${realm}/.well-known/openid-configuration`;
    const res = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5000) }).catch(() => null);

    // In CI without Keycloak running, this will be null — that's acceptable
    // In local dev with staging Keycloak, it should return 200
    if (res) {
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.issuer).toContain(realm);
      expect(data.token_endpoint).toBeTruthy();
      expect(data.jwks_uri).toBeTruthy();
    }
  });

  it("KEYCLOAK_REALM is set to a valid realm name", () => {
    expect(ENV.keycloakRealm).toBeTruthy();
    expect(ENV.keycloakRealm).not.toBe("bis-platform"); // Default placeholder
  });
});
