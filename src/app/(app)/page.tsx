import { dashboardData } from "@/server/services/dashboard";
import { asJson, requireUser } from "@/server/page-data";
import HomeClient from "./home-client";

/**
 * Home — a Server Component that loads the data and hands it to the interactive tree.
 *
 * Home was the app's most-used screen and its slowest path to content: the document carried no data,
 * so the dashboard only appeared after ~814 kB of JavaScript had downloaded, hydrated and then made a
 * request. Loading it here puts it in the HTML that answers the navigation and removes that request.
 *
 * The tree below stays on the client — it animates, completes tasks optimistically and needs the
 * shell's context — which is why this is a split rather than a conversion. There is deliberately no
 * Suspense boundary: `dashboardData` measured 21 ms after phase 3.9, so streaming the sections
 * separately would add machinery without a delay worth hiding.
 */
export default async function HomePage() {
  const user = await requireUser();
  const initial = await dashboardData(user);
  // Handed over in the API's JSON shape, so a later refetch renders identically.
  return <HomeClient initial={asJson(initial) as never} />;
}
