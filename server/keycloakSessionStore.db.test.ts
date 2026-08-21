import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "postgresql://bis_user:bis_secure_2026@127.0.0.1:5432/bis_db";
process.env.BIS_SESSION_SIGNING_SECRET = "local-keycloak-session-store-test-secret";

describe("Keycloak PostgreSQL session store", () => {
  beforeAll(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new Error("Local PostgreSQL is required for this suite");
  });

  it("consumes a PKCE transaction once and rejects replay", async () => {
    const { createPkceMaterial, createPkceTransaction, consumePkceTransaction } = await import("./keycloakSessionStore");
    const material = createPkceMaterial();
    await createPkceTransaction({ ...material, redirectUri: "http://localhost:3000/api/auth/keycloak/callback", returnTo: "/dashboard" });
    const first = await consumePkceTransaction(material.state);
    expect(first?.codeVerifier).toBe(material.codeVerifier);
    expect(await consumePkceTransaction(material.state)).toBeNull();
  });

  it("grants one refresh lease and rotates the family once", async () => {
    const { getDb } = await import("./db");
    const { users } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { createRefreshFamily, acquireRefreshLease, rotateRefreshFamily } = await import("./keycloakSessionStore");
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const openId = `kc:db-test-${Date.now()}`;
    const [user] = await db.insert(users).values({ openId, name: "DB Keycloak Test", loginMethod: "keycloak" }).returning();
    if (!user) throw new Error("User insert failed");
    const familyId = await createRefreshFamily({ userId: user.id, refreshToken: "refresh-token-one", expiresAt: new Date(Date.now() + 60_000) });
    const firstLease = await acquireRefreshLease(familyId);
    expect(firstLease?.refreshToken).toBe("refresh-token-one");
    expect(await acquireRefreshLease(familyId)).toBeNull();
    expect(await rotateRefreshFamily({ familyId, leaseId: firstLease!.leaseId, refreshToken: "refresh-token-two", expiresAt: new Date(Date.now() + 60_000) })).not.toBeNull();
    await db.delete(users).where(eq(users.id, user.id));
  });
});
