import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { dailyFlow, financialSummary, monthlyHistory, processRecurring } from "@/server/services/finance";
import { monthRange } from "@/lib/dates";
import { format } from "date-fns";
export const GET = withAuth(async (req, { user }) => {
  const q = query(req);
  await processRecurring(user.id, user.timezone);
  const r = monthRange(new Date());
  const range = { from: q.from ?? format(r.start, "yyyy-MM-dd"), to: q.to ?? format(r.end, "yyyy-MM-dd") };
  const [summary, daily, monthly] = await Promise.all([financialSummary(user.id, range), dailyFlow(user.id, range), monthlyHistory(user.id, 12)]);
  return json({ ...summary, daily, monthly });
});
