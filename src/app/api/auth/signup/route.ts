import { NextResponse } from "next/server";
import { createUser, signupSchema } from "@/server/services/users";
import { createSession, requestMeta } from "@/server/auth/session";
import { errorResponse, parseBody } from "@/server/http";
import { isTrustedOrigin } from "@/server/security/origin";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { audit } from "@/server/audit";
import { bootstrapUserData } from "@/server/services/bootstrap";

export async function POST(req: Request) {
  try {
    // Same second lock the authenticated routes use. A cross-site request that forces somebody into
    // an account they did not choose is a real attack even before there is a session to steal.
    if (!isTrustedOrigin(req)) return NextResponse.json({ error: "Request blocked" }, { status: 403 });
    const meta = await requestMeta();
    const rl = rateLimit(`signup:${meta.ip ?? "unknown"}`, LIMITS.signup.limit, LIMITS.signup.windowMs);
    if (!rl.ok) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    const input = await parseBody(req, signupSchema);
    const user = await createUser(input);
    await bootstrapUserData(user.id);
    await createSession(user.id, meta);
    await audit({ userId: user.id, actor: "user", action: "auth.signup", ip: meta.ip });
    return NextResponse.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
