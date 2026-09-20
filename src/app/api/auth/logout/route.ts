import { NextResponse } from "next/server";
import { destroySession, getCurrentUser } from "@/server/auth/session";
import { isTrustedOrigin } from "@/server/security/origin";
import { audit } from "@/server/audit";

export async function POST(req: Request) {
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: "Request blocked" }, { status: 403 });
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit({ userId: user.id, actor: "user", action: "auth.logout" });
  return NextResponse.json({ ok: true });
}
