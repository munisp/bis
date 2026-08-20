# Vitest PKCE Callback Tests and React Keycloak Entry Components

**Author:** Manus AI  
**Purpose:** This reference supplies implementation-ready examples for the server-owned PKCE flow described in `PKCE_CALLBACK_AND_ONBOARDING_TEST_PLAN.md`. It is deliberately designed so that **React never receives an authorization code, code verifier, access token, or refresh token**.

## Architecture Boundary

The browser starts sign-in with `GET /api/auth/keycloak/login`. The BFF creates `state`, `nonce`, and the PKCE verifier, writes a short-lived database transaction, then redirects to Keycloak. Keycloak returns to `GET /api/auth/keycloak/callback`; the BFF validates and redeems the code, sets the BIS HttpOnly session cookie, and redirects the browser to `/onboarding` or another allow-listed application path.

> The frontend must not parse or redeem `code` or `state`. Its “handling” of the Keycloak return is to render the already-authenticated destination after the BFF redirects with the session cookie.

RFC 7636 specifies that each authorization request has a high-entropy verifier and that `S256` derives the challenge by applying SHA-256 and unpadded base64url encoding. [1] OpenID Connect requires the relying party to validate the ID token’s issuer, audience, expiry, and nonce before treating it as an authentication result. [2]

| Layer | Owns | Must never receive |
|---|---|---|
| React | Login intent, relative return path, authenticated UI state | PKCE verifier, authorization code, access token, refresh token |
| BFF | PKCE transaction, token exchange, ID-token validation, BIS session cookie | Browser-supplied `code_verifier` or refresh token |
| PostgreSQL | Hashed state/nonce, encrypted verifier, single-use status, onboarding-draft association | Plain access or refresh token unless encrypted at rest under a purpose-specific key |
| Keycloak | User authentication, authorization code, OIDC tokens | Application session cookie secret |

## Testability Refactor: Inject Callback Dependencies

The first implementation reference used a callback handler with direct database imports. For route testing, make the small dependency boundary below. Production wiring passes Drizzle/Keycloak functions; Vitest passes deterministic doubles.

```ts
// server/auth/keycloakCallbackHandler.ts
import type { Request, Response } from "express";
import { normalizeReturnTo, oidcTransactionCookie } from "./keycloakOidcTransaction";

export type OidcTransaction = {
  id: string;
  returnTo: string;
  nonceHash: string;
  verifier: string;               // Decrypted only inside the BFF implementation.
  onboardingDraftId: string | null;
};

export type TokenSet = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
};

export type CallbackClaims = {
  sub: string;
  nonce?: string;
  email?: string;
  preferred_username?: string;
  realm_access?: { roles?: string[] };
};

export type KeycloakCallbackDeps = {
  claimTransaction(input: { id: string; state: string; now: Date }): Promise<OidcTransaction | null>;
  exchangeCode(input: { code: string; verifier: string; redirectUri: string }): Promise<TokenSet>;
  verifyIdToken(token: string): Promise<CallbackClaims>;
  verifyAccessToken(token: string): Promise<CallbackClaims>;
  nonceMatches(input: { nonce: string; nonceHash: string }): boolean;
  issueSession(req: Request, res: Response, claims: CallbackClaims): Promise<{ id: string }>;
  storeRefreshToken(input: { userId: string; subject: string; refreshToken: string }): Promise<void>;
  attachOnboardingDraft(input: { draftId: string | null; userId: string }): Promise<void>;
  publicCallbackUrl(req: Request): string;
  now(): Date;
  logError(error: unknown): void;
};

export function createKeycloakCallbackHandler(deps: KeycloakCallbackDeps) {
  return async (req: Request, res: Response) => {
    const providerError = typeof req.query.error === "string" ? req.query.error : null;
    if (providerError) {
      res.clearCookie(oidcTransactionCookie.name, oidcTransactionCookie.options);
      return res.redirect(302, "/login?error=keycloak_cancelled");
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const transactionId = req.cookies?.[oidcTransactionCookie.name];
    if (!code || !state || typeof transactionId !== "string") {
      return res.status(400).send("Invalid sign-in callback");
    }

    // The production implementation runs SELECT … FOR UPDATE plus consumedAt update
    // in one database transaction. Null means missing, expired, state-mismatched, or used.
    const transaction = await deps.claimTransaction({ id: transactionId, state, now: deps.now() });
    res.clearCookie(oidcTransactionCookie.name, oidcTransactionCookie.options);
    if (!transaction) return res.status(400).send("Expired, invalid, or already-used sign-in transaction");

    try {
      const tokens = await deps.exchangeCode({
        code,
        verifier: transaction.verifier,
        redirectUri: deps.publicCallbackUrl(req),
      });
      const idClaims = await deps.verifyIdToken(tokens.id_token);
      const accessClaims = await deps.verifyAccessToken(tokens.access_token);

      if (idClaims.sub !== accessClaims.sub) {
        return res.redirect(302, "/login?error=keycloak_token_validation");
      }
      if (!idClaims.nonce || !deps.nonceMatches({ nonce: idClaims.nonce, nonceHash: transaction.nonceHash })) {
        return res.redirect(302, "/login?error=keycloak_nonce");
      }

      const user = await deps.issueSession(req, res, accessClaims);
      if (tokens.refresh_token) {
        await deps.storeRefreshToken({ userId: user.id, subject: accessClaims.sub, refreshToken: tokens.refresh_token });
      }
      await deps.attachOnboardingDraft({ draftId: transaction.onboardingDraftId, userId: user.id });
      return res.redirect(302, normalizeReturnTo(transaction.returnTo));
    } catch (error) {
      deps.logError(error);
      return res.redirect(302, "/login?error=keycloak_callback");
    }
  };
}
```

The production `claimTransaction()` implementation must perform an atomic row lock and set `consumedAt` before token exchange. A serializable or row-locking transaction ensures that two requests carrying the same authorization code cannot both issue local sessions.

## Vitest Setup

Install route-test dependencies once:

```bash
pnpm add -D supertest @types/supertest
```

Create an Express app factory used only by tests. The production route registration still uses the same handler.

```ts
// server/auth/keycloakCallbackTestApp.ts
import express from "express";
import cookieParser from "cookie-parser";
import { createKeycloakCallbackHandler, type KeycloakCallbackDeps } from "./keycloakCallbackHandler";

export function makeCallbackTestApp(deps: KeycloakCallbackDeps) {
  const app = express();
  app.use(cookieParser());
  app.get("/api/auth/keycloak/callback", createKeycloakCallbackHandler(deps));
  return app;
}
```

### Callback Route Tests

```ts
// server/auth/keycloakCallback.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { makeCallbackTestApp } from "./keycloakCallbackTestApp";
import type { KeycloakCallbackDeps, OidcTransaction } from "./keycloakCallbackHandler";

const tx: OidcTransaction = {
  id: "tx-1",
  returnTo: "/onboarding",
  nonceHash: "stored-nonce-hash",
  verifier: "server-only-pkce-verifier",
  onboardingDraftId: "draft-1",
};

function makeDeps(overrides: Partial<KeycloakCallbackDeps> = {}): KeycloakCallbackDeps {
  return {
    claimTransaction: vi.fn().mockResolvedValue(tx),
    exchangeCode: vi.fn().mockResolvedValue({
      access_token: "access.jwt", id_token: "id.jwt", refresh_token: "refresh.secret",
    }),
    verifyIdToken: vi.fn().mockResolvedValue({ sub: "kc-user-1", nonce: "raw-nonce" }),
    verifyAccessToken: vi.fn().mockResolvedValue({ sub: "kc-user-1", realm_access: { roles: ["bis-user"] } }),
    nonceMatches: vi.fn().mockReturnValue(true),
    issueSession: vi.fn().mockResolvedValue({ id: "local-user-1" }),
    storeRefreshToken: vi.fn().mockResolvedValue(undefined),
    attachOnboardingDraft: vi.fn().mockResolvedValue(undefined),
    publicCallbackUrl: vi.fn().mockReturnValue("https://bis.example/api/auth/keycloak/callback"),
    now: vi.fn(() => new Date("2026-08-18T00:00:00.000Z")),
    logError: vi.fn(),
    ...overrides,
  };
}

describe("GET /api/auth/keycloak/callback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redeems a valid one-time callback, issues a BIS session, stores refresh token, and resumes onboarding", async () => {
    const deps = makeDeps();
    const app = makeCallbackTestApp(deps);

    const response = await request(app)
      .get("/api/auth/keycloak/callback?code=auth-code&state=raw-state")
      .set("Cookie", "bis_kc_txn=tx-1");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/onboarding");
    expect(deps.claimTransaction).toHaveBeenCalledWith({ id: "tx-1", state: "raw-state", now: expect.any(Date) });
    expect(deps.exchangeCode).toHaveBeenCalledWith({
      code: "auth-code",
      verifier: "server-only-pkce-verifier",
      redirectUri: "https://bis.example/api/auth/keycloak/callback",
    });
    expect(deps.issueSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ sub: "kc-user-1" }));
    expect(deps.storeRefreshToken).toHaveBeenCalledWith({
      userId: "local-user-1", subject: "kc-user-1", refreshToken: "refresh.secret",
    });
    expect(deps.attachOnboardingDraft).toHaveBeenCalledWith({ draftId: "draft-1", userId: "local-user-1" });
    expect(response.headers["set-cookie"].join(";")).toContain("bis_kc_txn=;");
  });

  it("fails before token exchange for an expired or already-consumed transaction", async () => {
    const deps = makeDeps({ claimTransaction: vi.fn().mockResolvedValue(null) });
    const response = await request(makeCallbackTestApp(deps))
      .get("/api/auth/keycloak/callback?code=auth-code&state=old-state")
      .set("Cookie", "bis_kc_txn=expired-tx");

    expect(response.status).toBe(400);
    expect(response.text).toBe("Expired, invalid, or already-used sign-in transaction");
    expect(deps.exchangeCode).not.toHaveBeenCalled();
    expect(deps.issueSession).not.toHaveBeenCalled();
  });

  it("fails closed when a valid code produces an expired ID token", async () => {
    const expired = Object.assign(new Error("JWT expired"), { code: "ERR_JWT_EXPIRED" });
    const deps = makeDeps({ verifyIdToken: vi.fn().mockRejectedValue(expired) });

    const response = await request(makeCallbackTestApp(deps))
      .get("/api/auth/keycloak/callback?code=auth-code&state=raw-state")
      .set("Cookie", "bis_kc_txn=tx-1");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/login?error=keycloak_callback");
    expect(deps.issueSession).not.toHaveBeenCalled();
    expect(deps.storeRefreshToken).not.toHaveBeenCalled();
    expect(deps.attachOnboardingDraft).not.toHaveBeenCalled();
    expect(deps.logError).toHaveBeenCalledWith(expired);
  });

  it("rejects nonce substitution even when both tokens are otherwise valid", async () => {
    const deps = makeDeps({ nonceMatches: vi.fn().mockReturnValue(false) });
    const response = await request(makeCallbackTestApp(deps))
      .get("/api/auth/keycloak/callback?code=auth-code&state=raw-state")
      .set("Cookie", "bis_kc_txn=tx-1");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/login?error=keycloak_nonce");
    expect(deps.issueSession).not.toHaveBeenCalled();
    expect(deps.storeRefreshToken).not.toHaveBeenCalled();
  });

  it("allows exactly one of two callback attempts to claim the same transaction", async () => {
    const claimTransaction = vi.fn()
      .mockResolvedValueOnce(tx)
      .mockResolvedValueOnce(null);
    const deps = makeDeps({ claimTransaction });
    const app = makeCallbackTestApp(deps);

    const [first, replay] = await Promise.all([
      request(app).get("/api/auth/keycloak/callback?code=auth-code&state=raw-state").set("Cookie", "bis_kc_txn=tx-1"),
      request(app).get("/api/auth/keycloak/callback?code=auth-code&state=raw-state").set("Cookie", "bis_kc_txn=tx-1"),
    ]);

    expect([first.status, replay.status].sort()).toEqual([302, 400]);
    expect(deps.exchangeCode).toHaveBeenCalledTimes(1);
    expect(deps.issueSession).toHaveBeenCalledTimes(1);
  });

  it("does not reveal provider errors and starts a fresh login after authentication cancellation", async () => {
    const deps = makeDeps();
    const response = await request(makeCallbackTestApp(deps))
      .get("/api/auth/keycloak/callback?error=access_denied&error_description=internal-details")
      .set("Cookie", "bis_kc_txn=tx-1");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/login?error=keycloak_cancelled");
    expect(response.text).not.toContain("internal-details");
    expect(deps.claimTransaction).not.toHaveBeenCalled();
  });
});
```

### Pure PKCE Tests

```ts
// server/auth/keycloakOidcTransaction.test.ts
import { describe, expect, it } from "vitest";
import { createChallenge, createVerifier, normalizeReturnTo } from "./keycloakOidcTransaction";

describe("PKCE transaction helpers", () => {
  it("creates an RFC 7636-compliant verifier and S256 challenge", () => {
    const verifier = createVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);

    // RFC 7636 Appendix B test vector.
    expect(createChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("admits only relative allow-listed callback destinations", () => {
    expect(normalizeReturnTo("/onboarding?draft=abc")).toBe("/onboarding?draft=abc");
    expect(normalizeReturnTo("/dashboard/investigations")).toBe("/dashboard/investigations");
    for (const unsafe of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/%2F%2Fevil.example"]) {
      expect(normalizeReturnTo(unsafe)).toBe("/onboarding");
    }
  });
});
```

### Token Expiration Tests With Real Signed JWTs

The callback mock above proves control flow. Add this lower-level test to verify that `verifyKeycloakIdToken()` rejects an expired token instead of trusting a decoded payload.

```ts
// server/keycloak.idToken.test.ts
import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { verifyKeycloakIdToken } from "./keycloak";

const issuer = "https://keycloak.example/realms/bis";
const audience = "bis-bff";
let privateKey: CryptoKey;
let jwk: Record<string, unknown>;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  jwk = { ...(await exportJWK(keys.publicKey)), kid: "test-key", use: "sig", alg: "RS256" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })));
});

async function signIdToken(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("kc-user-1")
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(privateKey);
}

describe("verifyKeycloakIdToken", () => {
  it("accepts a signed, unexpired token with the expected issuer and audience", async () => {
    const token = await signIdToken({ nonce: "expected-nonce" });
    await expect(verifyKeycloakIdToken(token)).resolves.toMatchObject({ sub: "kc-user-1", nonce: "expected-nonce" });
  });

  it("rejects an expired token even if its signature is valid", async () => {
    const expired = await new SignJWT({ nonce: "expected-nonce" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer).setAudience(audience).setSubject("kc-user-1")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(privateKey);

    await expect(verifyKeycloakIdToken(expired)).rejects.toMatchObject({ code: "ERR_JWT_EXPIRED" });
  });

  it("rejects a token issued to another audience", async () => {
    const wrongAudience = await new SignJWT({ nonce: "expected-nonce" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer).setAudience("other-client").setSubject("kc-user-1")
      .setIssuedAt().setExpirationTime("2m").sign(privateKey);

    await expect(verifyKeycloakIdToken(wrongAudience)).rejects.toBeDefined();
  });
});
```

## React: Start Login Without Handling Tokens

### Reusable hook

```tsx
// client/src/hooks/useKeycloakLogin.ts
import { useCallback } from "react";

function currentRelativeLocation() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function useKeycloakLogin() {
  return useCallback((requestedReturnTo?: string) => {
    const returnTo = requestedReturnTo ?? currentRelativeLocation();
    // The BFF validates this value again. React never makes PKCE values.
    window.location.assign(`/api/auth/keycloak/login?returnTo=${encodeURIComponent(returnTo)}`);
  }, []);
}
```

### Sign-in page

```tsx
// client/src/pages/LoginPage.tsx
import { useMemo } from "react";
import { useLocation } from "wouter";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKeycloakLogin } from "@/hooks/useKeycloakLogin";

function sanitizedReturnTo(search: string) {
  const candidate = new URLSearchParams(search).get("returnTo");
  return candidate?.startsWith("/") && !candidate.startsWith("//") ? candidate : "/onboarding";
}

export default function LoginPage() {
  const [, navigate] = useLocation();
  const login = useKeycloakLogin();
  const returnTo = useMemo(() => sanitizedReturnTo(window.location.search), []);
  const error = useMemo(() => new URLSearchParams(window.location.search).get("error"), []);

  return (
    <main className="min-h-screen bg-background text-foreground grid place-items-center p-6">
      <section className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <ShieldCheck className="mb-5 h-10 w-10 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">Sign in to BIS</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Continue through your organization’s secure identity provider.
        </p>
        {error && (
          <p role="alert" className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error === "keycloak_cancelled"
              ? "Sign-in was cancelled. You can try again."
              : "Sign-in could not be completed. Start a new sign-in request."}
          </p>
        )}
        <Button className="mt-6 w-full" onClick={() => login(returnTo)}>
          Continue with Keycloak SSO
        </Button>
        <Button variant="ghost" className="mt-2 w-full" onClick={() => navigate("/")}>
          Return to home
        </Button>
      </section>
    </main>
  );
}
```

### Protected onboarding entry after BFF redirect

The Keycloak callback does **not** mount a React callback page. It redirects to `/onboarding`, where a small gate checks the resulting BIS cookie-backed session and either renders the wizard or returns to the login page.

```tsx
// client/src/pages/onboarding/OnboardingEntry.tsx
import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import StakeholderOnboardingWizard from "./StakeholderOnboardingWizard";

export default function OnboardingEntry() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login?returnTo=%2Fonboarding", { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><Loader2 className="animate-spin" /></main>;
  }
  if (!user) return null;
  return <StakeholderOnboardingWizard initialIdentity={{ email: user.email ?? "", name: user.name ?? "" }} />;
}
```

Register `/login` and make `/onboarding` use `OnboardingEntry` in `client/src/App.tsx`. This ensures the callback’s only front-end effect is a normal authenticated navigation.

## React Component Tests

```tsx
// client/src/pages/LoginPage.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LoginPage from "./LoginPage";

describe("LoginPage", () => {
  it("starts the BFF-owned Keycloak flow with a relative return path", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    window.history.replaceState({}, "", "/login?returnTo=%2Fonboarding");

    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: /continue with keycloak/i }));

    expect(assign).toHaveBeenCalledWith("/api/auth/keycloak/login?returnTo=%2Fonboarding");
  });

  it("does not surface Keycloak provider descriptions to the user", () => {
    window.history.replaceState({}, "", "/login?error=keycloak_callback&error_description=secret");
    render(<LoginPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in could not be completed");
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});
```

## Required Assertions Before Merge

| Gate | Evidence |
|---|---|
| Server callback tests | All PKCE, state, replay, expired-ID-token, nonce, subject-mismatch, cancellation, and refresh rotation tests pass. |
| React tests | Login begins at the BFF endpoint; no test expects a code/token in React state, query parameters, session storage, or local storage. |
| Browser staging test | Keycloak redirects to the BFF callback, a BIS HttpOnly cookie is set, onboarding resumes through the authenticated entry page, and an interrupted draft remains user-bound. |
| Security review | Logs redact codes/tokens; return URL allow-list works; transaction cleanup is scheduled; raw OIDC error descriptions are not rendered. |

## References

[1] [RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients](https://www.rfc-editor.org/rfc/rfc7636)  
[2] [OpenID Connect Core 1.0, incorporating errata set 2](https://openid.net/specs/openid-connect-core-1_0.html)  
[3] [Keycloak: Securing applications and services with OpenID Connect](https://www.keycloak.org/securing-apps/oidc-layers)
