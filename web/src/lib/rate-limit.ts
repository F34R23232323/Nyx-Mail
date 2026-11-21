import type { Redis } from "ioredis";
import { ApiError } from "./http";

interface Bucket {
  count: number;
  resetAt: number;
}

const memory = new Map<string, Bucket>();
let redisPromise: Promise<Redis | null> | null = null;

function cleanup(): void {
  const now = Date.now();
  for (const [key, bucket] of memory) {
    if (bucket.resetAt <= now) memory.delete(key);
  }
}

if (typeof setInterval !== "undefined") {
  const timer = setInterval(cleanup, 60_000);
  // Do not keep short-lived processes alive just for cleanup.
  if (typeof timer.unref === "function") timer.unref();
}

async function getRedis(): Promise<Redis | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const { default: RedisClient } = await import("ioredis");
        const client = new RedisClient(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 1500,
        });
        client.on("error", () => {
          // Connection errors are expected when Redis is optional/offline.
        });
        await client.connect();
        await client.ping();
        return client;
      } catch {
        return null;
      }
    })();
  }
  return redisPromise;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  backend: "redis" | "memory";
}

/**
 * Fixed-window limiter. Redis is optional; without it the in-process map is
 * used. Multi-instance deployments should configure REDIS_URL so limits are
 * shared across web replicas.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now();
  const redis = await getRedis();
  if (redis) {
    try {
      const redisKey = `nyxmail:rl:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.pexpire(redisKey, windowMs);
      const ttl = await redis.pttl(redisKey);
      return {
        success: count <= limit,
        remaining: Math.max(0, limit - count),
        resetAt: now + Math.max(ttl, 0),
        backend: "redis",
      };
    } catch {
      // Fall through to memory.
    }
  }

  const bucket = memory.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    memory.set(key, fresh);
    return { success: true, remaining: limit - 1, resetAt: fresh.resetAt, backend: "memory" };
  }
  bucket.count += 1;
  return {
    success: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    backend: "memory",
  };
}

export async function consumeLimit(
  key: string,
  limit: number,
  windowMs: number,
  message = "Too many attempts. Try again later.",
): Promise<void> {
  const result = await rateLimit(key, limit, windowMs);
  if (!result.success) {
    const retry = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    throw new ApiError(429, message, "rate_limited", { retryAfter: retry });
  }
}

export function limiterKeys(ip: string) {
  return {
    login: (email: string) => `login:${ip}:${email.toLowerCase()}`,
    loginIp: () => `login-ip:${ip}`,
    signup: () => `signup:${ip}`,
    verify: (userId: string) => `verify:${ip}:${userId}`,
    recovery: (email: string) => `recovery:${ip}:${email.toLowerCase()}`,
    send: (userId: string) => `send:${userId}`,
    ingest: (ip: string) => `ingest:${ip}`,
    proxy: (userId: string) => `proxy:${userId}`,
    import: (userId: string) => `import:${userId}`,
  };
}
