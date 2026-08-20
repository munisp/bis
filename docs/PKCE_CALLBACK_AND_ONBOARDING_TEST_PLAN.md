# PKCE Callback Handler and Onboarding Resilience Test Plan

**Author:** Manus AI  
**Status:** Implementation reference. The code below is designed for the current BIS Express, Drizzle, Keycloak, and session-cookie architecture; it is not yet applied to the repository.

## Security Model and Design Decisions

The callback must not reuse `GET /api/oauth/callback`. That route is wired to the Manus SDK, whereas the Keycloak authorization response must be redeemed at the Keycloak token endpoint. The recommended model is a **server-owned authorization-code flow with S256 PKCE**, short-lived single-use database transactions, and a normal BIS HttpOnly session cookie after validation.

RFC 7636 requires a unique high-entropy verifier for each authorization request and specifies the `S256` challenge as the SHA-256 hash of that verifier in unpadded base64url form. [1] The OpenID Connect ID token must be verified for issuer, audience, expiry, and nonce before it is trusted as an authentication result. [2]

| Requirement | Implementation decision |
|---|---|
| Authorization-code interception | S256 PKCE; retain the verifier only in server-side encrypted transaction data. |
| Login CSRF and callback mix-up | Pair a raw `state` parameter with a hash in PostgreSQL and a browser-bound signed transaction cookie. |
| OIDC replay | Mark the transaction consumed atomically before token exchange; use `FOR UPDATE` to prevent parallel redemption. |
| Token confidentiality | The browser receives only the existing BIS HttpOnly session cookie; it never sees access or refresh tokens. |
| Return navigation | Allow only relative, allow-listed application paths; reject absolute URLs, protocol-relative paths, and unknown routes. |
| Interrupted onboarding | Associate a short-lived draft record with the opaque OIDC transaction, then atomically attach it to the authenticated user after callback. |

## Required Database Migration

Create a Drizzle migration and table such as `keycloak_oidc_transactions`. It prevents the callback from storing a PKCE verifier or `state` in browser-visible storage and supports one-time use.

```ts
// drizzle/schema.ts — abbreviated shape
export const keycloakOidcTransactions = pgTable("keycloak_oidc_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  stateHash: varchar("state_hash", { length: 64 }).notNull().unique(),
  nonceHash: varchar("nonce_hash", { length: 64 }).notNull(),
  verifierCiphertext: text("verifier_ciphertext").notNull(),
  verifierIv: varchar("verifier_iv", { length: 24 }).notNull(),
  verifierAuthTag: varchar("verifier_auth_tag", { length: 32 }).notNull(),
  returnTo: varchar("return_to", { length: 256 }).notNull(),
  onboardingDraftId: uuid("onboarding_draft_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("keycloak_oidc_transactions_expires_idx").on(table.expiresAt),
]);
```

The `onboarding_draft_id` must reference an **opaque, short-lived, PostgreSQL-backed draft**. Do not place personal details, uploaded document data, or application fields in the OIDC state parameter, query string, or client storage.

## Exact Server Implementation

### 1. OIDC transaction utility

Add `server/auth/keycloakOidcTransaction.ts`. This example uses the existing purpose-separated encryption approach conceptually used by the TOTP implementation. Replace `encryptForPurpose` and `decryptForPurpose` with the project’s existing AES-256-GCM helper or extract that helper into a common server-only module.

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TXN_TTL_MS = 10 * 60_000;
const OIDC_TXN_COOKIE = "bis_kc_txn";
const OIDC_TXN_PURPOSE = "keycloak-oidc-pkce:v1";

export function base64url(bytes: Buffer) {
  return bytes.toString("base64url");
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createVerifier() {
  // 64 bytes becomes an 86-character RFC 7636 unreserved/base64url verifier.
  return base64url(randomBytes(64));
}

export function createChallenge(verifier: string) {
  return base64url(createHash("sha256").update(verifier, "ascii").digest());
}

export function createOpaqueValue() {
  return base64url(randomBytes(32));
}

export function constantTimeHashMatch(actual: string, expectedHash: string) {
  const actualHash = Buffer.from(sha256Hex(actual), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actualHash.length === expected.length && timingSafeEqual(actualHash, expected);
}

export function normalizeReturnTo(candidate: unknown): string {
  if (typeof candidate !== "string") return "/onboarding";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/onboarding";
  if (!["/onboarding", "/stakeholder-portal", "/dashboard", "/settings"].some(
    path => candidate === path || candidate.startsWith(`${path}/`)
  )) return "/onboarding";
  return candidate;
}

export const oidcTransactionCookie = {
  name: OIDC_TXN_COOKIE,
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: true,
    path: "/api/auth/keycloak",
    maxAge: TXN_TTL_MS,
  },
};
```

The transaction cookie contains only the random database transaction ID. It is not a bearer credential and contains neither the verifier nor tokens. In local HTTP development, calculate `secure` from the request/proxy protocol in the same manner as `getSessionCookieOptions()`; production must always use HTTPS. [3]

### 2. Factor local Keycloak session issuance

Extract the repeated role mapping, user upsert, and `sdk.createSessionToken()` behavior currently embedded in `server/_core/sessionExchange.ts`.

```ts
// server/auth/issueKeycloakSession.ts
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { getDb } from "../db";
import { COOKIE_NAME, SESSION_MAX_AGE_MS } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import { extractRoles, mapRole, type KeycloakClaims } from "../keycloak";

export async function issueKeycloakSession(req: Request, res: Response, claims: KeycloakClaims) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const openId = `kc:${claims.sub}`;
  const name = claims.name ?? claims.preferred_username ?? claims.sub;
  const role = mapRole(extractRoles(claims));

  await db.insert(users).values({
    openId, name, email: claims.email ?? null, loginMethod: "keycloak", role, lastSignedIn: new Date(),
  }).onConflictDoUpdate({
    target: users.openId,
    set: { name, email: claims.email ?? null, role, lastSignedIn: new Date(), updatedAt: new Date() },
  });

  const [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (!user) throw new Error("Keycloak user upsert failed");

  const session = await sdk.createSessionToken(openId, { name, expiresInMs: SESSION_MAX_AGE_MS });
  res.cookie(COOKIE_NAME, session, { ...getSessionCookieOptions(req), maxAge: SESSION_MAX_AGE_MS });
  return user;
}
```

Use this helper from the new callback, the existing bearer-token exchange endpoint, and the server-side refresh path. This makes one cookie policy and one role mapping authoritative.

### 3. Add the Keycloak login and callback routes

Create `server/_core/keycloakCallback.ts` and register it in `server/_core/index.ts`:

```ts
// server/_core/index.ts
import { registerKeycloakCallbackRoutes } from "./keycloakCallback";
// after JSON body parsing and before serving routes
registerKeycloakCallbackRoutes(app);
```

The following handler shows the full callback control flow. `verifyIdToken()` must use `jose.jwtVerify` with Keycloak’s cached JWKS, exact issuer, and the client ID as audience; it must return ID-token claims. The existing `verifyKeycloakToken()` is appropriate for access-token verification and role extraction.

```ts
// server/_core/keycloakCallback.ts
import type { Express, Request, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { keycloakOidcTransactions } from "../../drizzle/schema";
import { ENV } from "./env";
import { exchangeCode, verifyKeycloakToken, verifyKeycloakIdToken } from "../keycloak";
import { issueKeycloakSession } from "../auth/issueKeycloakSession";
import { decryptForPurpose, encryptForPurpose } from "../auth/crypto";
import {
  createChallenge, createOpaqueValue, createVerifier, constantTimeHashMatch,
  normalizeReturnTo, oidcTransactionCookie, sha256Hex,
} from "../auth/keycloakOidcTransaction";

const CALLBACK_PATH = "/api/auth/keycloak/callback";

function publicOrigin(req: Request) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.get("host"));
  return `${forwardedProto}://${host}`;
}

export function registerKeycloakCallbackRoutes(app: Express) {
  app.get("/api/auth/keycloak/login", async (req, res) => {
    if (!ENV.keycloakUrl || !ENV.keycloakRealm || !ENV.keycloakClientId) {
      return res.status(503).send("Keycloak sign-in is not configured");
    }

    const db = await getDb();
    if (!db) return res.status(503).send("Database unavailable");

    const state = createOpaqueValue();
    const nonce = createOpaqueValue();
    const verifier = createVerifier();
    const callbackUrl = `${publicOrigin(req)}${CALLBACK_PATH}`;
    const returnTo = normalizeReturnTo(req.query.returnTo);

    const [transaction] = await db.insert(keycloakOidcTransactions).values({
      stateHash: sha256Hex(state),
      nonceHash: sha256Hex(nonce),
      ...encryptForPurpose(verifier, "keycloak-oidc-pkce:v1"),
      returnTo,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    }).returning({ id: keycloakOidcTransactions.id });

    res.cookie(oidcTransactionCookie.name, transaction.id, {
      ...oidcTransactionCookie.options,
      secure: publicOrigin(req).startsWith("https://"),
    });

    const authorizationUrl = new URL(
      `${ENV.keycloakUrl}/realms/${ENV.keycloakRealm}/protocol/openid-connect/auth`
    );
    authorizationUrl.search = new URLSearchParams({
      client_id: ENV.keycloakClientId,
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: "openid profile email roles offline_access",
      state,
      nonce,
      code_challenge: createChallenge(verifier),
      code_challenge_method: "S256",
    }).toString();

    return res.redirect(302, authorizationUrl.toString());
  });

  app.get(CALLBACK_PATH, async (req, res) => {
    // Keycloak error responses must not reveal the raw provider description to the UI or logs.
    if (typeof req.query.error === "string") {
      res.clearCookie(oidcTransactionCookie.name, oidcTransactionCookie.options);
      return res.redirect(302, "/login?error=keycloak_cancelled");
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const transactionId = req.cookies?.[oidcTransactionCookie.name];
    if (!code || !state || typeof transactionId !== "string") {
      return res.status(400).send("Invalid sign-in callback");
    }

    const db = await getDb();
    if (!db) return res.status(503).send("Database unavailable");

    // Claim the transaction exactly once before code redemption. A second callback fails closed.
    const transaction = await db.transaction(async tx => {
      const [row] = await tx.select().from(keycloakOidcTransactions)
        .where(and(
          eq(keycloakOidcTransactions.id, transactionId),
          eq(keycloakOidcTransactions.stateHash, sha256Hex(state)),
          isNull(keycloakOidcTransactions.consumedAt),
          gt(keycloakOidcTransactions.expiresAt, new Date()),
        ))
        .for("update");
      if (!row) return null;
      await tx.update(keycloakOidcTransactions)
        .set({ consumedAt: new Date() })
        .where(eq(keycloakOidcTransactions.id, row.id));
      return row;
    });

    res.clearCookie(oidcTransactionCookie.name, oidcTransactionCookie.options);
    if (!transaction) return res.status(400).send("Expired, invalid, or already-used sign-in transaction");

    try {
      const callbackUrl = `${publicOrigin(req)}${CALLBACK_PATH}`;
      const verifier = decryptForPurpose(transaction, "keycloak-oidc-pkce:v1");
      const tokens = await exchangeCode({ code, redirectUri: callbackUrl, codeVerifier: verifier });
      if (!tokens) return res.redirect(302, "/login?error=keycloak_token_exchange");

      const idClaims = await verifyKeycloakIdToken(tokens.id_token);
      const accessClaims = await verifyKeycloakToken(tokens.access_token);
      if (!idClaims || !accessClaims || idClaims.sub !== accessClaims.sub) {
        return res.redirect(302, "/login?error=keycloak_token_validation");
      }
      if (typeof idClaims.nonce !== "string" || !constantTimeHashMatch(idClaims.nonce, transaction.nonceHash)) {
        return res.redirect(302, "/login?error=keycloak_nonce");
      }

      const user = await issueKeycloakSession(req, res, accessClaims);
      if (tokens.refresh_token) {
        await storeEncryptedRefreshToken({ userId: user.id, subject: accessClaims.sub, refreshToken: tokens.refresh_token });
      }
      await attachOnboardingDraftToUser(transaction.onboardingDraftId, user.id);
      return res.redirect(302, transaction.returnTo);
    } catch (error) {
      console.error("[KeycloakCallback] callback failed", { message: error instanceof Error ? error.message : "unknown" });
      return res.redirect(302, "/login?error=keycloak_callback");
    }
  });
}
```

The Keycloak authorization endpoint, token endpoint, JWKS/certificate endpoint, and logout capabilities documented by Keycloak should be discovered from the realm’s well-known OpenID configuration where practical, rather than duplicated across the client. [3]

### 4. Change the frontend entry point

Replace the manual OIDC URL construction in `client/src/components/BISLayout.tsx` with a BFF-owned navigation:

```tsx
onClick={() => {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/api/auth/keycloak/login?returnTo=${encodeURIComponent(returnTo)}`);
}}
```

Create an in-app `/login` page for `AdminRoute` and public onboarding. It should use the same endpoint with a safe relative `returnTo`, rather than exposing any Keycloak token operation to React code.

### 5. Replace browser-provided refresh tokens

The existing `POST /api/auth/refresh` receives `{ refreshToken }` from the browser. Replace it with a cookie-authenticated endpoint that loads a server-encrypted refresh token by local user/session ID. The BFF must atomically replace the stored token when Keycloak rotates one, issue a new BIS session cookie, and revoke the local refresh record if Keycloak returns `invalid_grant`. This keeps tokens out of JavaScript and browser request bodies.

## Detailed Test Plan

### Unit Tests: Pure PKCE and Path Logic

| ID | Condition | Assertions |
|---|---|---|
| U-01 | Generate verifier | It is base64url-safe, 43–128 characters, unique for repeated invocations, and backed by cryptographic randomness. |
| U-02 | S256 challenge | The known RFC 7636 verifier vector produces the known challenge. [1] |
| U-03 | Return path accepted | `/onboarding`, `/onboarding?draft=x`, `/stakeholder-portal`, and allowed settings paths remain relative. |
| U-04 | Open redirects denied | `https://evil.example`, `//evil.example`, `javascript:`, encoded protocol-relative paths, and unknown routes all resolve to `/onboarding`. |
| U-05 | Constant-time state/nonce comparison | Equal input passes; unequal same-length and unequal-length values fail without throwing. |
| U-06 | Transaction-cookie policy | Cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/api/auth/keycloak`, short-lived, and `Secure` on HTTPS. |

### Route and Database Integration Tests

| ID | Scenario | Expected result |
|---|---|---|
| I-01 | Start login | One transaction row is written; state hash, nonce hash, encrypted verifier, callback URI, and relative return path are present; response is a Keycloak 302 with S256 and state. |
| I-02 | Missing `state` or code | Callback returns 400, creates no user or session, and clears the transaction cookie. |
| I-03 | State mismatch | Callback returns 400; transaction remains unusable; Keycloak token endpoint is not called. |
| I-04 | Missing browser transaction cookie | Callback fails even if `state` is valid, preventing a cross-browser callback mix-up. |
| I-05 | Expired transaction | Callback rejects it; no token call, user upsert, refresh record, or onboarding attachment. |
| I-06 | Replayed callback | Two concurrent callback requests with the same transaction yield exactly one token redemption and one local session. The other fails as already consumed. |
| I-07 | Keycloak `access_denied` | Transaction cookie is cleared and UI returns the sanitized cancellation error; raw provider description is neither returned nor logged. |
| I-08 | Keycloak `temporarily_unavailable` / `authentication_expired` | UI receives a retry-safe error page; transaction is not reused. A new login begins with a fresh state/verifier. [3] |
| I-09 | Token exchange timeout | No user is created; transaction remains consumed; callback returns a generic retry message. |
| I-10 | `invalid_grant` | No session is issued; transaction is consumed because authorization codes are one-time credentials. |
| I-11 | Expired ID token | ID-token validation rejects `exp`; no local user/session/refresh token is created. |
| I-12 | Future `nbf`, wrong `iss`, wrong `aud`, invalid `azp` | Each claim failure rejects the callback before local session issuance. |
| I-13 | Nonce mismatch | Valid signature and audience are insufficient; nonce mismatch rejects callback. |
| I-14 | Access/ID subject mismatch | Callback rejects token substitution when `id_token.sub !== access_token.sub`. |
| I-15 | JWKS rotation | Cached old key fails then cache refresh succeeds for a valid newly signed token; an unknown issuer/key still fails closed. |
| I-16 | Role mapping | `bis-admin` creates/updates an administrator; missing or unrelated roles create a normal user. |
| I-17 | Refresh rotation | A valid server-held refresh token is replaced encrypted at rest and new BIS cookie issued; the browser never receives the refresh token. |
| I-18 | Expired/revoked refresh token | Existing BIS session and refresh record are revoked; response is 401 and browser is directed to login on next protected request. |

### Interrupted Onboarding Tests

| ID | Interruption | Required outcome |
|---|---|---|
| O-01 | User starts stakeholder access request, then signs in | An opaque draft ID survives the redirect; draft fields are loaded only after the resulting local session identifies the same user. |
| O-02 | Browser closed before Keycloak callback | No user, session, or onboarding application is created. The transaction expires and cleanup removes it. |
| O-03 | Callback succeeds but browser closes before onboarding page loads | Local session and attached draft exist; returning user can resume the draft while it is within retention policy. |
| O-04 | Session expires on step 4 of 6 | Unsaved in-memory values are not claimed as persisted. The UI presents a clear sign-in-and-resume action; it reloads the server draft after successful callback. |
| O-05 | Refresh fails during document upload | Upload stops before mutation completion; UI retains only the selected file metadata locally, shows authentication recovery, and reauthorizes before retry. Do not upload a document under an anonymous or stale identity. |
| O-06 | User authenticates as a different Keycloak subject after interruption | Previous user’s draft cannot be read or attached; start a new draft or require explicit authorized transfer under audit. |
| O-07 | Two tabs resume the same draft | Optimistic version/updated-at check prevents silent overwrites; one tab receives a conflict and reload option. |
| O-08 | Callback replay attempts to attach same draft | Only the one claimed transaction may attach it. Subsequent callbacks fail prior to mutation. |
| O-09 | Draft expires before callback | Callback issues session but redirects to onboarding with a “draft expired; start again” message; no stale PII is restored. |
| O-10 | Approved/rejected application revisited | Server returns read-only application state; no new draft overwrites the completed application. |

### Browser and Staging Acceptance Tests

| ID | Flow | Acceptance criteria |
|---|---|---|
| B-01 | `/login?returnTo=/onboarding` | Native login screen renders provider controls and starts `/api/auth/keycloak/login`; no token reaches browser storage. |
| B-02 | Keycloak login to onboarding | Callback sets only BIS HttpOnly session and returns exactly to `/onboarding`; `trpc.auth.me` resolves the Keycloak user. |
| B-03 | Admin route | Unauthenticated `/admin/onboarding` redirects to `/login?returnTo=%2Fadmin%2Fonboarding`; ordinary Keycloak user reaches `/403`; `bis-admin` can enter. |
| B-04 | Refresh lifecycle | Near-expiry BIS session silently refreshes via cookie-authenticated BFF path; token rotation works; refresh rejection forces login. |
| B-05 | Logout | BIS cookie and encrypted refresh record are removed; browser back navigation cannot access protected tRPC content. |
| B-06 | Full onboarding | Authenticated user creates application, uploads document, resumes a draft once, submits, and administrator reviews. Database rows are correctly owner-bound. |

## Test File Layout

```text
server/auth/keycloakOidcTransaction.test.ts      # U-01 through U-06
server/_core/keycloakCallback.test.ts            # I-01 through I-16
server/_core/sessionRefresh.test.ts              # I-17 and I-18
server/onboardingDrafts.test.ts                  # O-01 through O-10
client/src/pages/LoginPage.test.tsx              # B-01 and admin redirects
client/src/pages/onboarding/*.test.tsx           # draft resume UI
e2e/keycloak-onboarding.spec.ts                  # B-02 through B-06 against staging
```

## Rollout Gate

Do not enable the new callback in production until all four conditions are true: the managed PostgreSQL database has the transaction/draft/refresh migrations, Keycloak has exact redirect and web-origin configuration, the fail-closed production environment has required secrets and database URL, and every integration plus staging acceptance case passes.

## References

[1] [RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients](https://www.rfc-editor.org/rfc/rfc7636)  
[2] [OpenID Connect Core 1.0, incorporating errata set 2](https://openid.net/specs/openid-connect-core-1_0.html)  
[3] [Keycloak: Securing applications and services with OpenID Connect](https://www.keycloak.org/securing-apps/oidc-layers)
