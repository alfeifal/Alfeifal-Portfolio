import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER } from "@/server/auth/route-guards";
import { isTrustedOrigin } from "@/server/security/origin";

const SESSION_COOKIE = "pos_session";
const PUBLIC_PATHS = ["/login", "/setup", "/api/auth/login", "/api/auth/signup", "/api/auth/status", "/api/cron", "/manifest.webmanifest", "/sw.js", "/icons", "/offline"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) || pathname.startsWith("/_next") || pathname === "/favicon.ico";
}

/**
 * Edge-level gate: unauthenticated requests never reach a private page or API.
 * The cookie is only checked for presence here; the real session lookup happens server-side.
 * Mutating requests must also pass the same-origin check (CSRF).
 *
 * It also stamps the request path onto a header, because a layout has no other way to read it, and
 * the layout is the only thing that runs before the response is committed. See
 * `server/auth/route-guards.ts` for why that matters (BUG-005).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // One rule, imported — not a second copy of it. See `server/security/origin.ts` (BUG-018).
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });

  if (isPublic(pathname)) return NextResponse.next();

  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (!hasCookie) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return forward(req);
}

/**
 * Passes the request through with its path attached.
 *
 * The header is always written, never merged: a client that sends one of its own has it replaced
 * here, so a layout reading it cannot be told the request was for some other route.
 */
function forward(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set(PATHNAME_HEADER, req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/).*)"] };
