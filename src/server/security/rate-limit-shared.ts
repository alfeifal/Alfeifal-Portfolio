import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { rateLimits } from "@/server/db/schema";
import { rateLimit, type RateLimitResult } from "./rate-limit";

/**
 * Rate limiting that holds across instances, counted in the database the request already talks to.
 *
 * WHY POSTGRES AND NOT REDIS. Upstash's free tier is 500k commands a month and a sliding-window check
 * costs four of them, which is about 4,100 checks a day — and this app runs one check on every
 * authenticated request. Running out mid-month would leave a *security control* with no backend, and
 * the only two ways out of that are failing open (no protection) or failing closed (an outage). The
 * database has no such cliff, adds no vendor, and is already on the request path.
 *
 * THE ALGORITHM is a weighted sliding window, the same approximation a CDN uses. Each bucket keeps
 * one counter row per fixed window. A check bumps the current window's counter and reads the previous
 * window's, then weights the old count by however much of it still overlaps the trailing `windowMs`:
 *
 *     estimate = previous × (1 − elapsedFraction) + current
 *
 * A plain fixed window would forgive a burst that straddles a boundary — twice the limit in a moment,
 * as long as it lands either side of the tick. This does not. It costs one round trip, one row, and
 * one statement.
 *
 * WHAT IT IS NOT. Exact. The previous window is weighted, not replayed, so the estimate can be off by
 * a fraction of a window's traffic in either direction. For the limits this app sets — 10 logins per
 * 15 minutes, 60 AI calls an hour — that is immaterial; for a limit of 2 it would not be.
 */

/** Windows are aligned to absolute time so every instance agrees on where a window starts. */
const windowStartFor = (now: number, windowMs: number) => new Date(Math.floor(now / windowMs) * windowMs);

/**
 * True when the app has a database configured at all. The tests and any offline run fall straight
 * through to the in-memory limiter rather than spending a failed connection on every request.
 */
const hasDb = () => Boolean(process.env.DATABASE_URL || process.env.TEST_DATABASE_URL);

/** Logged once per process, not per request: a limiter that floods the log is its own outage. */
let warnedFallback = false;
function fellBack(e: unknown): RateLimitResult | null {
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn("[rate-limit] shared counter unavailable, falling back to per-instance limiting:", e instanceof Error ? e.message : e);
  }
  return null;
}

/**
 * The call the app makes. Same arguments and same result shape as `rateLimit`, which it falls back to.
 *
 * A rejected request still counts. The in-memory limiter returns early without recording, so a client
 * that keeps hammering drains its window anyway; here the window has to actually roll before the
 * client is let back in. That is the stricter reading of a rate limit and the one that makes sense
 * for the thing it defends against.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  if (!hasDb()) return rateLimit(key, limit, windowMs);

  const now = Date.now();
  const start = windowStartFor(now, windowMs);
  const previousStart = new Date(start.getTime() - windowMs);
  const elapsed = (now - start.getTime()) / windowMs;

  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ bucket: key, windowStart: start, hits: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.bucket, rateLimits.windowStart],
        set: { hits: sql`${rateLimits.hits} + 1` },
      })
      .returning({ hits: rateLimits.hits });

    const [prev] = await db
      .select({ hits: rateLimits.hits })
      .from(rateLimits)
      .where(and(eq(rateLimits.bucket, key), eq(rateLimits.windowStart, previousStart)));

    const current = row?.hits ?? 1;
    const estimate = (prev?.hits ?? 0) * Math.max(0, 1 - elapsed) + current;
    if (estimate > limit) {
      // Enough of the window has to roll off for the estimate to fall back under the limit. Waiting
      // for the current window to end always suffices, and is never more than one window away.
      const retryAfterSec = Math.max(1, Math.ceil((start.getTime() + windowMs - now) / 1000));
      return { ok: false, remaining: 0, retryAfterSec };
    }
    return { ok: true, remaining: Math.max(0, Math.floor(limit - estimate)), retryAfterSec: 0 };
  } catch (e) {
    fellBack(e);
    return rateLimit(key, limit, windowMs);
  }
}

/**
 * Drops counter rows whose window can no longer affect any decision.
 *
 * Only the current and the immediately previous window are ever read, so anything older than two
 * windows is dead weight. The longest window the app configures is an hour, so a day's margin is
 * generous by a wide margin and keeps the job a single statement. Run from daily maintenance.
 */
export async function purgeRateLimits(olderThanMs = 24 * 60 * 60 * 1000) {
  if (!hasDb()) return 0;
  const rows = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(Date.now() - olderThanMs)))
    .returning({ bucket: rateLimits.bucket });
  return rows.length;
}
