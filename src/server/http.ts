import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { getCurrentUser, isAdmin, type SessionUser } from "@/server/auth/session";
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

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: Request, ctx: { user: SessionUser; params: P }) => Promise<Response>;

/** Wraps a route handler with authentication, rate limiting and uniform error handling. */
export function withAuth<P = Record<string, string>>(handler: Handler<P>, opts: { limit?: keyof typeof LIMITS } = {}) {
  return async (req: Request, ctx?: Ctx<P>) => {
    try {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const l = LIMITS[opts.limit ?? "api"];
      const rl = rateLimit(`${opts.limit ?? "api"}:${user.id}`, l.limit, l.windowMs);
      if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
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
