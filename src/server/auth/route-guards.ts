/**
 * Which page paths need a role, and the one place that knows.
 *
 * WHY THIS IS NOT SIMPLY A CHECK INSIDE THE PAGE. `notFound()` can only set a 404 status while the
 * response is still uncommitted. `src/app/(app)/loading.tsx` is a Suspense fallback above every page
 * in that group, so the shell is flushed — with 200 — before any page body runs. Measured against a
 * production build on 2026-10-02 (BUG-005):
 *
 *   /admin as a signed-in non-administrator   200, carrying the not-found page
 *   the same request with loading.tsx removed 404
 *   /no-such-page (no route matches at all)   404 either way
 *
 * So the status is decided before the page exists. The group's *layout* is the last thing that runs
 * before that flush, which is why the guard that has to affect the status lives there and therefore
 * has to be told which paths it covers. The page keeps its own `notFound()` as well: this table
 * fixes the status code, it is not the protection.
 */
import type { SessionUser } from "./session";

export type GuardedRole = NonNullable<SessionUser["role"]>;

/** Page path prefixes that only a role may see. API routes guard themselves, per route. */
export const ROLE_GUARDED_PATHS: { prefix: string; role: GuardedRole }[] = [{ prefix: "/admin", role: "admin" }];

/**
 * The role `pathname` requires, or null.
 *
 * Matches the prefix exactly or as a path segment, so `/administration` and `/admin-tools` are not
 * covered by `/admin` — a prefix compared with `startsWith` alone would claim both.
 */
export function requiredRole(pathname: string | null | undefined): GuardedRole | null {
  if (!pathname) return null;
  const hit = ROLE_GUARDED_PATHS.find((g) => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`));
  return hit?.role ?? null;
}

/** The header the proxy puts the request path in, because a layout cannot read it any other way. */
export const PATHNAME_HEADER = "x-pos-pathname";
