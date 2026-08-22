import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { COOKIE_NAME, SESSION_MAX_AGE_MS } from "@shared/const";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import { claimOnboardingDraft, consumeOnboardingDraft, createOnboardingDraft, createPkceMaterial, createPkceTransaction, createRefreshFamily, consumePkceTransaction } from "./keycloakSessionStore";
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
  return user;
}

function validDraftId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function appendDraftToReturnTo(returnTo: string, draftId: string) {
  const url = new URL(returnTo, "http://bis.local");
  url.searchParams.set("onboardingDraft", draftId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function registerKeycloakBffRoutes(app: Express) {
  app.post("/api/auth/onboarding-draft", async (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "A JSON onboarding payload is required" });
    }
    try {
      const id = await createOnboardingDraft(req.body);
      return res.status(201).json({ id });
    } catch {
      return res.status(503).json({ error: "Unable to persist onboarding draft" });
    }
  });

  app.get("/api/auth/keycloak/begin", async (req, res) => {
    const redirectUri = callbackUrl();
    if (!redirectUri) return res.status(503).json({ error: "KEYCLOAK_PUBLIC_ORIGIN is required in production" });
    const material = createPkceMaterial();
    try {
      const requestedReturnTo = safeReturnTo(req.query.returnTo);
      const draftId = validDraftId(req.query.onboardingDraft) ? req.query.onboardingDraft : null;
      await createPkceTransaction({ ...material, redirectUri, returnTo: draftId ? appendDraftToReturnTo(requestedReturnTo, draftId) : requestedReturnTo });
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
      const user = await issueSession(req, res, { sub: claims.sub, name: claims.name ?? claims.preferred_username ?? claims.sub, email: claims.email, role: mapRole(extractRoles(claims)), refreshToken: tokens.refresh_token, refreshExpiresIn: tokens.refresh_expires_in });
      const callbackReturnTo = new URL(transaction.returnTo, "http://bis.local");
      const draftId = callbackReturnTo.searchParams.get("onboardingDraft");
      if (draftId && !(await claimOnboardingDraft(draftId, user.id))) {
        return res.status(409).json({ error: "Onboarding draft is expired or already claimed" });
      }
      res.clearCookie(TX_COOKIE, getSessionCookieOptions(req));
      return res.redirect(303, transaction.returnTo);
    } catch {
      return res.status(503).json({ error: "Unable to persist Keycloak session" });
    }
  });

  app.get("/api/auth/onboarding-draft/:id", async (req, res) => {
    if (!validDraftId(req.params.id)) return res.status(400).json({ error: "Invalid onboarding draft" });
    const session = await sdk.verifySession(readCookie(req, COOKIE_NAME));
    if (!session) return res.status(401).json({ error: "Authentication is required" });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });
    const [user] = await db.select().from(users).where(eq(users.openId, session.openId)).limit(1);
    if (!user) return res.status(401).json({ error: "Authenticated user is unavailable" });
    try {
      const payload = await consumeOnboardingDraft(req.params.id, user.id);
      if (!payload) return res.status(404).json({ error: "Onboarding draft is expired, claimed by another user, or already resumed" });
      return res.json({ payload });
    } catch {
      return res.status(503).json({ error: "Unable to resume onboarding draft" });
    }
  });
}
