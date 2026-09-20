import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { getCurrentUser, isAdmin, type SessionUser } from "@/server/auth/session";
import { isTrustedOrigin } from "@/server/security/origin";
import { rateLimit, LIMITS } from "@/server/security/rate-limit";

export class AppError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what = "Resource") => new AppError(404, `${what} not found`);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, details);
export const forbidden = (msg = "Forbidden") => new AppError(403, msg);

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return NextResponse.json({ error: e.message, details: e.details ?? null }, { status: e.status });
  if (e instanceof z.ZodError) return NextResponse.json({ error: "Validation failed", details: e.issues }, { status: 400 });
  console.error("[api]", e);
  const msg = e instanceof Error ? e.message : "Internal error";
  return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "Internal error" : msg }, { status: 500 });
}

/**
 * The only routes an account still owing a password change may call. Everything else answers 403
 * with `code: "password_change_required"` so the client knows to send them to the change screen
 * rather than showing a generic failure.
 */
const PASSWORD_GATE_ALLOWED: { path: string; methods?: string[] }[] = [
  { path: "/api/me/password" },
  { path: "/api/auth/logout" },
  { path: "/api/me", methods: ["GET"] }, // reading the profile, not editing it
];
export const PASSWORD_CHANGE_REQUIRED = "password_change_required";

function passwordGate(req: Request, user: SessionUser) {
  if (!user.mustChangePassword) return null;
  const { pathname } = new URL(req.url);
  const allowed = PASSWORD_GATE_ALLOWED.find((a) => a.path === pathname);
  if (allowed && (!allowed.methods || allowed.methods.includes(req.method.toUpperCase()))) return null;
  return NextResponse.json(
    { error: "Set your own password before using the app.", code: PASSWORD_CHANGE_REQUIRED },
    { status: 403 },
  );
}

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: Request, ctx: { user: SessionUser; params: P }) => Promise<Response>;

/** Wraps a route handler with authentication, rate limiting and uniform error handling. */
export function withAuth<P = Record<string, string>>(handler: Handler<P>, opts: { limit?: keyof typeof LIMITS } = {}) {
  return async (req: Request, ctx?: Ctx<P>) => {
    try {
      // Before anything else that costs a query: a state-changing request must come from this app.
      // `SameSite=Lax` already stops a cross-site form or fetch from carrying the session cookie, but
      // it is one setting, applied by the browser, with a long history of per-browser exceptions — and
      // the requests behind this wrapper now include "delete that account and everything in it". The
      // origin check is the second lock, and it was written for exactly this and then never wired up.
      if (!isTrustedOrigin(req)) return NextResponse.json({ error: "Request blocked" }, { status: 403 });
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const l = LIMITS[opts.limit ?? "api"];
      const rl = rateLimit(`${opts.limit ?? "api"}:${user.id}`, l.limit, l.windowMs);
      if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
      const gated = passwordGate(req, user);
      if (gated) return gated;
      const params = ctx ? await ctx.params : ({} as P);
      return await handler(req, { user, params });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/**
 * Same as `withAuth`, plus the role check — on the server, from the database row the session resolves
 * to. Nothing the client sends (a header, a body field, local storage) can reach this decision.
 *
 * Being an administrator unlocks account management and nothing else: an admin route must never read
 * or write another user's module data.
 */
export function withAdmin<P = Record<string, string>>(handler: Handler<P>, opts: { limit?: keyof typeof LIMITS } = {}) {
  return withAuth<P>(async (req, ctx) => {
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return handler(req, ctx);
  }, opts);
}

export async function parseBody<T extends ZodType>(req: Request, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Invalid JSON body");
  }
  return schema.parse(raw);
}

export function parseQuery<T extends ZodType>(req: Request, schema: T): z.output<T> {
  const url = new URL(req.url);
  const obj: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (obj[k] = v));
  return schema.parse(obj);
}
