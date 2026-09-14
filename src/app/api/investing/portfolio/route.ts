import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { portfolio, portfolioHistory, snapshotPortfolio } from "@/server/services/investing";
export const GET = withAuth(async (req, { user }) => { const refresh = query(req).refresh === "1"; const p = refresh ? await snapshotPortfolio(user.id, user.timezone) : await portfolio(user.id); return json({ ...p, history: await portfolioHistory(user.id) }); }, { limit: "market" });
