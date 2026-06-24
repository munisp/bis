/**
 * BIS — Insider Threat Security Middleware
 *
 * Provides tRPC middleware for:
 *   1. Privileged-access time-window enforcement (block outside approved hours)
 *   2. Session anomaly detection (concurrent sessions from different IPs)
 *   3. Data-loss prevention (DLP) hook — intercepts bulk-export mutations
 *   4. Exfiltration detector — sliding-window counter for bulk-download events
 *   5. Anomalous-IP / geolocation blocking (Redis-backed blocklist)
 *   6. Enriched audit-log emission to Kafka bis.insider topic
 *   7. Per-user rate limiting on sensitive endpoints via Redis
 *
 * All middleware is non-fatal by default: failures are logged and the request
 * continues unless the check explicitly blocks it (returns FORBIDDEN).
 */

import { TRPCError } from "@trpc/server";
import { initTRPC } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import { getRedis } from "./redis";
import { publishInsiderThreatEvent } from "./dapr";
import { ENV } from "./_core/env";

// Re-use the same tRPC instance so middleware types align with appRouter
const t = initTRPC.context<TrpcContext>().create();

// ─── Constants ────────────────────────────────────────────────────────────────

/** Approved privileged-access hours (UTC). Default: 06:00–22:00 */
const PRIVILEGED_START_HOUR = Number((ENV as Record<string, unknown>).privilegedStartHour ?? 6);
const PRIVILEGED_END_HOUR   = Number((ENV as Record<string, unknown>).privilegedEndHour   ?? 22);

/** Bulk-export sliding window: max N calls in windowSec seconds per user */
const BULK_EXPORT_MAX    = 5;
const BULK_EXPORT_WINDOW = 300; // 5 minutes

/** Dead-man-switch: emit HIGH alert after N bulk-export calls in window */
const DEAD_MAN_THRESHOLD = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function utcHour(): number {
  return new Date().getUTCHours();
}

async function redisIncr(key: string, windowSec: number): Promise<number> {
  try {
    const redis = getRedis();
    if (!redis) return 0;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    return count;
  } catch {
    return 0; // Redis unavailable — fail open
  }
}

async function redisGetStr(key: string): Promise<string | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    return await redis.get(key);
  } catch {
    return null;
  }
}

async function redisSetStr(key: string, value: string, ex?: number): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    if (ex) await redis.set(key, value, "EX", ex);
    else     await redis.set(key, value);
  } catch { /* ignore */ }
}

/** Emit an insider-threat event without blocking the caller. */
function emitInsiderEvent(
  userId: string,
  category: string,
  severity: string,
  metadata: Record<string, unknown>,
): void {
  void publishInsiderThreatEvent({
    eventId:     Date.now(),
    subjectId:   userId,
    category,
    severity,
    triggeredAt: new Date().toISOString(),
    ...metadata as { sourceIp?: string; resourcePath?: string; payloadBytes?: number; ruleId?: string },
  }).catch((err: unknown) => {
    console.warn("[InsiderThreat] Failed to emit event:", err);
  });
}

function getClientIp(ctx: TrpcContext): string {
  const fwd = (ctx.req as { headers?: Record<string, string | string[] | undefined> })
    ?.headers?.["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  if (Array.isArray(fwd)) return fwd[0];
  return (ctx.req as { ip?: string })?.ip ?? "unknown";
}

// ─── 1. Privileged-access time-window enforcement ────────────────────────────

/**
 * Blocks admin routes outside approved UTC hours.
 * Non-admin users are always allowed through.
 */
export const privilegedTimeWindowMiddleware = t.middleware(async ({ ctx, next }) => {
  if (ctx.user?.role === "admin") {
    const hour = utcHour();
    const inWindow = hour >= PRIVILEGED_START_HOUR && hour < PRIVILEGED_END_HOUR;
    if (!inWindow) {
      emitInsiderEvent(String(ctx.user.id), "off_hours_access", "high", {
        sourceIp: getClientIp(ctx),
      });
      throw new TRPCError({
        code:    "FORBIDDEN",
        message: `Privileged access is only permitted ${PRIVILEGED_START_HOUR}:00–${PRIVILEGED_END_HOUR}:00 UTC. Current UTC hour: ${hour}.`,
      });
    }
  }
  return next({ ctx });
});

// ─── 2. Session anomaly detection ────────────────────────────────────────────

/**
 * Flags concurrent sessions from different IP addresses.
 * Logs to insider event stream but does NOT block (blocking requires
 * a separate session-revocation flow).
 */
export const sessionAnomalyMiddleware = t.middleware(async ({ ctx, next }) => {
  if (ctx.user) {
    const ip = getClientIp(ctx);
    const sessionKey = `bis:session:ip:${ctx.user.id}`;
    const lastIp = await redisGetStr(sessionKey);

    if (lastIp && lastIp !== ip && lastIp !== "unknown" && ip !== "unknown") {
      emitInsiderEvent(String(ctx.user.id), "concurrent_session_anomaly", "medium", {
        sourceIp: ip,
      });
    }

    await redisSetStr(sessionKey, ip, 86400); // 24h TTL
  }
  return next({ ctx });
});

// ─── 3. Data-loss prevention (DLP) hook ──────────────────────────────────────

/**
 * Intercepts bulk-export mutations and logs them to the insider event stream.
 * Dead-man-switch: emits HIGH severity after DEAD_MAN_THRESHOLD exports.
 * Hard blocks after BULK_EXPORT_MAX exports in the sliding window.
 */
export const dlpMiddleware = t.middleware(async ({ ctx, next }) => {
  if (ctx.user) {
    const key = `bis:dlp:bulk:${ctx.user.id}`;
    const count = await redisIncr(key, BULK_EXPORT_WINDOW);
    const severity = count >= DEAD_MAN_THRESHOLD ? "high" : "info";

    emitInsiderEvent(String(ctx.user.id), "bulk_export", severity, {
      sourceIp: getClientIp(ctx),
    });

    if (count > BULK_EXPORT_MAX) {
      throw new TRPCError({
        code:    "TOO_MANY_REQUESTS",
        message: `Bulk export rate limit exceeded. Maximum ${BULK_EXPORT_MAX} exports per ${BULK_EXPORT_WINDOW / 60} minutes.`,
      });
    }
  }
  return next({ ctx });
});

// ─── 4. Exfiltration detector ─────────────────────────────────────────────────

/**
 * Sliding-window counter for any data-download event.
 * Emits CRITICAL insider alert when the threshold is exceeded.
 */
export const exfiltrationDetectorMiddleware = t.middleware(async ({ ctx, next }) => {
  if (ctx.user) {
    const key = `bis:exfil:${ctx.user.id}`;
    const count = await redisIncr(key, 3600); // 1-hour window

    if (count > 20) {
      emitInsiderEvent(String(ctx.user.id), "data_exfiltration", "critical", {
        sourceIp: getClientIp(ctx),
      });
    }
  }
  return next({ ctx });
});

// ─── 5. Anomalous-IP / geolocation blocking ──────────────────────────────────

/**
 * Blocks requests from IPs on the Redis-backed blocklist.
 * Blocklist key: bis:ip:blocklist (Redis SET of blocked IPs)
 */
export const anomalousIpMiddleware = t.middleware(async ({ ctx, next }) => {
  const ip = getClientIp(ctx);

  if (ip && ip !== "unknown") {
    try {
      const redis = getRedis();
      if (redis) {
        const blocked = await redis.sismember("bis:ip:blocklist", ip);
        if (blocked) {
          emitInsiderEvent(
            ctx.user ? String(ctx.user.id) : "anonymous",
            "blocked_ip_access",
            "critical",
            { sourceIp: ip },
          );
          throw new TRPCError({
            code:    "FORBIDDEN",
            message: "Access denied: IP address is on the security blocklist.",
          });
        }
      }
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      // Redis unavailable — fail open
    }
  }

  return next({ ctx });
});

// ─── 6. Enriched audit-log emission to Kafka bis.insider topic ───────────────

/**
 * Emits an enriched audit event to bis.insider.events for every privileged
 * action. Attach this to adminProcedure chains.
 */
export const insiderAuditMiddleware = t.middleware(async ({ ctx, path, next }) => {
  const result = await next({ ctx });

  if (ctx.user) {
    emitInsiderEvent(String(ctx.user.id), "privileged_action", "info", {
      resourcePath: path,
      sourceIp: getClientIp(ctx),
    });
  }

  return result;
});

// ─── 7. Per-user rate limiting on sensitive endpoints ────────────────────────

/**
 * Factory: creates a rate-limit middleware for a given endpoint.
 * @param maxRequests Max requests per window
 * @param windowSec   Window duration in seconds
 */
export function sensitiveRateLimitMiddleware(maxRequests: number, windowSec: number) {
  return t.middleware(async ({ ctx, path, next }) => {
    if (ctx.user) {
      const key = `bis:rl:${path}:${ctx.user.id}`;
      const count = await redisIncr(key, windowSec);

      if (count > maxRequests) {
        throw new TRPCError({
          code:    "TOO_MANY_REQUESTS",
          message: `Rate limit exceeded for ${path}. Maximum ${maxRequests} requests per ${windowSec}s.`,
        });
      }
    }
    return next({ ctx });
  });
}
