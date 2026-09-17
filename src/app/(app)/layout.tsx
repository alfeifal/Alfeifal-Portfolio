import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { Shell } from "@/components/shell/Shell";
import { aiConfigured } from "@/server/ai/client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // An account created by an administrator cannot use the app until it replaces the password it was
  // handed. The API refuses those calls too, so this is the redirect, not the protection.
  if (user.mustChangePassword) redirect("/change-password");
  return <Shell user={{ name: user.name, email: user.email, currency: user.currency, role: user.role }} aiConfigured={aiConfigured()}>{children}</Shell>;
}
