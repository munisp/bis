/**
 * server/permify.ts
 * Permify fine-grained authorization helper for the BIS tRPC BFF.
 * Calls the Permify REST API to check permissions before executing procedures.
 * When PERMIFY_URL is not configured the helper fails-open (returns true).
 */

import { TRPCError } from "@trpc/server";

const PERMIFY_URL = process.env.PERMIFY_URL ?? "";
const PERMIFY_TENANT = process.env.PERMIFY_TENANT_ID ?? "t1";
const PERMIFY_API_KEY = process.env.PERMIFY_API_KEY ?? "";

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
 * Fails-open when Permify is not configured.
 */
export async function permifyCheck(
  entityType: string,
  entityId: string,
  permission: string,
  userId: string
): Promise<boolean> {
  if (!PERMIFY_URL) return true; // fail-open

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
      console.warn(`[Permify] check returned ${res.status} — fail-open`);
      return true;
    }

    const data = (await res.json()) as CheckResponse;
    return data.can === "RESULT_ALLOWED";
  } catch (err) {
    console.warn("[Permify] check error (fail-open):", err);
    return true;
  }
}

/**
 * Write a relationship tuple to Permify.
 * Used when creating investigations, assigning tasks, etc.
 */
export async function permifyWriteRelationship(
  tuples: RelationshipTuple[]
): Promise<void> {
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
