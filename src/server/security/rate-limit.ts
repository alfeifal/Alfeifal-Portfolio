/**
 * In-memory sliding-window rate limiter. Good for a single-instance private deployment.
 * For multi-instance deployments replace the store with Redis/Upstash (same interface).
 */
type Bucket = { hits: number[]; };
const store = new Map<string, Bucket>();

export interface RateLimitResult { ok: boolean; remaining: number; retryAfterSec: number }

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const b = store.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    store.set(key, b);
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((windowMs - (now - b.hits[0])) / 1000) };
  }
  b.hits.push(now);
  store.set(key, b);
  if (store.size > 10000) for (const [k, v] of store) if (v.hits.every((t) => now - t > windowMs)) store.delete(k);
  return { ok: true, remaining: limit - b.hits.length, retryAfterSec: 0 };
}

export const LIMITS = {
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  signup: { limit: 5, windowMs: 60 * 60 * 1000 },
  ai: { limit: 60, windowMs: 60 * 60 * 1000 },
  api: { limit: 600, windowMs: 60 * 1000 },
  market: { limit: 60, windowMs: 60 * 1000 },
} as const;
