-- Durable BFF-owned Keycloak PKCE and refresh-token family storage.
CREATE TABLE IF NOT EXISTS keycloak_auth_transactions (
  id serial PRIMARY KEY,
  "state" varchar(128) NOT NULL UNIQUE,
  "nonce" varchar(128) NOT NULL,
  "codeVerifierEncrypted" text NOT NULL,
  "redirectUri" text NOT NULL,
  "returnTo" text NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "consumedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS keycloak_auth_transactions_expires_idx ON keycloak_auth_transactions ("expiresAt");

CREATE TABLE IF NOT EXISTS keycloak_refresh_sessions (
  "familyId" varchar(128) PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "refreshTokenEncrypted" text NOT NULL,
  generation integer NOT NULL DEFAULT 0,
  "leaseId" varchar(128),
  "leaseExpiresAt" timestamp,
  "expiresAt" timestamp NOT NULL,
  "revokedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS keycloak_refresh_sessions_user_idx ON keycloak_refresh_sessions ("userId");
CREATE INDEX IF NOT EXISTS keycloak_refresh_sessions_lease_idx ON keycloak_refresh_sessions ("leaseExpiresAt");

CREATE TABLE IF NOT EXISTS keycloak_onboarding_drafts (
  id varchar(128) PRIMARY KEY,
  "payloadEncrypted" text NOT NULL,
  "claimedByUserId" integer REFERENCES users(id) ON DELETE SET NULL,
  "claimedAt" timestamp,
  "consumedAt" timestamp,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS keycloak_onboarding_drafts_expires_idx ON keycloak_onboarding_drafts ("expiresAt");
