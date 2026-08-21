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
 * Returns claims on success, null if Keycloak is not configured or token is invalid.
 * Never throws — all errors are caught and logged.
 */
export async function verifyKeycloakToken(token: string): Promise<KeycloakClaims | null> {
  if (!jwks || !issuer) return null; // Keycloak not configured — skip
  try {
    const clientId = ENV.keycloakClientId;
    // Keycloak access tokens set aud="account" by default for confidential clients.
    // The authorized party (azp) contains the actual client ID.
    // First try strict audience check; if it fails on the aud claim specifically,
    // verify signature+issuer only and then manually validate azp.
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: clientId,
      }));
    } catch (audErr: any) {
      if (audErr?.code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && audErr?.claim === "aud") {
        // Retry without audience check, then validate azp manually
        ({ payload } = await jwtVerify(token, jwks, { issuer }));
        const azp = (payload as any).azp;
        if (azp !== clientId) {
          throw new Error(`unexpected "azp" claim value: ${azp}, expected ${clientId}`);
        }
      } else {
        throw audErr;
      }
    }
    return payload as KeycloakClaims;
  } catch (err) {
    // Invalid token, JWKS fetch failure, or signature mismatch — return null (fail-closed)
    console.warn("[Keycloak] Token verification failed:", (err as Error)?.message ?? err);
    return null;
  }
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

export function getKeycloakAuthorizationUrl(input: { redirectUri: string; state: string; nonce: string; codeChallenge: string }): string | null {
  const keycloakUrl = ENV.keycloakUrl;
  const realm = ENV.keycloakRealm;
  const clientId = ENV.keycloakClientId;
  if (!keycloakUrl || !realm || !clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: input.redirectUri, response_type: "code", response_mode: "query",
    scope: "openid profile email roles", state: input.state, nonce: input.nonce,
    code_challenge: input.codeChallenge, code_challenge_method: "S256",
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

export async function exchangeCodeWithPkce(input: { code: string; redirectUri: string; codeVerifier: string }) {
  const keycloakUrl = ENV.keycloakUrl;
  const realm = ENV.keycloakRealm;
  if (!keycloakUrl || !realm) return null;
  const body = new URLSearchParams({
    grant_type: "authorization_code", client_id: ENV.keycloakClientId,
    ...(ENV.keycloakClientSecret ? { client_secret: ENV.keycloakClientSecret } : {}),
    code: input.code, redirect_uri: input.redirectUri, code_verifier: input.codeVerifier,
  });
  try {
    const response = await fetch(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return response.json() as Promise<{ access_token: string; id_token: string; refresh_token: string; refresh_expires_in?: number }>;
  } catch {
    return null;
  }
}

export async function exchangeRefreshToken(refreshToken: string) {
  const keycloakUrl = ENV.keycloakUrl;
  const realm = ENV.keycloakRealm;
  if (!keycloakUrl || !realm) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token", client_id: ENV.keycloakClientId,
    ...(ENV.keycloakClientSecret ? { client_secret: ENV.keycloakClientSecret } : {}), refresh_token: refreshToken,
  });
  try {
    const response = await fetch(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return response.json() as Promise<{ access_token: string; refresh_token: string; refresh_expires_in?: number }>;
  } catch {
    return null;
  }
}

export async function verifyKeycloakIdToken(idToken: string, nonce: string): Promise<KeycloakClaims | null> {
  if (!jwks || !issuer) return null;
  try {
    const { payload } = await jwtVerify(idToken, jwks, { issuer, audience: ENV.keycloakClientId });
    return payload.nonce === nonce ? payload as KeycloakClaims : null;
  } catch {
    return null;
  }
}

// ── Keycloak Sync Logging ─────────────────────────────────────────────────────
// Writes Keycloak sync operations to the keycloak_sync_log table for audit.
export async function logKeycloakSync(opts: {
  keycloakId?: string;
  bisUserId?: number;
  operation: "provision" | "update_roles" | "deactivate" | "login" | "token_exchange";
  status: "success" | "failed";
  detail?: Record<string, unknown>;
  errorMessage?: string;
}): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const { keycloakSyncLog } = await import("../drizzle/schema");
    const db = await getDb();
    if (!db) return;
    await db.insert(keycloakSyncLog).values({
      keycloakId: opts.keycloakId ?? null,
      bisUserId: opts.bisUserId ?? null,
      operation: opts.operation,
      status: opts.status,
      detail: opts.detail ?? null,
      errorMessage: opts.errorMessage ?? null,
    });
  } catch (e) {
    console.warn("[Keycloak] Failed to write sync log:", e);
  }
}
