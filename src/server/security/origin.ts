/**
 * CSRF defence: cookies are SameSite=Lax AND every state-changing request must carry an
 * Origin/Referer that matches the request host (or an explicitly allowed origin).
 *
 * This is the only implementation. `src/proxy.ts` calls it at the edge and each mutating route calls
 * it again; they used to be two separate copies of the rule and had already drifted apart in two ways
 * (BUG-018): a malformed `Referer` threw here and answered 403 there, and an `ALLOWED_ORIGINS` entry
 * written without its default port matched here and not there. Two copies of a security rule are not
 * defence in depth once they disagree — they are a rule nobody can state.
 */

/** Never throws: a header this cannot parse is a header it does not trust. */
function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isTrustedOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  // `Origin` is what browsers send on a cross-site write; `Referer` is the fallback for the few that
  // omit it. Both are compared as origins, so a path or a default port cannot change the answer.
  const origin = originOf(req.headers.get("origin")) ?? originOf(req.headers.get("referer"));
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host && new URL(origin).host === host) return true;
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => originOf(s.trim())).filter(Boolean);
  return allowed.includes(origin);
}
