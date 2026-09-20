import { notFound } from "next/navigation";
import { isAdmin } from "@/server/auth/session";
import { requireUser, asJson } from "@/server/page-data";
import { adminStats, listUsers, sessionCounts } from "@/server/services/admin";
import { AdminClient, type Payload } from "./admin-client";

/**
 * Account administration.
 *
 * The guard is here, on the server, before anything renders — and again on every `/api/admin` route,
 * because a page guard only protects the page. A signed-in non-administrator gets the 404 page rather
 * than a "forbidden" screen: whether this instance has an admin area is not their business.
 *
 * What this page deliberately cannot do: read or change anybody's tasks, money, training, journal or
 * memory. It manages accounts. An administrator browsing the Personal OS sees their own data exactly
 * like every other user.
 */
export default async function AdminPage() {
  const user = await requireUser();
  if (!isAdmin(user)) notFound();
  const [users, stats, sessions] = await Promise.all([listUsers(), adminStats(), sessionCounts()]);
  // `asJson` is what the API would return, so the dates arrive as the strings the client expects.
  return <AdminClient initial={asJson({ users, stats, sessions }) as unknown as Payload} meId={user.id} />;
}
