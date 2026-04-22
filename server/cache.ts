/**
 * Redis-backed caching layer for hot tRPC queries.
 * Falls back to a no-op (pass-through) when Redis is unavailable.
 *
 * Supports two connection modes (1B payments lesson):
 *   1. Single-node: REDIS_URL=redis://host:6379
 *   2. Sentinel HA: REDIS_SENTINELS=host1:26379,host2:26379 + REDIS_SENTINEL_NAME=mymaster
 *      Sentinel mode provides automatic failover — the master can change without
 *      application restart. Use this in production for zero-downtime Redis failover.
 *
 * Usage:
 *   const data = await withCache("dashboard:stats", 30, () => getDashboardStats(db));
 */
import { Redis } from "ioredis";
import { ENV } from "./_core/env";

// ── Redis client (singleton) ─────────────────────────────────────────────────

let _redis: Redis | null = null;
let _redisAvailable = false;

/**
 * Build a Redis client that supports both single-node and Sentinel HA modes.
 *
 * Sentinel mode (recommended for production):
 *   REDIS_SENTINELS=sentinel1:26379,sentinel2:26379,sentinel3:26379
 *   REDIS_SENTINEL_NAME=mymaster
 *   REDIS_SENTINEL_PASSWORD=<optional>
 *
 * Single-node mode:
 *   REDIS_URL=redis://host:6379
 */
function buildRedisClient(): Redis | null {
  const sentinelsEnv = process.env.REDIS_SENTINELS;
  const sentinelName = process.env.REDIS_SENTINEL_NAME || "mymaster";
  const sentinelPassword = process.env.REDIS_SENTINEL_PASSWORD;

  if (sentinelsEnv) {
    // Sentinel HA mode — automatic failover without application restart
    const sentinels = sentinelsEnv.split(",").map((s) => {
      const [host, portStr] = s.trim().split(":");
      return { host: host || "localhost", port: parseInt(portStr || "26379", 10) };
    });
    return new Redis({
      sentinels,
      name: sentinelName,
      sentinelPassword,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    } as any);
  }

  // Single-node mode
  const url = ENV.redisUrl;
  if (!url) return null;
  return new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
}

function getRedis(): Redis | null {
  if (_redis) return _redis;
  try {
    _redis = buildRedisClient();
    if (!_redis) return null;
    _redis.on("connect", () => { _redisAvailable = true; });
    _redis.on("ready", () => { _redisAvailable = true; });
    _redis.on("error", () => { _redisAvailable = false; });
    _redis.on("close", () => { _redisAvailable = false; });
    // Sentinel-specific events for observability
    (_redis as any).on("+switch-master", (_master: any, oldAddr: string, newAddr: string) => {
      console.warn(`[Redis/Sentinel] Master failover: ${oldAddr} → ${newAddr}`);
    });
    return _redis;
  } catch {
    return null;
  }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

/**
 * Wrap a DB query with Redis caching.
 * @param key    Cache key (namespaced, e.g. "dashboard:stats:tenant-1")
 * @param ttlSec TTL in seconds
 * @param fn     Async function that returns the data to cache
 */
export async function withCache<T>(
  key: string,
  ttlSec: number,
  fn: () => Promise<T>
): Promise<T> {
  const redis = getRedis();
  if (!redis || !_redisAvailable) {
    // Redis not available — pass-through
    return fn();
  }
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch {
    // Cache miss or parse error — fall through
  }
  const result = await fn();
  try {
    await redis.set(key, JSON.stringify(result), "EX", ttlSec);
  } catch {
    // Cache write failure is non-fatal
  }
  return result;
}

/**
 * Invalidate one or more cache keys.
 * Supports glob patterns (e.g. "dashboard:*").
 */
export async function invalidateCache(...patterns: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis || !_redisAvailable) return;
  for (const pattern of patterns) {
    try {
      if (pattern.includes("*")) {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) await redis.del(...keys);
      } else {
        await redis.del(pattern);
      }
    } catch {
      // Non-fatal
    }
  }
}

/**
 * Cache TTL constants (seconds)
 */
export const TTL = {
  DASHBOARD_STATS:   30,   // 30s — refreshes frequently
  LOOKUP_HISTORY:    60,   // 1 min
  ALERT_RULES:       300,  // 5 min — rarely changes
  FIELD_AGENTS:      120,  // 2 min
  DATA_SOURCES:      300,  // 5 min
  RISK_RULES:        600,  // 10 min
  TENANTS:           600,  // 10 min
  SANCTIONS_LIST:    3600, // 1 hour
  KEYCLOAK_ROLES:    300,  // 5 min
} as const;
