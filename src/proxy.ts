import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "pos_session";
const PUBLIC_PATHS = ["/login", "/setup", "/api/auth/login", "/api/auth/signup", "/api/auth/status", "/api/cron", "/manifest.webmanifest", "/sw.js", "/icons", "/offline"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) || pathname.startsWith("/_next") || pathname === "/favicon.ico";
}

/**
 * Edge-level gate: unauthenticated requests never reach a private page or API.
 * The cookie is only checked for presence here; the real session lookup happens server-side.
 * Mutating requests must also pass the same-origin check (CSRF).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const origin = req.headers.get("origin") ?? (req.headers.get("referer") ? safeOrigin(req.headers.get("referer")!) : null);
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const ok = origin && ((host && safeHost(origin) === host) || allowed.includes(origin));
    if (!ok) return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }

  if (isPublic(pathname)) return NextResponse.next();

  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (!hasCookie) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

function safeOrigin(u: string) { try { return new URL(u).origin; } catch { return null; } }
function safeHost(u: string) { try { return new URL(u).host; } catch { return null; } }

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/).*)"] };
