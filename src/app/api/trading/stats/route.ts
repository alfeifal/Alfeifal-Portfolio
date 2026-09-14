import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { tradingStatistics } from "@/server/services/trading";
export const GET = withAuth(async (req, { user }) => { const q = query(req); return json(await tradingStatistics(user.id, q.mode === "real" ? "real" : "paper", { from: q.from, to: q.to })); });
