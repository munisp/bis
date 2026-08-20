# Secure Token Rotation and Production Docker/Nginx Configuration

**Author:** Manus AI  
**Status:** Implementation reference. The examples are designed for the proposed server-owned Keycloak authorization-code flow. They are not yet applied to the BIS repository.

## Non-Negotiable Browser Boundary

The frontend must **not** store an access token, refresh token, authorization code, PKCE verifier, or session identifier in `localStorage`, `sessionStorage`, IndexedDB, React state, a URL parameter, or a service-worker cache. The BFF owns Keycloak tokens and the browser holds only a short-lived BIS session cookie marked `HttpOnly`, `Secure`, and `SameSite=Lax`.

OWASP advises against placing session identifiers or sensitive authentication data in browser storage because JavaScript can read it and an XSS vulnerability can exfiltrate it. [1] The frontend’s token-storage implementation is therefore intentionally empty: its only security-relevant behavior is an authenticated `fetch()` with `credentials: "include"` and a one-flight BFF refresh recovery.

| Asset | Storage location | Rotation/expiry rule |
|---|---|---|
| Keycloak authorization code | BFF callback request only | Redeem exactly once; never log, cache, or expose to React. |
| PKCE verifier | Encrypted PostgreSQL OIDC transaction | Single use; delete/expire after callback. |
| Keycloak access token | BFF process only | Validate before use; never send to browser. |
| Keycloak refresh token | AES-256-GCM-encrypted PostgreSQL record | Lock row, refresh once, atomically replace on every successful rotation. |
| BIS session token | Host-only `HttpOnly; Secure; SameSite=Lax` cookie | Renew only through BFF after a valid refresh; clear on logout/revocation. |
| CSRF token | Non-HttpOnly, host-only cookie plus request header | Rotate with session; validate on state-changing BFF endpoints. |

## Required Data Model

The current `POST /api/auth/refresh` contract accepts a browser-supplied refresh token. Replace that contract with a server-owned refresh record. The schema below supports session-specific rotation and enables detection of token-family reuse.

```ts
// drizzle/schema.ts — representative addition
export const keycloakRefreshSessions = pgTable("keycloak_refresh_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  keycloakSubject: varchar("keycloak_subject", { length: 255 }).notNull(),
  sessionFamilyId: uuid("session_family_id").notNull(),
  refreshCiphertext: text("refresh_ciphertext").notNull(),
  refreshIv: varchar("refresh_iv", { length: 24 }).notNull(),
  refreshAuthTag: varchar("refresh_auth_tag", { length: 32 }).notNull(),
  version: integer("version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokeReason: varchar("revoke_reason", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("keycloak_refresh_sessions_user_active_idx").on(table.userId, table.revokedAt),
  index("keycloak_refresh_sessions_expiry_idx").on(table.expiresAt),
]);
```

Encrypt each refresh token with a purpose-separated AEAD key, for example `keycloak-refresh-token:v1`, derived from `TOTP_ENCRYPTION_KEY` or a dedicated `KEYCLOAK_TOKEN_ENCRYPTION_KEY`. Store ciphertext, IV, and authentication tag separately; never use reversible application-level encoding in place of encryption.

## Server: Cookie and CSRF Policy

The existing `server/_core/cookies.ts` returns `sameSite: "none"`. For a same-origin BFF callback flow, change this to `"lax"`. `SameSite=Lax` permits top-level redirects from Keycloak back to the application while reducing ambient cross-site cookie use. Do not use `SameSite=None` unless the app is intentionally embedded or operates on a cross-site frontend origin and a separate CSRF design has been reviewed.

```ts
// server/_core/cookies.ts — production direction
export function getSessionCookieOptions(req: Request): Pick<CookieOptions,
  "httpOnly" | "path" | "sameSite" | "secure"
> {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isSecureRequest(req), // true only after Nginx has supplied X-Forwarded-Proto=https
  };
}
```

Add a CSRF middleware for `POST`, `PUT`, `PATCH`, and `DELETE` endpoints that mutate application state. The refresh endpoint below also checks a same-origin request before attempting token renewal.

```ts
// server/auth/csrf.ts
import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function equivalent(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireSameOriginCsrf(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  const host = req.get("host");
  const expectedOrigin = `${req.protocol}://${host}`;
  const cookieToken = req.cookies?.bis_csrf;
  const headerToken = req.get("x-bis-csrf");

  if (!origin || origin !== expectedOrigin || !cookieToken || !headerToken || !equivalent(cookieToken, headerToken)) {
    return res.status(403).json({ error: "csrf_validation_failed" });
  }
  next();
}
```

Set `app.set("trust proxy", 1)` only when the app is reachable exclusively through the Nginx proxy. Otherwise, public callers can forge `X-Forwarded-Proto` and influence the `Secure` decision.

## Server: Atomic Refresh Rotation

### Keycloak refresh adapter

```ts
// server/keycloakRefresh.ts
export type KeycloakRefreshResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_expires_in?: number;
};

export async function refreshAtKeycloak(refreshToken: string): Promise<KeycloakRefreshResponse> {
  const response = await fetch(
    `${ENV.keycloakUrl}/realms/${ENV.keycloakRealm}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: ENV.keycloakClientId,
        client_secret: ENV.keycloakClientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(8_000),
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error("Keycloak refresh rejected");
    Object.assign(error, { providerCode: body.error, status: response.status });
    throw error;
  }
  return response.json() as Promise<KeycloakRefreshResponse>;
}
```

### Refresh route

This route receives **no token** in its body. It obtains the current BIS session from the existing SDK/cookie context, locks the active refresh record, calls Keycloak, checks the refreshed access-token subject, and replaces the encrypted refresh token before issuing a new BIS cookie.

```ts
// server/_core/sessionRefresh.ts
import type { Express, Request, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { keycloakRefreshSessions } from "../../drizzle/schema";
import { getDb } from "../db";
import { requireSameOriginCsrf } from "../auth/csrf";
import { decryptForPurpose, encryptForPurpose } from "../auth/crypto";
import { refreshAtKeycloak } from "../keycloakRefresh";
import { verifyKeycloakToken } from "../keycloak";
import { issueKeycloakSession } from "../auth/issueKeycloakSession";
import { getAuthenticatedBISUser, clearBISSession } from "../auth/currentSession";

function isInvalidGrant(error: unknown) {
  return typeof error === "object" && error !== null && (error as { providerCode?: string }).providerCode === "invalid_grant";
}

export function registerSessionRefreshRoute(app: Express) {
  app.post("/api/auth/refresh", requireSameOriginCsrf, async (req: Request, res: Response) => {
    const current = await getAuthenticatedBISUser(req);
    if (!current) return res.status(401).json({ error: "session_required" });

    const db = await getDb();
    if (!db) return res.status(503).json({ error: "database_unavailable" });

    try {
      const result = await db.transaction(async tx => {
        const [record] = await tx.select().from(keycloakRefreshSessions)
          .where(and(
            eq(keycloakRefreshSessions.userId, current.id),
            isNull(keycloakRefreshSessions.revokedAt),
            gt(keycloakRefreshSessions.expiresAt, new Date()),
          ))
          .orderBy(keycloakRefreshSessions.updatedAt)
          .limit(1)
          .for("update");

        if (!record) return { kind: "reauth" as const };

        const oldRefresh = decryptForPurpose(record, "keycloak-refresh-token:v1");
        const refreshed = await refreshAtKeycloak(oldRefresh);
        // Rotation is mandatory. A provider response without a replacement is not persisted.
        if (!refreshed.refresh_token) throw new Error("Keycloak did not rotate the refresh token");

        const claims = await verifyKeycloakToken(refreshed.access_token);
        if (!claims || claims.sub !== record.keycloakSubject) throw new Error("Refreshed token subject mismatch");

        const replacement = encryptForPurpose(refreshed.refresh_token, "keycloak-refresh-token:v1");
        await tx.update(keycloakRefreshSessions).set({
          ...replacement,
          version: record.version + 1,
          expiresAt: new Date(Date.now() + (refreshed.refresh_expires_in ?? 0) * 1000),
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(keycloakRefreshSessions.id, record.id));
        return { kind: "success" as const, claims };
      });

      if (result.kind === "reauth") {
        await clearBISSession(req, res);
        return res.status(401).json({ error: "reauthentication_required" });
      }
      await issueKeycloakSession(req, res, result.claims);
      return res.status(204).end();
    } catch (error) {
      if (isInvalidGrant(error)) {
        await db.update(keycloakRefreshSessions).set({ revokedAt: new Date(), revokeReason: "provider_invalid_grant" })
          .where(and(eq(keycloakRefreshSessions.userId, current.id), isNull(keycloakRefreshSessions.revokedAt)));
        await clearBISSession(req, res);
        return res.status(401).json({ error: "reauthentication_required" });
      }
      console.error("[SessionRefresh] failed", { message: error instanceof Error ? error.message : "unknown" });
      return res.status(503).json({ error: "refresh_temporarily_unavailable" });
    }
  });
}
```

The initial Keycloak callback must create this record, and logout must revoke both the record and the local BIS session. If Keycloak supports refresh-token reuse detection, enable it in the realm and treat `invalid_grant` as a session-family compromise rather than retrying the same token.

## Frontend: No Token Storage, One Coordinated Recovery

React has no `setToken()`, no token context, and no storage API calls. It carries only the CSRF value, which is not an authenticator by itself, from a non-HttpOnly cookie to an `X-BIS-CSRF` header.

```tsx
// client/src/lib/sessionRecovery.ts
let refreshInFlight: Promise<boolean> | null = null;

function readCookie(name: string) {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie.split("; ").find(item => item.startsWith(prefix))?.slice(prefix.length) ?? "";
}

export async function refreshBISSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: {
        "x-bis-csrf": decodeURIComponent(readCookie("bis_csrf")),
        "cache-control": "no-store",
      },
    })
      .then(response => response.status === 204)
      .catch(() => false)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}
```

Integrate recovery into the existing React Query/tRPC error policy once. Do not refresh after every 401 indiscriminately; prevent loops and exclude `/api/auth/refresh` itself.

```tsx
// client/src/main.tsx — concept to add to the existing tRPC fetch wrapper
import { refreshBISSession } from "@/lib/sessionRecovery";

async function fetchWithSessionRecovery(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { ...init, credentials: "include" });
  const url = typeof input === "string" ? input : input.toString();
  if (response.status !== 401 || url.includes("/api/auth/refresh")) return response;

  if (await refreshBISSession()) {
    return fetch(input, { ...init, credentials: "include" }); // exactly one replay
  }
  return response;
}
```

When recovery returns false, the existing unauthenticated error handler should redirect to `/login?returnTo=<current-relative-path>`. Never turn a refresh error into a background retry storm; it conceals session revocation and can amplify Keycloak outages.

## Production Docker Deployment

For the managed Manus deployment, do **not** add a root Dockerfile merely to run this Node application; the platform-generated image is the preferred route. The following Compose arrangement is for a self-hosted, Docker-capable staging or production environment. It keeps the BFF off the public network and exposes only Nginx.

```yaml
# deploy/compose.auth-production.yml
services:
  bff:
    image: registry.example.com/munisp/bis:${BIS_IMAGE_TAG:?set-an-immutable-image-tag}
    restart: unless-stopped
    command: ["node", "dist/index.js"]
    environment:
      NODE_ENV: production
      PORT: "3000"
      # Inject through Docker secrets, a secret manager, or the orchestrator; do not commit values.
      BIS_DATABASE_URL: ${BIS_DATABASE_URL:?required}
      BIS_SESSION_SIGNING_SECRET: ${BIS_SESSION_SIGNING_SECRET:?required}
      KEYCLOAK_TOKEN_ENCRYPTION_KEY: ${KEYCLOAK_TOKEN_ENCRYPTION_KEY:?required}
      KEYCLOAK_URL: ${KEYCLOAK_URL:?required}
      KEYCLOAK_REALM: ${KEYCLOAK_REALM:?required}
      KEYCLOAK_CLIENT_ID: ${KEYCLOAK_CLIENT_ID:?required}
      KEYCLOAK_CLIENT_SECRET: ${KEYCLOAK_CLIENT_SECRET:?required}
      PUBLIC_APP_ORIGIN: https://bis.example.com
      TRUST_PROXY_HOPS: "1"
    expose: ["3000"]
    networks: [private]
    read_only: true
    tmpfs: ["/tmp:size=64m,noexec,nosuid,nodev"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

  nginx:
    image: nginx:1.28-alpine
    restart: unless-stopped
    depends_on:
      bff:
        condition: service_healthy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/bis-auth.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
    networks: [private, public]
    read_only: true
    tmpfs: ["/var/cache/nginx:size=32m", "/var/run:size=8m", "/tmp:size=16m"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]

networks:
  public: {}
  private:
    internal: true
```

The application image must already contain the built `dist/` output and runtime Node dependencies. Do not place secrets in the Dockerfile, image layers, build arguments, Compose file, or browser-visible `VITE_*` values. The WebDev deploy contract also requires the server to listen on `process.env.PORT` and advises against a custom Dockerfile for a plain Node application. [4]

## Hardened Nginx Configuration

This is a focused replacement for the auth-relevant portions of `infra/nginx/nginx.conf`. Preserve upstreams for the existing gateway and services separately. Nginx must overwrite—not append—public `X-Forwarded-*` claims before the BFF trusts proxy headers.

```nginx
# deploy/nginx/bis-auth.conf
limit_req_zone $binary_remote_addr zone=auth_by_ip:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=refresh_by_ip:10m rate=30r/m;

upstream bis_bff { server bff:3000; keepalive 32; }

server {
  listen 80;
  server_name bis.example.com;
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 308 https://$host$request_uri; }
}

server {
  listen 443 ssl http2;
  server_name bis.example.com;

  ssl_certificate     /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 1d;
  ssl_session_tickets off;
  ssl_stapling on;
  ssl_stapling_verify on;
  ssl_trusted_certificate /etc/nginx/certs/chain.pem;
  resolver 1.1.1.1 1.0.0.1 valid=300s;

  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "no-referrer" always;
  add_header X-Frame-Options "DENY" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
  add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; connect-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'" always;

  client_max_body_size 50m;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Port $server_port;
  proxy_set_header Connection "";
  proxy_connect_timeout 5s;
  proxy_send_timeout 30s;
  proxy_read_timeout 60s;

  # No proxy caching for OAuth redirects, Set-Cookie, refresh results, or session reads.
  location ^~ /api/auth/keycloak/ {
    limit_req zone=auth_by_ip burst=5 nodelay;
    add_header Cache-Control "no-store, max-age=0" always;
    proxy_no_cache 1;
    proxy_cache_bypass 1;
    proxy_pass http://bis_bff;
  }

  location = /api/auth/refresh {
    limit_req zone=refresh_by_ip burst=10 nodelay;
    add_header Cache-Control "no-store, max-age=0" always;
    proxy_no_cache 1;
    proxy_cache_bypass 1;
    proxy_pass http://bis_bff;
  }

  location ^~ /api/trpc/ {
    proxy_pass http://bis_bff;
  }

  location / {
    proxy_pass http://bis_bff;
  }

  location ~* /\.(?:env|git|svn|bak|sql|log)$ { return 404; }
}
```

Nginx’s proxy module supports forwarding a controlled `Host` and client address to the upstream; it must be configured only at the trusted edge. [5] The Nginx SSL module supports TLS 1.2/1.3, shared session caching, certificate configuration, and stapling controls used above. [6]

## Keycloak Production Configuration

| Setting | Required value |
|---|---|
| Client type | Confidential server-side web client. |
| Standard flow | Enabled. |
| Direct access grants | Disabled; do not collect user passwords in BIS. [3] |
| Valid redirect URI | `https://bis.example.com/api/auth/keycloak/callback` only; no wildcard callback. |
| Web origins | `https://bis.example.com` only. |
| PKCE | Require `S256`. |
| Token settings | Short access-token lifetime; refresh-token rotation/reuse detection enabled where supported. |
| Signing keys | RSA/EC signing keys exposed through realm JWKS; BFF caches keys with bounded refresh. |
| Logout | Use OIDC RP-initiated logout and revoke/delete the local refresh record. |

Keycloak documents the authorization-code flow as the recommended browser redirect flow and identifies the token endpoint as the endpoint that exchanges an authorization code for access, refresh, and ID tokens. [3]

## Production Validation Checklist

| Test | Expected evidence |
|---|---|
| Browser storage audit | `localStorage`, `sessionStorage`, and IndexedDB contain no access, refresh, ID, authorization, PKCE, or BIS session token. |
| Cookie inspection | BIS session is host-only, `HttpOnly`, `Secure`, `SameSite=Lax`, and not exposed by `document.cookie`; CSRF cookie is readable but insufficient to authenticate alone. |
| Callback headers | Nginx forwards `X-Forwarded-Proto=https`; BFF emits `Secure` cookies; auth responses send `Cache-Control: no-store`. |
| Refresh race | Ten simultaneous expired-session API calls issue at most one Keycloak refresh request and at most one database token replacement. |
| Rotation replay | Reusing a prior refresh token receives `invalid_grant`; local session family is revoked and next request requires sign-in. |
| Proxy isolation | BFF port 3000 cannot be reached from the public network; only Nginx ports 80/443 are published. |
| Redirect safety | Absolute, protocol-relative, encoded, and unrecognized `returnTo` values resolve to `/onboarding`. |
| TLS | HTTP redirects to HTTPS; TLS 1.2/1.3 only; HSTS is present; no auth response is cached. |

## References

[1] [OWASP HTML5 Security Cheat Sheet — Local Storage and Session Identifiers](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)  
[2] [RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients](https://www.rfc-editor.org/rfc/rfc7636)  
[3] [Keycloak: Securing applications and services with OpenID Connect](https://www.keycloak.org/securing-apps/oidc-layers)  
[4] [Manus WebDev Custom Dockerfile Deploy Contract](https://manus.im)  
[5] [NGINX HTTP Proxy Module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)  
[6] [NGINX HTTP SSL Module](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)
