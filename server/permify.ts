/**
 * server/permify.ts
 * Permify fine-grained authorization helper for the BIS tRPC BFF.
 * Calls the Permify REST API to check permissions before executing procedures.
 * Authorization is denied whenever Permify is unconfigured or unavailable.
 */

import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";

// Read at call-time so tests can delete process.env.PERMIFY_URL
function getPermifyUrl() { return process.env.PERMIFY_URL ?? ""; }
function getPermifyTenant() { return process.env.PERMIFY_TENANT_ID ?? "t1"; }
function getPermifyApiKey() { return process.env.PERMIFY_API_KEY ?? ""; }

interface CheckRequest {
  metadata: { depth: number; snap_token?: string };
  entity: { type: string; id: string };
  permission: string;
  subject: { type: string; id: string; relation?: string };
}

interface CheckResponse {
  can: "RESULT_ALLOWED" | "RESULT_DENIED" | string;
}

interface RelationshipTuple {
  entity: { type: string; id: string };
  relation: string;
  subject: { type: string; id: string };
}

/**
 * Check whether a user has a permission on an entity.
 * Fails-CLOSED when Permify is unconfigured or unavailable to prevent privilege escalation.
 */
export async function permifyCheck(
  entityType: string,
  entityId: string,
  permission: string,
  userId: string
): Promise<boolean> {
  const PERMIFY_URL = getPermifyUrl();
  const PERMIFY_TENANT = getPermifyTenant();
  const PERMIFY_API_KEY = getPermifyApiKey();

  if (!PERMIFY_URL) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Authorization service is not configured — access denied",
    });
  }

  const body: CheckRequest = {
    metadata: { depth: 20 },
    entity: { type: entityType, id: entityId },
    permission,
    subject: { type: "user", id: userId },
  };

  try {
    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/permissions/check`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(PERMIFY_API_KEY ? { Authorization: `Bearer ${PERMIFY_API_KEY}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      }
    );

    if (!res.ok) {
      // Permify returned an error — fail CLOSED to prevent privilege escalation
      console.error(`[Permify] check returned ${res.status} — denying access (fail-closed)`);
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Authorization service unavailable — access denied",
      });
    }

    const data = (await res.json()) as CheckResponse;
    return data.can === "RESULT_ALLOWED";
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    console.error("[Permify] check error — denying access (fail-closed):", err);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Authorization service unavailable — access denied",
    });
  }
}

/**
 * Write a relationship tuple to Permify.
 * Used when creating investigations, assigning tasks, etc.
 */
export async function permifyWriteRelationship(
  tuples: RelationshipTuple[]
): Promise<void> {
  const PERMIFY_URL = getPermifyUrl();
  const PERMIFY_TENANT = getPermifyTenant();
  const PERMIFY_API_KEY = getPermifyApiKey();
  if (!PERMIFY_URL) return;

  try {
    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/relationships/write`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(PERMIFY_API_KEY ? { Authorization: `Bearer ${PERMIFY_API_KEY}` } : {}),
        },
        body: JSON.stringify({ metadata: {}, tuples }),
        signal: AbortSignal.timeout(3000),
      }
    );

    if (!res.ok) {
      console.warn(`[Permify] write relationship returned ${res.status}`);
    }
  } catch (err) {
    console.warn("[Permify] write relationship error:", err);
  }
}

/**
 * tRPC middleware factory — throws FORBIDDEN if the user lacks the permission.
 * Usage:
 *   const canReadInvestigation = permifyMiddleware("investigation", "read",
 *     (input) => input.id);
 *   const secureProc = protectedProcedure.use(canReadInvestigation);
 */
export function permifyMiddleware<TInput extends Record<string, unknown>>(
  entityType: string,
  permission: string,
  entityIdFn: (input: TInput) => string
) {
  return async function middleware(opts: {
    ctx: { user?: { id: number } | null };
    input: TInput;
    next: () => Promise<unknown>;
  }) {
    const userId = String(opts.ctx.user?.id ?? "anonymous");
    const entityId = entityIdFn(opts.input);

    const allowed = await permifyCheck(entityType, entityId, permission, userId);
    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `You do not have '${permission}' permission on ${entityType}:${entityId}`,
      });
    }

    return opts.next();
  };
}

/**
 * Seed Permify with the initial BIS organization and admin relationship.
 * Call this once on server startup when Permify is configured.
 */
export async function permifySeedOrg(orgId: string, adminUserId: string): Promise<void> {
  await permifyWriteRelationship([
    {
      entity: { type: "organization", id: orgId },
      relation: "admin",
      subject: { type: "user", id: adminUserId },
    },
  ]);
}
