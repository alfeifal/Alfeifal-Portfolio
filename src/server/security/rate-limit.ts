/**
 * Rate limiting, in two layers.
 *
 * `rateLimit` below is the original in-memory sliding window, unchanged and still exported: it is
 * exact, it costs nothing, and it is now the *fallback*. What it is not, and never was, is shared.
 * The store is a `Map` in one process, so on a serverless platform each warm instance keeps its own
 * tally and the real ceiling is the configured limit times however many instances exist — a number
 * nobody can observe or predict. That is a per-instance limit, and this file will not call it
 * anything else.
 *
 * `checkRateLimit` in `./rate-limit-shared` is the one the app calls. It counts in Postgres, so the
 * limit holds across every instance, and it falls back to this map when the database cannot be
 * reached — degrading to per-instance protection rather than to none.
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
