import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/server/auth/session";
import { PATHNAME_HEADER, requiredRole } from "@/server/auth/route-guards";
import { Shell } from "@/components/shell/Shell";
import { aiConfigured } from "@/server/ai/client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // An account created by an administrator cannot use the app until it replaces the password it was
  // handed. The API refuses those calls too, so this is the redirect, not the protection.
  if (user.mustChangePassword) redirect("/change-password");
  /*
   * Role guards that have to produce a 404 run here, not in the page.
   *
   * `loading.tsx` in this folder is a Suspense fallback above every page in the group, so the shell
   * has already been flushed with 200 by the time a page body could call `notFound()` — measured, see
   * `server/auth/route-guards.ts` (BUG-005). This layout is the last thing to run before that flush.
   *
   * The page keeps its own identical check. If the header is ever missing — a request that reached the
   * app without passing the proxy — this guard quietly does not apply and the page's does, so the
   * worst case is the old wrong status code, never a page shown to somebody who may not see it.
   */
  const role = requiredRole((await headers()).get(PATHNAME_HEADER));
  if (role === "admin" && !isAdmin(user)) notFound();
  return <Shell user={{ name: user.name, email: user.email, currency: user.currency, role: user.role }} aiConfigured={aiConfigured()}>{children}</Shell>;
}
