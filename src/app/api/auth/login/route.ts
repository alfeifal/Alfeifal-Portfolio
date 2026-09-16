import { NextResponse } from "next/server";
import { authenticate, loginSchema, recordLogin } from "@/server/services/users";
import { createSession, requestMeta } from "@/server/auth/session";
import { errorResponse, parseBody } from "@/server/http";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { audit } from "@/server/audit";

export async function POST(req: Request) {
  try {
    const meta = await requestMeta();
    const rl = rateLimit(`login:${meta.ip ?? "unknown"}`, LIMITS.login.limit, LIMITS.login.windowMs);
    if (!rl.ok) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
    const input = await parseBody(req, loginSchema);
    const user = await authenticate(input);
    await createSession(user.id, meta);
    await recordLogin(user.id);
    await audit({ userId: user.id, actor: "user", action: "auth.login", ip: meta.ip });
    return NextResponse.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    return errorResponse(e);
  }
}
