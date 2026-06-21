import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifyKeycloakToken, extractRoles, mapRole } from "../keycloak";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * Tenant ID of the authenticated user.
   * Null for platform admins (role === "admin") who can see all tenants.
   * Non-null for tenant-scoped users — all data queries MUST filter by this value.
   */
  tenantId: number | null;
  /** True when the request is being served under the demo fallback user.
   *  Mutation procedures should reject with a friendly read-only error. */
  isDemo: boolean;
  /** Auth method used for this request: manus | keycloak | demo */
  authMethod: "manus" | "keycloak" | "demo";
};

/**
 * Try to authenticate via a Keycloak Bearer token in the Authorization header.
 * Returns a User row (upserted on first login) or null if the token is absent/invalid.
 */
async function authenticateKeycloakBearer(req: CreateExpressContextOptions["req"]): Promise<User | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  let claims;
  try {
    claims = await verifyKeycloakToken(token);
  } catch {
    return null; // invalid token — fall through to next auth method
  }
  if (!claims) return null; // Keycloak not configured

  const roles = extractRoles(claims);
  const bisRole = mapRole(roles);
  const openId = `kc:${claims.sub}`;
  const name = claims.name ?? claims.preferred_username ?? claims.sub ?? "Keycloak User";
  const email = claims.email ?? null;

  const db = await getDb();
  if (!db) return null;

  // Upsert the user so every Keycloak principal has a DB row.
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
  return user ?? null;
}

// Demo admin user injected when no Manus session is present.
// This allows the live demo to be explored without requiring a Manus account.
const DEMO_USER: User = {
  id: 0,
  tenantId: null, // Demo admin has no tenant scope
  openId: "demo-admin",
  name: "Demo Admin",
  email: "demo@bis-platform.dev",
  loginMethod: "demo",
  role: "admin",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  lastSignedIn: new Date(),
  pushToken: null,
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let isDemo = false;
  let authMethod: TrpcContext["authMethod"] = "manus";

  // 1. Try Keycloak Bearer token (Authorization: Bearer <jwt>)
  try {
    user = await authenticateKeycloakBearer(opts.req);
    if (user) authMethod = "keycloak";
  } catch {
    user = null;
  }

  // 2. Try Manus session cookie
  if (!user) {
    try {
      user = await sdk.authenticateRequest(opts.req);
      if (user) authMethod = "manus";
    } catch {
      user = null;
    }
  }

  // 3. Fall back to demo admin so the platform is fully explorable without login.
  // SECURITY: Demo mode is disabled in production (NODE_ENV=production) to prevent
  // unauthenticated access. In production, unauthenticated requests will have user=null
  // and protectedProcedure will return UNAUTHORIZED.
  if (!user && process.env.NODE_ENV !== 'production') {
    user = DEMO_USER;
    isDemo = true;
    authMethod = "demo";
  }

  // Expose tenantId at context level for convenient use in all procedures.
  // Platform admins (role === "admin") have tenantId = null and can see all data.
  const tenantId = user?.tenantId ?? null;

  return {
    req: opts.req,
    res: opts.res,
    user,
    tenantId,
    isDemo,
    authMethod,
  };
}
