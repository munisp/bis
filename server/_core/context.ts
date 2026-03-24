import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

// Demo admin user injected when no Manus session is present.
// This allows the live demo to be explored without requiring a Manus account.
const DEMO_USER: User = {
  id: 0,
  openId: "demo-admin",
  name: "Demo Admin",
  email: "demo@bis-platform.dev",
  loginMethod: "demo",
  role: "admin",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  lastSignedIn: new Date(),
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  // Fall back to demo admin so the platform is fully explorable without login.
  if (!user) {
    user = DEMO_USER;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
