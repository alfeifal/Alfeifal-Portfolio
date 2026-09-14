import { NextResponse } from "next/server";
import { signupAllowed, userCount } from "@/server/services/users";

/** Public: tells the login page whether the instance still needs its first account. */
export async function GET() {
  const n = await userCount();
  return NextResponse.json({ needsSetup: n === 0, signupAllowed: await signupAllowed() });
}
