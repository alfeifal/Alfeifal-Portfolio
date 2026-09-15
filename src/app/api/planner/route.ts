import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { currentPlan, listPlans, planHorizonSchema } from "@/server/services/planner";

/** The plan in force for a period (default: today), plus the user's recent plans. */
export const GET = withAuth(async (req, { user }) => {
  const q = query(req);
  const horizon = planHorizonSchema.catch("day").parse(q.horizon);
  const [current, recent] = await Promise.all([
    currentPlan(user.id, { horizon, periodKey: q.period, tz: user.timezone }),
    listPlans(user.id, { horizon, limit: 20 }),
  ]);
  return json({ current, recent });
});
