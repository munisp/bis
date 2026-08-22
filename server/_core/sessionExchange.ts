import type { Express, Request } from "express";
import { eq } from "drizzle-orm";
import { COOKIE_NAME, SESSION_MAX_AGE_MS } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { exchangeRefreshToken, extractRoles, mapRole, verifyKeycloakToken } from "../keycloak";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { acquireRefreshLease, revokeRefreshFamily, rotateRefreshFamily } from "../keycloakSessionStore";
import { REFRESH_FAMILY_COOKIE } from "../keycloakBff";

function readCookie(req: Request, name: string) {
  const found = (req.headers.cookie ?? "").split(";").map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

async function upsertKeycloakUser(claims: NonNullable<Awaited<ReturnType<typeof verifyKeycloakToken>>>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const openId = `kc:${claims.sub}`;
  const name = claims.name ?? claims.preferred_username ?? claims.sub;
  const role = mapRole(extractRoles(claims));
  await db.insert(users).values({ openId, name, email: claims.email ?? null, loginMethod: "keycloak", role, lastSignedIn: new Date() })
    .onConflictDoUpdate({ target: users.openId, set: { name, email: claims.email ?? null, role, lastSignedIn: new Date(), updatedAt: new Date() } });
  const [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (!user) throw new Error("Keycloak user upsert failed");
  return { user, openId, name };
}

export function registerSessionExchangeRoute(app: Express) {
  app.post("/api/auth/refresh", async (req, res) => {
    const familyId = readCookie(req, REFRESH_FAMILY_COOKIE);
    if (!familyId) return res.status(401).json({ error: "No BFF refresh session" });
    const lease = await acquireRefreshLease(familyId).catch(() => null);
    if (!lease) return res.status(409).json({ error: "Refresh is already in progress; retry shortly" });
    const tokens = await exchangeRefreshToken(lease.refreshToken).catch(() => null);
    if (!tokens) {
      await revokeRefreshFamily(familyId).catch(() => undefined);
      res.clearCookie(REFRESH_FAMILY_COOKIE, getSessionCookieOptions(req));
      return res.status(401).json({ error: "Refresh session expired or invalid" });
    }
    const claims = await verifyKeycloakToken(tokens.access_token);
    if (!claims) {
      await revokeRefreshFamily(familyId).catch(() => undefined);
      return res.status(401).json({ error: "Refreshed access token validation failed" });
    }
    try {
      const { openId, name } = await upsertKeycloakUser(claims);
      const rotated = await rotateRefreshFamily({ familyId, leaseId: lease.leaseId, refreshToken: tokens.refresh_token, expiresAt: new Date(Date.now() + Math.max(60, tokens.refresh_expires_in ?? 86_400) * 1000) });
      if (!rotated) return res.status(409).json({ error: "Refresh lease was lost; retry shortly" });
      const token = await sdk.createSessionToken(openId, { name, expiresInMs: SESSION_MAX_AGE_MS });
      res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: SESSION_MAX_AGE_MS });
      return res.status(200).json({ ok: true, expiresIn: SESSION_MAX_AGE_MS });
    } catch {
      return res.status(503).json({ error: "Unable to persist refreshed session" });
    }
  });

  app.post("/api/auth/exchange", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing Authorization: Bearer token" });
    const claims = await verifyKeycloakToken(authHeader.slice(7));
    if (!claims) return res.status(401).json({ error: "Invalid or expired Keycloak token" });
    try {
      const { user, openId, name } = await upsertKeycloakUser(claims);
      const token = await sdk.createSessionToken(openId, { name, expiresInMs: SESSION_MAX_AGE_MS });
      res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: SESSION_MAX_AGE_MS });
      return res.status(200).json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId }, expiresIn: SESSION_MAX_AGE_MS, authMethod: "keycloak" });
    } catch {
      return res.status(503).json({ error: "Unable to persist Keycloak session" });
    }
  });
}
