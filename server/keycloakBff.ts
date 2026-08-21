import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { COOKIE_NAME, SESSION_MAX_AGE_MS } from "@shared/const";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import { createPkceMaterial, createPkceTransaction, createRefreshFamily, consumePkceTransaction } from "./keycloakSessionStore";
import { exchangeCodeWithPkce, extractRoles, getKeycloakAuthorizationUrl, mapRole, verifyKeycloakIdToken } from "./keycloak";

const TX_COOKIE = "bis_kc_tx";
export const REFRESH_FAMILY_COOKIE = "bis_kc_refresh_family";

function readCookie(req: Request, name: string) {
  const found = (req.headers.cookie ?? "").split(";").map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function safeReturnTo(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

function callbackUrl() {
  const origin = ENV.keycloakPublicOrigin || (!ENV.isProduction ? `http://localhost:${ENV.port}` : "");
  return origin ? `${origin.replace(/\/$/, "")}/api/auth/keycloak/callback` : null;
}

async function issueSession(req: Request, res: Response, input: { sub: string; name: string; email?: string; role: "admin" | "user"; refreshToken: string; refreshExpiresIn?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const openId = `kc:${input.sub}`;
  await db.insert(users).values({ openId, name: input.name, email: input.email ?? null, role: input.role, loginMethod: "keycloak", lastSignedIn: new Date() })
    .onConflictDoUpdate({ target: users.openId, set: { name: input.name, email: input.email ?? null, role: input.role, lastSignedIn: new Date(), updatedAt: new Date() } });
  const [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (!user) throw new Error("Keycloak user upsert failed");
  const refreshTtlMs = Math.max(60, input.refreshExpiresIn ?? 86_400) * 1000;
  const familyId = await createRefreshFamily({ userId: user.id, refreshToken: input.refreshToken, expiresAt: new Date(Date.now() + refreshTtlMs) });
  const token = await sdk.createSessionToken(openId, { name: input.name, expiresInMs: SESSION_MAX_AGE_MS });
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_MAX_AGE_MS });
  res.cookie(REFRESH_FAMILY_COOKIE, familyId, { ...cookieOptions, maxAge: refreshTtlMs });
}

export function registerKeycloakBffRoutes(app: Express) {
  app.get("/api/auth/keycloak/begin", async (req, res) => {
    const redirectUri = callbackUrl();
    if (!redirectUri) return res.status(503).json({ error: "KEYCLOAK_PUBLIC_ORIGIN is required in production" });
    const material = createPkceMaterial();
    try {
      await createPkceTransaction({ ...material, redirectUri, returnTo: safeReturnTo(req.query.returnTo) });
      const url = getKeycloakAuthorizationUrl({ redirectUri, state: material.state, nonce: material.nonce, codeChallenge: material.codeChallenge });
      if (!url) return res.status(503).json({ error: "Keycloak is not configured" });
      res.cookie(TX_COOKIE, material.state, { ...getSessionCookieOptions(req), maxAge: 10 * 60_000 });
      return res.redirect(303, url);
    } catch {
      return res.status(503).json({ error: "Unable to create secure Keycloak transaction" });
    }
  });

  app.get("/api/auth/keycloak/callback", async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!state || !code || readCookie(req, TX_COOKIE) !== state) return res.status(401).json({ error: "Invalid Keycloak callback transaction" });
    const transaction = await consumePkceTransaction(state);
    if (!transaction) return res.status(401).json({ error: "Expired or replayed Keycloak callback transaction" });
    const tokens = await exchangeCodeWithPkce({ code, redirectUri: transaction.redirectUri, codeVerifier: transaction.codeVerifier });
    if (!tokens) return res.status(401).json({ error: "Keycloak code exchange failed" });
    const claims = await verifyKeycloakIdToken(tokens.id_token, transaction.nonce);
    if (!claims) return res.status(401).json({ error: "Keycloak ID token nonce validation failed" });
    try {
      await issueSession(req, res, { sub: claims.sub, name: claims.name ?? claims.preferred_username ?? claims.sub, email: claims.email, role: mapRole(extractRoles(claims)), refreshToken: tokens.refresh_token, refreshExpiresIn: tokens.refresh_expires_in });
      res.clearCookie(TX_COOKIE, getSessionCookieOptions(req));
      return res.redirect(303, transaction.returnTo);
    } catch {
      return res.status(503).json({ error: "Unable to persist Keycloak session" });
    }
  });
}
