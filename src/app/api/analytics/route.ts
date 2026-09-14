import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { analyticsOverview, type Period } from "@/server/services/analytics";
export const GET = withAuth(async (req, { user }) => { const p = (query(req).period ?? "week") as Period; return json(await analyticsOverview(user.id, ["week", "month", "quarter", "year"].includes(p) ? p : "week", user.timezone)); });
