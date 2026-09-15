import { z } from "zod";
import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { analyticsOverview, type Period } from "@/server/services/analytics";

const paramsSchema = z.object({
  period: z.enum(["week", "month", "quarter", "year", "custom"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Everything Analytics shows, for one window, in a single round trip. Read-only and user-scoped. */
export const GET = withAuth(async (req, { user }) => {
  const parsed = paramsSchema.safeParse(query(req));
  const p = parsed.success ? parsed.data : {};
  return json(await analyticsOverview(user.id, { period: (p.period as Period) ?? "week", from: p.from, to: p.to }, user.timezone));
});
