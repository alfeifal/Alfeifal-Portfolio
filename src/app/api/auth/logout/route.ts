import { NextResponse } from "next/server";
import { destroySession, getCurrentUser } from "@/server/auth/session";
import { audit } from "@/server/audit";

export async function POST() {
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit({ userId: user.id, actor: "user", action: "auth.logout" });
  return NextResponse.json({ ok: true });
}
