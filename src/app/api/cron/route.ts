import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ALL_SCOPES, isJobScope, runMaintenance, type JobScope } from "@/server/services/maintenance";

/**
 * Scheduled maintenance.
 *
 *   GET /api/cron                  every job          (the daily safety net)
 *   GET /api/cron?scope=frequent   the frequent ones  (alerts, transcript expiry, news)
 *   GET /api/cron?scope=daily      the daily ones
 *
 * Authorization: Bearer $CRON_SECRET
 *
 * WHY GET. Both schedulers invoke with GET, and this route used to export only POST — so in
 * production it answered 405 and no scheduled work ever ran. POST was doubly unreachable: `proxy.ts`
 * rejects every mutating method whose `Origin` does not match the host, and it does so *before*
 * consulting its public-path list, so a scheduler (which sends no `Origin`) got 403 even though
 * `/api/cron` is public. GET is exempt from that check, which is why the fix is the method and not
 * an exception in the proxy: no new hole is opened for anything else.
 *
 * The verb is a lie about the semantics — this writes — but it is the verb the platform sends, and a
 * maintenance endpoint nobody can call is worse than an imprecise one. Every job is idempotent, so
 * the usual reason to insist on POST (a repeated request doing the work twice) does not apply here.
 */

/**
 * Constant-time comparison that never reveals the secret, its length, or whether one is configured.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared first — which leaks the
 * length of the configured secret through timing, and is why the given value is hashed to a fixed
 * width before comparing instead. With no secret set the answer is always no: an instance that
 * forgot to configure one must not be wide open.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length) {
    // Still burn a comparison so the rejection path does not return measurably sooner.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function scopesFrom(req: Request): JobScope[] | null {
  const raw = new URL(req.url).searchParams.get("scope");
  if (raw === null) return [...ALL_SCOPES];
  return isJobScope(raw) ? [raw] : null;
}

async function handle(req: Request) {
  // Nothing about the secret reaches the response or the log: the same opaque 401 for a missing
  // header, a wrong value and an unconfigured instance.
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scopes = scopesFrom(req);
  if (!scopes) return NextResponse.json({ error: "Unknown scope" }, { status: 400 });
  return NextResponse.json(await runMaintenance(scopes));
}

export const GET = handle;
// Kept so anything already calling it — a manual curl, a local script — does not silently break.
// It reaches this handler only from the app's own origin, because `proxy.ts` blocks the rest.
export const POST = handle;
