import { NextResponse } from "next/server";
import { authenticate, loginSchema, recordLogin } from "@/server/services/users";
import { createSession, requestMeta } from "@/server/auth/session";
import { errorResponse, parseBody } from "@/server/http";
import { isTrustedOrigin } from "@/server/security/origin";
import { LIMITS } from "@/server/security/rate-limit";
import { checkRateLimit } from "@/server/security/rate-limit-shared";
import { audit } from "@/server/audit";

export async function POST(req: Request) {
  try {
    // Same second lock the authenticated routes use. A cross-site request that forces somebody into
    // an account they did not choose is a real attack even before there is a session to steal.
    if (!isTrustedOrigin(req)) return NextResponse.json({ error: "Request blocked" }, { status: 403 });
    const meta = await requestMeta();
    const rl = await checkRateLimit(`login:${meta.ip ?? "unknown"}`, LIMITS.login.limit, LIMITS.login.windowMs);
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
