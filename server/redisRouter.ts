/**
 * BIS — Redis management tRPC router
 *
 * Exposes Redis cache operations as tRPC procedures for admin use.
 * Falls back gracefully when Redis is unavailable.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  cacheGet,
  cacheSet,
  cacheDel,
  sessionGet,
  sessionDel,
  rateLimit,
  markEventProcessed,
} from "./redis";
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/** Get a raw Redis client for admin operations (key listing, flush, etc.) */
let adminClient: Redis | null = null;
function getAdminClient(): Redis | null {
  if (adminClient) return adminClient;
  try {
    adminClient = new Redis(REDIS_URL, {
      connectTimeout: 3000,
      commandTimeout: 2000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    adminClient.connect().catch(() => {
      adminClient = null;
    });
    return adminClient;
  } catch {
    return null;
  }
}

export const redisRouter = router({
  /** Check Redis connectivity status */
  status: protectedProcedure.query(async () => {
    const r = getAdminClient();
    if (!r) return { connected: false, url: REDIS_URL };
    try {
      const pong = await r.ping();
      const info = await r.info("server");
      const versionMatch = info.match(/redis_version:([^\r\n]+)/);
      return {
        connected: pong === "PONG",
        url: REDIS_URL,
        version: versionMatch?.[1]?.trim() ?? "unknown",
      };
    } catch {
      return { connected: false, url: REDIS_URL };
    }
  }),

  /** Get a cache value by key */
  get: adminProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ input }) => {
      const value = await cacheGet(input.key);
      return { key: input.key, value, found: value !== null };
    }),

  /** Set a cache value */
  set: adminProcedure
    .input(
      z.object({
        key: z.string().min(1),
        value: z.string(),
        ttlSeconds: z.number().int().min(1).max(86400 * 30).default(3600),
      })
    )
    .mutation(async ({ input }) => {
      await cacheSet(input.key, input.value, input.ttlSeconds);
      return { success: true, key: input.key };
    }),

  /** Delete a cache key */
  del: adminProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await cacheDel(input.key);
      return { success: true, key: input.key };
    }),

  /** List keys matching a pattern */
  listKeys: adminProcedure
    .input(
      z.object({
        pattern: z.string().default("*"),
        count: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      const r = getAdminClient();
      if (!r) return { keys: [], connected: false };
      try {
        const keys = await r.keys(input.pattern);
        const limited = keys.slice(0, input.count);
        return { keys: limited, total: keys.length, connected: true };
      } catch {
        return { keys: [], connected: false, error: "Failed to list keys" };
      }
    }),

  /** Get key TTL and type information */
  inspect: adminProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ input }) => {
      const r = getAdminClient();
      if (!r) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Redis not available" });
      const [ttl, type, value] = await Promise.all([
        r.ttl(input.key),
        r.type(input.key),
        r.get(input.key),
      ]);
      return { key: input.key, ttl, type, value, exists: type !== "none" };
    }),

  /** Flush all keys in a namespace (prefix) */
  flushNamespace: adminProcedure
    .input(z.object({ namespace: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const r = getAdminClient();
      if (!r) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Redis not available" });
      const pattern = `${input.namespace}:*`;
      const keys = await r.keys(pattern);
      if (keys.length > 0) {
        await r.del(...keys);
      }
      return { success: true, deletedCount: keys.length, namespace: input.namespace };
    }),

  /** Flush all keys (dangerous — admin only) */
  flushAll: adminProcedure
    .input(z.object({ confirm: z.literal("CONFIRM_FLUSH_ALL") }))
    .mutation(async () => {
      const r = getAdminClient();
      if (!r) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Redis not available" });
      await r.flushall();
      return { success: true };
    }),

  /** Get session data for a token */
  getSession: adminProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const session = await sessionGet(input.token);
      return { token: input.token, session, found: session !== null };
    }),

  /** Invalidate a session */
  deleteSession: adminProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      await sessionDel(input.token);
      return { success: true };
    }),

  /** Check rate limit status for an identifier */
  checkRateLimit: protectedProcedure
    .input(
      z.object({
        identifier: z.string(),
        limit: z.number().int().min(1).default(100),
        windowSeconds: z.number().int().min(1).default(60),
      })
    )
    .query(async ({ input }) => {
      return rateLimit(input.identifier, input.limit, input.windowSeconds);
    }),

  /** Mark an event as processed (idempotency) */
  markEventProcessed: protectedProcedure
    .input(z.object({ eventId: z.string(), ttlSeconds: z.number().int().min(1).default(3600) }))
    .mutation(async ({ input }) => {
      const isDuplicate = await markEventProcessed(input.eventId, input.ttlSeconds);
      return { isDuplicate, eventId: input.eventId };
    }),

  /** Get Redis server info */
  info: adminProcedure
    .input(z.object({ section: z.string().default("all") }))
    .query(async ({ input }) => {
      const r = getAdminClient();
      if (!r) return { info: null, connected: false };
      try {
        const info = await r.info(input.section);
        // Parse into key-value pairs
        const parsed: Record<string, string> = {};
        for (const line of info.split("\r\n")) {
          if (line.startsWith("#") || !line.includes(":")) continue;
          const [k, v] = line.split(":", 2);
          parsed[k.trim()] = v.trim();
        }
        return { info: parsed, connected: true };
      } catch {
        return { info: null, connected: false };
      }
    }),

  /** Get memory usage statistics */
  memoryStats: adminProcedure.query(async () => {
    const r = getAdminClient();
    if (!r) return { stats: null, connected: false };
    try {
      const info = await r.info("memory");
      const stats: Record<string, string> = {};
      for (const line of info.split("\r\n")) {
        if (line.startsWith("#") || !line.includes(":")) continue;
        const [k, v] = line.split(":", 2);
        stats[k.trim()] = v.trim();
      }
      return { stats, connected: true };
    } catch {
      return { stats: null, connected: false };
    }
  }),
});
