import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { ChangePasswordForm } from "./form";

/**
 * The one screen an account created by an administrator sees first.
 *
 * It lives outside the app shell on purpose: there is no navigation to slip past, and the API refuses
 * every other route while the flag is set, so this is a wall rather than a suggestion. An account that
 * does not owe a change is sent back to where it was going — the page is not a dead end for anyone
 * who arrives at it by typing the URL.
 */
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect("/settings");
  return <ChangePasswordForm email={user.email} />;
}
