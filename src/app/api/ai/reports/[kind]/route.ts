import { AppError, json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { dailyReview, latestReport, listReports, marketBrief, weeklyReview } from "@/server/ai/reports";
import { aiConfigured } from "@/server/ai/client";
const KINDS = ["daily_review", "weekly_review", "market_brief"] as const;
export const GET = withAuth<{ kind: string }>(async (req, { user, params }) => {
  if (!KINDS.includes(params.kind as (typeof KINDS)[number])) throw new AppError(404, "Unknown report");
  const q = query(req);
  return json(q.all === "1" ? await listReports(user.id, params.kind) : await latestReport(user.id, params.kind, q.period));
});
export const POST = withAuth<{ kind: string }>(async (req, { user, params }) => {
  if (!aiConfigured()) throw new AppError(503, "AI not configured");
  const q = query(req);
  switch (params.kind) {
    case "daily_review": return json(await dailyReview(user, q.date));
    case "weekly_review": return json(await weeklyReview(user, q.date));
    case "market_brief": return json(await marketBrief(user));
    default: throw new AppError(404, "Unknown report");
  }
}, { limit: "ai" });
