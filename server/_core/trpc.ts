import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { permifyCheck } from "../permify";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

/**
 * Admin procedure — two-layer authorization:
 *   Layer 1: DB role check (ctx.user.role === 'admin') — fast, no network call.
 *   Layer 2: Permify RBAC check (user has 'admin' permission on 'platform:bis') —
 *            defense-in-depth, ensures the external authorization engine agrees.
 *            Fails CLOSED in production; fails OPEN in dev/test when Permify is
 *            not configured (PERMIFY_URL is empty).
 */
export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    // Layer 1: local role check (fast path)
    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    // Layer 2: Permify RBAC check (defense-in-depth)
    // permifyCheck fails-closed in production; fails-open in dev/test.
    const allowed = await permifyCheck(
      "platform",
      "bis",
      "admin",
      String(ctx.user.id)
    );
    if (!allowed) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * Demo-safe mutation procedure.
 * Behaves like protectedProcedure for authenticated users.
 * In demo mode (isDemo=true) it rejects with a friendly read-only error
 * so the live demo cannot corrupt seeded data.
 */
const demoReadonlyMiddleware = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  if (ctx.isDemo) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This action is disabled in demo mode. Sign in with a real account to make changes.",
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Use this instead of protectedProcedure for any mutation that writes data. */
export const writeProcedure = t.procedure.use(demoReadonlyMiddleware);
