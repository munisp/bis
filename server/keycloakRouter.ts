/**
 * BIS — Keycloak tRPC router
 *
 * Exposes Keycloak Admin REST API operations as tRPC procedures.
 * When KEYCLOAK_URL / KEYCLOAK_REALM are not set, all procedures return
 * graceful "not configured" responses so the app works in dev without Keycloak.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import {
  verifyKeycloakToken,
  getKeycloakLoginUrl,
  exchangeCode,
  extractRoles,
  mapRole,
} from "./keycloak";

const KEYCLOAK_URL = ENV.keycloakUrl;
const KEYCLOAK_REALM = ENV.keycloakRealm;
const KEYCLOAK_CLIENT_ID = ENV.keycloakClientId;
const KEYCLOAK_CLIENT_SECRET = ENV.keycloakClientSecret;
const KEYCLOAK_ADMIN_USER = ENV.keycloakAdminUser;
const KEYCLOAK_ADMIN_PASSWORD = ENV.keycloakAdminPassword;

/** Obtain a Keycloak admin access token for Admin REST API calls. */
async function getAdminToken(): Promise<string> {
  if (!KEYCLOAK_URL) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Keycloak not configured" });
  const resp = await fetch(
    `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: KEYCLOAK_ADMIN_USER,
        password: KEYCLOAK_ADMIN_PASSWORD,
      }).toString(),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Admin token failed: ${text}` });
  }
  const data = (await resp.json()) as { access_token: string };
  return data.access_token;
}

/** Call the Keycloak Admin REST API. */
async function adminFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const token = await getAdminToken();
  const url = `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Keycloak Admin API error: ${text}` });
  }
  if (resp.status === 204) return null;
  return resp.json();
}

export const keycloakRouter = router({
  /** Check if Keycloak is configured */
  status: publicProcedure.query(() => ({
    configured: !!KEYCLOAK_URL,
    realm: KEYCLOAK_REALM,
    clientId: KEYCLOAK_CLIENT_ID,
    issuer: KEYCLOAK_URL ? `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}` : null,
  })),

  /** Get the Keycloak login URL for frontend redirect */
  loginUrl: publicProcedure
    .input(z.object({ redirectUri: z.string().url() }))
    .query(({ input }) => {
      // Security: validate redirectUri origin to prevent open redirect attacks.
      // Only allow origins that match known app origins or configured OAuth URLs.
      const parsed = new URL(input.redirectUri);
      const allowedOrigins = [
        process.env.VITE_OAUTH_PORTAL_URL,
        process.env.OAUTH_SERVER_URL,
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:8081',
      ].filter(Boolean) as string[];
      const isAllowed = allowedOrigins.some(o => {
        try { return new URL(o).origin === parsed.origin; } catch { return false; }
      });
      if (!isAllowed) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Redirect URI origin not allowed' });
      }
      const url = getKeycloakLoginUrl(input.redirectUri);
      return { url };
    }),

  /** Exchange an authorization code for tokens */
  exchangeCode: publicProcedure
    .input(z.object({ code: z.string(), redirectUri: z.string().url() }))
    .mutation(async ({ input }) => {
      const tokens = await exchangeCode(input.code, input.redirectUri);
      if (!tokens) throw new TRPCError({ code: "UNAUTHORIZED", message: "Code exchange failed" });
      return tokens;
    }),

  /** Introspect / validate a Bearer token */
  introspect: protectedProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      if (!KEYCLOAK_URL) return { active: false, configured: false };
      const claims = await verifyKeycloakToken(input.token);
      if (!claims) return { active: false, configured: false };
      const roles = extractRoles(claims);
      return {
        active: true,
        configured: true,
        sub: claims.sub,
        email: claims.email,
        name: claims.name,
        preferredUsername: claims.preferred_username,
        roles,
        bisRole: mapRole(roles),
      };
    }),

  /** List users in the realm (admin only) */
  listUsers: adminProcedure
    .input(
      z.object({
        search: z.string().optional(),
        first: z.number().int().min(0).default(0),
        max: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      if (!KEYCLOAK_URL) return { users: [], configured: false };
      const params = new URLSearchParams({
        first: String(input.first),
        max: String(input.max),
        ...(input.search ? { search: input.search } : {}),
      });
      const users = (await adminFetch(`/users?${params}`)) as Array<{
        id: string;
        username: string;
        email?: string;
        firstName?: string;
        lastName?: string;
        enabled: boolean;
        createdTimestamp: number;
      }>;
      return { users, configured: true };
    }),

  /** Get a single user by ID */
  getUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      if (!KEYCLOAK_URL) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Keycloak not configured" });
      return adminFetch(`/users/${input.userId}`);
    }),

  /** Create a new user */
  createUser: adminProcedure
    .input(
      z.object({
        username: z.string().min(3),
        email: z.string().email(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        password: z.string().min(8).optional(),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      if (!KEYCLOAK_URL) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Keycloak not configured" });
      const { password, ...userFields } = input;
      await adminFetch("/users", {
        method: "POST",
        body: JSON.stringify({
          ...userFields,
          credentials: password
            ? [{ type: "password", value: password, temporary: false }]
            : undefined,
        }),
      });
      // Fetch the newly created user
      const params = new URLSearchParams({ username: input.username, exact: "true" });
      const users = (await adminFetch(`/users?${params}`)) as Array<{ id: string }>;
      return { success: true, userId: users[0]?.id ?? null };
    }),

  /** Update a user */
  updateUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        email: z.string().email().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (!KEYCLOAK_URL) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Keycloak not configured" });
      const { userId, ...fields } = input;
      await adminFetch(`/users/${userId}`, { method: "PUT", body: JSON.stringify(fields) });
      return { success: true };
    }),

  /** Delete a user */
  deleteUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      if (!KEYCLOAK_URL) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Keycloak not configured" });
      await adminFetch(`/users/${input.userId}`, { method: "DELETE" });
      return { success: true };
    }),

  /** Assign a realm role to a user */
  assignRole: adminProcedure
    .input(z.object({ userId: z.string(), roleName: z.string() }))
    .mutation(async ({ input }) => {
      if (!KEYCLOAK_URL) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Keycloak not configured" });
      // Get role representation first
      const role = (await adminFetch(`/roles/${encodeURIComponent(input.roleName)}`)) as {
        id: string;
        name: string;
      };
      await adminFetch(`/users/${input.userId}/role-mappings/realm`, {
        method: "POST",
        body: JSON.stringify([role]),
      });
      return { success: true };
    }),

  /** Remove a realm role from a user */
  removeRole: adminProcedure
    .input(z.object({ userId: z.string(), roleName: z.string() }))
    .mutation(async ({ input }) => {
      if (!KEYCLOAK_URL) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Keycloak not configured" });
      const role = (await adminFetch(`/roles/${encodeURIComponent(input.roleName)}`)) as {
        id: string;
        name: string;
      };
      await adminFetch(`/users/${input.userId}/role-mappings/realm`, {
        method: "DELETE",
        body: JSON.stringify([role]),
      });
      return { success: true };
    }),

  /** List realm roles */
  listRoles: adminProcedure.query(async () => {
    if (!KEYCLOAK_URL) return { roles: [], configured: false };
    const roles = await adminFetch("/roles");
    return { roles, configured: true };
  }),

  /** Reset a user's password */
  resetPassword: adminProcedure
    .input(z.object({ userId: z.string(), newPassword: z.string().min(8), temporary: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      if (!KEYCLOAK_URL) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Keycloak not configured" });
      await adminFetch(`/users/${input.userId}/reset-password`, {
        method: "PUT",
        body: JSON.stringify({ type: "password", value: input.newPassword, temporary: input.temporary }),
      });
      return { success: true };
    }),

  /** Send a verification email */
  sendVerificationEmail: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      if (!KEYCLOAK_URL) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Keycloak not configured" });
      await adminFetch(`/users/${input.userId}/send-verify-email`, { method: "PUT" });
      return { success: true };
    }),
});
