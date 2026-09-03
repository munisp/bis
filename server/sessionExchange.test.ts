import { describe, expect, it } from "vitest";
import { ENV } from "./_core/env";

const hasKeycloakIntegrationConfig = Boolean(
  ENV.keycloakUrl && ENV.keycloakRealm && ENV.keycloakClientId && ENV.keycloakClientSecret,
);

describe("Session Exchange — Keycloak Configuration", () => {
  it("does not embed Keycloak endpoint, realm, or client defaults", () => {
    expect(ENV.keycloakUrl).not.toContain("keycloak:8080");
    expect(ENV.keycloakRealm).not.toBe("bis-platform");
    expect(ENV.keycloakClientId).not.toBe("bis-platform");
  });
});

describe.runIf(hasKeycloakIntegrationConfig)("Session Exchange — Keycloak Integration", () => {
  it("publishes a valid OIDC discovery document", async () => {
    const discoveryUrl = `${ENV.keycloakUrl}/realms/${ENV.keycloakRealm}/.well-known/openid-configuration`;
    const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5_000) });
    expect(response.status).toBe(200);
    const discovery = await response.json() as Record<string, unknown>;
    expect(discovery.issuer).toContain(ENV.keycloakRealm);
    expect(discovery.token_endpoint).toBeTruthy();
    expect(discovery.jwks_uri).toBeTruthy();
  });
});
