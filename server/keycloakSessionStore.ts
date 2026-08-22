import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { keycloakAuthTransactions, keycloakOnboardingDrafts, keycloakRefreshSessions } from "../drizzle/schema";
import { getDb } from "./db";
import { resolveSessionSigningSecret } from "./_core/env";

const PKCE_TTL_MS = 10 * 60_000;
const LEASE_TTL_MS = 30_000;

function key() {
  const secret = resolveSessionSigningSecret();
  if (!secret) throw new Error("Session signing secret is required");
  return createHash("sha256").update(`bis-keycloak-store:v1:${secret}`).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decrypt(value: string) {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("Malformed encrypted Keycloak material");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function createPkceMaterial() {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(64).toString("base64url");
  return { state, nonce, codeVerifier, codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url") };
}

export async function createPkceTransaction(input: { state: string; nonce: string; codeVerifier: string; redirectUri: string; returnTo: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(keycloakAuthTransactions).values({ ...input, codeVerifierEncrypted: encrypt(input.codeVerifier), expiresAt: new Date(Date.now() + PKCE_TTL_MS) });
}

export async function consumePkceTransaction(state: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db.update(keycloakAuthTransactions).set({ consumedAt: new Date() })
    .where(and(eq(keycloakAuthTransactions.state, state), isNull(keycloakAuthTransactions.consumedAt), gt(keycloakAuthTransactions.expiresAt, new Date())))
    .returning();
  return row ? { ...row, codeVerifier: decrypt(row.codeVerifierEncrypted) } : null;
}

export async function createRefreshFamily(input: { userId: number; refreshToken: string; expiresAt: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const familyId = randomUUID();
  await db.insert(keycloakRefreshSessions).values({ familyId, userId: input.userId, refreshTokenEncrypted: encrypt(input.refreshToken), expiresAt: input.expiresAt });
  return familyId;
}

export async function acquireRefreshLease(familyId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  const leaseId = randomUUID();
  const [row] = await db.update(keycloakRefreshSessions).set({ leaseId, leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS), updatedAt: now })
    .where(and(eq(keycloakRefreshSessions.familyId, familyId), isNull(keycloakRefreshSessions.revokedAt), gt(keycloakRefreshSessions.expiresAt, now), or(isNull(keycloakRefreshSessions.leaseExpiresAt), lt(keycloakRefreshSessions.leaseExpiresAt, now))))
    .returning();
  return row ? { leaseId, userId: row.userId, refreshToken: decrypt(row.refreshTokenEncrypted) } : null;
}

export async function rotateRefreshFamily(input: { familyId: string; leaseId: string; refreshToken: string; expiresAt: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db.update(keycloakRefreshSessions).set({ refreshTokenEncrypted: encrypt(input.refreshToken), expiresAt: input.expiresAt, generation: sql`${keycloakRefreshSessions.generation} + 1`, leaseId: null, leaseExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(keycloakRefreshSessions.familyId, input.familyId), eq(keycloakRefreshSessions.leaseId, input.leaseId), isNull(keycloakRefreshSessions.revokedAt))).returning();
  return row ?? null;
}

export async function revokeRefreshFamily(familyId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(keycloakRefreshSessions).set({ revokedAt: new Date(), leaseId: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(keycloakRefreshSessions.familyId, familyId));
}

export async function createOnboardingDraft(payload: unknown) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const id = randomUUID();
  await db.insert(keycloakOnboardingDrafts).values({ id, payloadEncrypted: encrypt(JSON.stringify(payload)), expiresAt: new Date(Date.now() + PKCE_TTL_MS) });
  return id;
}

export async function claimOnboardingDraft(id: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db.update(keycloakOnboardingDrafts).set({ claimedByUserId: userId, claimedAt: new Date() })
    .where(and(eq(keycloakOnboardingDrafts.id, id), isNull(keycloakOnboardingDrafts.claimedByUserId), isNull(keycloakOnboardingDrafts.consumedAt), gt(keycloakOnboardingDrafts.expiresAt, new Date()))).returning();
  return Boolean(row);
}

export async function consumeOnboardingDraft(id: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db.update(keycloakOnboardingDrafts).set({ consumedAt: new Date() })
    .where(and(eq(keycloakOnboardingDrafts.id, id), eq(keycloakOnboardingDrafts.claimedByUserId, userId), isNull(keycloakOnboardingDrafts.consumedAt), gt(keycloakOnboardingDrafts.expiresAt, new Date()))).returning();
  return row ? JSON.parse(decrypt(row.payloadEncrypted)) : null;
}
