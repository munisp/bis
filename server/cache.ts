/**
 * Redis-backed caching layer for hot tRPC queries.
 * Falls back to a no-op (pass-through) when Redis is unavailable.
 *
 * Usage:
 *   const data = await withCache("dashboard:stats", 30, () => getDashboardStats(db));
 */
import { Redis } from "ioredis";
import { ENV } from "./_core/env";

// ── Redis client (singleton) ─────────────────────────────────────────────────
let _redis: Redis | null = null;
let _redisAvailable = false;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = ENV.redisUrl;
  if (!url) return null;
  try {
    _redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    _redis.on("connect", () => { _redisAvailable = true; });
    _redis.on("error", () => { _redisAvailable = false; });
    _redis.on("close", () => { _redisAvailable = false; });
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
