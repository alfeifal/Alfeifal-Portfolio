import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";

/**
 * The entry point for a Server Component that needs the signed-in user's data.
 *
 * Every server page goes through here rather than reading cookies or the database itself, so the
 * ownership rule is the same one the API routes enforce: the user comes from the session, never from
 * a parameter, and a request without one is sent to the login page instead of rendering anything.
 *
 * `getCurrentUser` is wrapped in React's `cache`, so the layout's call and the page's call inside the
 * same request resolve to one query rather than two.
 *
 * From here a page calls the ordinary domain services — the same functions the API routes call — so
 * there is one implementation of each query and no component talks to Drizzle directly.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Makes a service result identical to what the same data looks like after the API returns it.
 *
 * A Server Component passing a payload to a Client Component keeps rich values — `Date` stays a
 * `Date` — but the client's later refetch of the same path comes back as JSON, where that `Date` is a
 * string. Handing over the JSON form means the component sees one shape whether the data arrived with
 * the HTML or from a request afterwards, so a refresh cannot change how a value renders.
 */
export function asJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
