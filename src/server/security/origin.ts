/**
 * CSRF defence: cookies are SameSite=Lax AND every state-changing request must carry an
 * Origin/Referer that matches the request host (or an explicitly allowed origin).
 */
export function isTrustedOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const origin = req.headers.get("origin") ?? (req.headers.get("referer") ? new URL(req.headers.get("referer")!).origin : null);
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const allowed = new Set((process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  try {
    const o = new URL(origin);
    if (host && o.host === host) return true;
    return allowed.has(o.origin);
  } catch {
    return false;
  }
}
