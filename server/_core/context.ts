import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

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
};

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

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  // Fall back to demo admin so the platform is fully explorable without login.
  if (!user) {
    user = DEMO_USER;
    isDemo = true;
  }

  // Expose tenantId at context level for convenient use in all procedures.
  // Platform admins (role === "admin") have tenantId = null and can see all data.
  const tenantId = user.tenantId ?? null;

  return {
    req: opts.req,
    res: opts.res,
    user,
    tenantId,
    isDemo,
  };
}
