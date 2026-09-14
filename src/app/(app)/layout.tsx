import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { Shell } from "@/components/shell/Shell";
import { aiConfigured } from "@/server/ai/client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <Shell user={{ name: user.name, email: user.email, currency: user.currency }} aiConfigured={aiConfigured()}>{children}</Shell>;
}
