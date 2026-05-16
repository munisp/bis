/**
 * BIS — Redis session store and rate limiter
 * Uses ioredis with graceful fail-open when Redis is unavailable.
 */
import Redis from "ioredis";
import { ENV } from "./_core/env";

const REDIS_URL = ENV.redisUrl ?? "redis://localhost:6379";
const SESSION_TTL = ENV.sessionTtlSeconds; // 24h
const RATE_LIMIT_WINDOW = ENV.rateLimitWindowSeconds;
const RATE_LIMIT_MAX = ENV.rateLimitMaxRequests;

let client: Redis | null = null;
let connected = false;

function getClient(): Redis | null {
  if (client) return client;
  try {
    client = new Redis(REDIS_URL, {
      connectTimeout: 3000,
      commandTimeout: 2000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    client.on("connect", () => {
      connected = true;
      console.log(`[Redis] Connected → ${REDIS_URL}`);
    });
    client.on("error", (err) => {
      if (connected) console.warn("[Redis] Error:", err.message);
      connected = false;
    });
    client.connect().catch(() => {
      console.warn("[Redis] Cannot connect — session cache disabled (fail-open)");
    });
  } catch {
    console.warn("[Redis] Init failed — session cache disabled");
    client = null;
  }
  return client;
}

// ─── Session helpers ──────────────────────────────────────────────────────────

export async function sessionSet(token: string, payload: object): Promise<void> {
  const r = getClient();
  if (!r) return;
  try {
    await r.setex(`session:${token}`, SESSION_TTL, JSON.stringify(payload));
  } catch {
    // fail-open
  }
}

export async function sessionGet(token: string): Promise<object | null> {
  const r = getClient();
  if (!r) return null;
  try {
    const raw = await r.get(`session:${token}`);
    return raw ? (JSON.parse(raw) as object) : null;
  } catch {
    return null;
  }
}

export async function sessionDel(token: string): Promise<void> {
  const r = getClient();
  if (!r) return;
  try {
    await r.del(`session:${token}`);
  } catch {
    // fail-open
  }
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

export async function cacheGet(key: string): Promise<string | null> {
  const r = getClient();
  if (!r) return null;
  try {
    return await r.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds = 3600): Promise<void> {
  const r = getClient();
  if (!r) return;
  try {
    await r.setex(key, ttlSeconds, value);
  } catch {
    // fail-open
  }
}

export async function cacheDel(key: string): Promise<void> {
  const r = getClient();
  if (!r) return;
  try {
    await r.del(key);
  } catch {
    // fail-open
  }
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

export async function rateLimit(
  identifier: string,
  limit = RATE_LIMIT_MAX,
  windowSeconds = RATE_LIMIT_WINDOW
): Promise<RateLimitResult> {
  const r = getClient();
  if (!r) return { allowed: true, remaining: limit, resetInSeconds: windowSeconds };

  const key = `ratelimit:${identifier}`;
  try {
    const pipeline = r.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, windowSeconds);
    const results = await pipeline.exec();
    const count = (results?.[0]?.[1] as number) ?? 0;
    const remaining = Math.max(0, limit - count);
    return { allowed: count <= limit, remaining, resetInSeconds: windowSeconds };
  } catch {
    return { allowed: true, remaining: limit, resetInSeconds: windowSeconds };
  }
}

// ─── Kafka event cache (for deduplication) ────────────────────────────────────

export async function markEventProcessed(eventId: string, ttlSeconds = 3600): Promise<boolean> {
  const r = getClient();
  if (!r) return false; // can't deduplicate without Redis
  const key = `event:processed:${eventId}`;
  try {
    const result = await r.set(key, "1", "EX", ttlSeconds, "NX");
    return result === null; // null means key already existed → duplicate
  } catch {
    return false;
  }
}
