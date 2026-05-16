/**
 * BIS — Keycloak OIDC integration
 *
 * When KEYCLOAK_URL + KEYCLOAK_REALM are set, this module validates Bearer tokens
 * issued by Keycloak and maps them to BIS user records.
 *
 * When those env vars are absent (dev / Manus-hosted), the module is a no-op and
 * the existing Manus OAuth flow continues to work unchanged.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ENV } from "./_core/env";

export interface KeycloakClaims extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let issuer: string | null = null;

function init() {
  const keycloakUrl = ENV.keycloakUrl;
  const realm = ENV.keycloakRealm;
  if (!keycloakUrl || !realm) {
    return; // dev mode — Keycloak disabled
  }
  issuer = `${keycloakUrl}/realms/${realm}`;
  const jwksUri = `${issuer}/protocol/openid-connect/certs`;
  jwks = createRemoteJWKSet(new URL(jwksUri));
  console.log(`[Keycloak] OIDC provider configured → ${issuer}`);
}

init();

/**
 * Verify a Keycloak Bearer token.
 * Returns claims on success, null if Keycloak is not configured, throws on invalid token.
 */
export async function verifyKeycloakToken(token: string): Promise<KeycloakClaims | null> {
  if (!jwks || !issuer) return null; // Keycloak not configured — skip

  const clientId = ENV.keycloakClientId;
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: clientId,
  });
  return payload as KeycloakClaims;
}

/**
 * Extract roles from Keycloak claims.
 * Merges realm roles and client-specific roles.
 */
export function extractRoles(claims: KeycloakClaims): string[] {
  const clientId = ENV.keycloakClientId;
  const realmRoles = claims.realm_access?.roles ?? [];
  const clientRoles = claims.resource_access?.[clientId]?.roles ?? [];
  return Array.from(new Set([...realmRoles, ...clientRoles]));
}

/**
 * Map Keycloak roles to BIS user roles.
 * Keycloak "bis-admin" → BIS "admin", everything else → "user".
 */
export function mapRole(roles: string[]): "admin" | "user" {
  if (roles.includes("bis-admin") || roles.includes("admin")) return "admin";
  return "user";
}

/**
 * Build the Keycloak login URL for frontend redirect.
 * Returns null when Keycloak is not configured.
 */
export function getKeycloakLoginUrl(redirectUri: string): string | null {
  const keycloakUrl = ENV.keycloakUrl;
  const realm = ENV.keycloakRealm;
  const clientId = ENV.keycloakClientId;
  if (!keycloakUrl || !realm) return null;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email roles",
  });
  return `${keycloakUrl}/realms/${realm}/protocol/openid-connect/auth?${params}`;
}

/**
 * Exchange an authorization code for tokens (PKCE / confidential client).
 */
export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; id_token: string; refresh_token: string } | null> {
  const keycloakUrl = ENV.keycloakUrl;
  const realm = ENV.keycloakRealm;
  const clientId = ENV.keycloakClientId;
  const clientSecret = ENV.keycloakClientSecret;
  if (!keycloakUrl || !realm) return null;

  const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    code,
    redirect_uri: redirectUri,
  });

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    // SECURITY: do not log the full response body as it may contain tokens/error details
    console.error(`[Keycloak] Token exchange failed: HTTP ${resp.status}`);
    return null;
  }
  return resp.json() as Promise<{ access_token: string; id_token: string; refresh_token: string }>;
}
