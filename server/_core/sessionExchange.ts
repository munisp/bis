/**
 * Session Exchange Endpoint
 * ==========================
 * POST /api/auth/exchange
 *
 * Accepts a Keycloak Bearer token in the Authorization header, validates it
 * against the Keycloak JWKS, upserts the user in the local database, creates
 * a session token, and sets the session cookie. After this call, the client
 * can use the cookie for all subsequent tRPC requests without needing to pass
 * the Bearer token again.
 *
 * Request:
 *   Authorization: Bearer <keycloak-jwt>
 *
 * Response (200):
 *   Set-Cookie: app_session_id=<session-token>; HttpOnly; Path=/; ...
 *   { "ok": true, "user": { "id", "name", "email", "role" } }
 *
 * Response (401):
 *   { "error": "Invalid or expired Keycloak token" }
 */

import type { Express, Request, Response } from "express";
import { COOKIE_NAME, SESSION_MAX_AGE_MS } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { verifyKeycloakToken, extractRoles, mapRole } from "../keycloak";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export function registerSessionExchangeRoute(app: Express) {
  /**
   * POST /api/auth/refresh
   *
   * Accepts a Keycloak refresh token in the request body, exchanges it for a new
   * access token via the Keycloak token endpoint, validates the new token, and
   * issues a fresh session cookie. This allows clients to extend their session
   * without requiring re-authentication.
   *
   * Request body:
   *   { "refreshToken": "<keycloak-refresh-token>" }
   *
   * Response (200):
   *   Set-Cookie: app_session_id=<new-session-token>; HttpOnly; Path=/; ...
   *   { "ok": true, "expiresIn": 86400000 }
   *
   * Response (401):
   *   { "error": "Refresh token expired or invalid" }
   */
  app.post("/api/auth/refresh", async (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body ?? {};
      if (!refreshToken || typeof refreshToken !== "string") {
        res.status(400).json({ error: "Missing refreshToken in request body" });
        return;
      }

      const { ENV } = await import("./env");
      const keycloakUrl = ENV.keycloakUrl;
      const realm = ENV.keycloakRealm;
      const clientId = ENV.keycloakClientId;
      const clientSecret = ENV.keycloakClientSecret;

      if (!keycloakUrl || !realm) {
        res.status(503).json({ error: "Keycloak not configured" });
        return;
      }

      // Exchange refresh token for new access token
      const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        refresh_token: refreshToken,
      });

      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text().catch(() => "");
        console.warn("[SessionRefresh] Keycloak refresh failed:", tokenRes.status, errBody.slice(0, 200));
        res.status(401).json({ error: "Refresh token expired or invalid" });
        return;
      }

      const tokens = await tokenRes.json() as { access_token: string; refresh_token?: string };

      // Validate the new access token
      let claims;
      try {
        claims = await verifyKeycloakToken(tokens.access_token);
      } catch {
        res.status(401).json({ error: "New access token failed validation" });
        return;
      }
      if (!claims) {
        res.status(401).json({ error: "Token verification returned null" });
        return;
      }

      // Upsert user and issue new session cookie
      const roles = extractRoles(claims);
      const bisRole = mapRole(roles);
      const openId = `kc:${claims.sub}`;
      const name = claims.name ?? claims.preferred_username ?? claims.sub ?? "Keycloak User";

      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      // Update last sign-in
      await db
        .insert(users)
        .values({ openId, name, email: claims.email ?? null, loginMethod: "keycloak", role: bisRole, lastSignedIn: new Date() })
        .onConflictDoUpdate({ target: users.openId, set: { lastSignedIn: new Date(), updatedAt: new Date() } });

      const sessionToken = await sdk.createSessionToken(openId, {
        name,
        expiresInMs: SESSION_MAX_AGE_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: SESSION_MAX_AGE_MS });

      res.status(200).json({
        ok: true,
        expiresIn: SESSION_MAX_AGE_MS,
        // Return the new refresh token if Keycloak issued one (rotation)
        ...(tokens.refresh_token ? { newRefreshToken: tokens.refresh_token } : {}),
      });
    } catch (e: any) {
      console.error("[SessionRefresh] Unexpected error:", e);
      res.status(500).json({ error: "Session refresh failed" });
    }
  });

  app.post("/api/auth/exchange", async (req: Request, res: Response) => {
    try {
      // 1. Extract Bearer token
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing Authorization: Bearer <token> header" });
        return;
      }

      const token = authHeader.slice(7);

      // 2. Validate against Keycloak JWKS
      let claims;
      try {
        claims = await verifyKeycloakToken(token);
      } catch (e: any) {
        console.error("[SessionExchange] Token verification failed:", e.message);
        res.status(401).json({ error: "Invalid or expired Keycloak token" });
        return;
      }

      if (!claims) {
        res.status(503).json({ error: "Keycloak not configured — cannot verify token" });
        return;
      }

      // 3. Upsert user in local database
      const roles = extractRoles(claims);
      const bisRole = mapRole(roles);
      const openId = `kc:${claims.sub}`;
      const name = claims.name ?? claims.preferred_username ?? claims.sub ?? "Keycloak User";
      const email = claims.email ?? null;

      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      await db
        .insert(users)
        .values({
          openId,
          name,
          email,
          loginMethod: "keycloak",
          role: bisRole,
          lastSignedIn: new Date(),
        })
        .onConflictDoUpdate({
          target: users.openId,
          set: {
            name,
            email,
            role: bisRole,
            lastSignedIn: new Date(),
            updatedAt: new Date(),
          },
        });

      const [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
      if (!user) {
        res.status(500).json({ error: "User upsert failed" });
        return;
      }

      // 4. Create session token and set cookie
      const sessionToken = await sdk.createSessionToken(openId, {
        name: name,
        expiresInMs: SESSION_MAX_AGE_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: SESSION_MAX_AGE_MS });

      // 5. Return user info
      res.status(200).json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId,
        },
        expiresIn: SESSION_MAX_AGE_MS,
        authMethod: "keycloak",
      });
    } catch (e: any) {
      console.error("[SessionExchange] Unexpected error:", e);
      res.status(500).json({ error: "Session exchange failed" });
    }
  });
}
