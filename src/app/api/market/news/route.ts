import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { listNews, refreshNews } from "@/server/services/market";
export const GET = withAuth(async (req, { user }) => {
  void user;
  const q = query(req);
  let refreshed = 0;
  try { refreshed = await refreshNews(q.refresh === "1"); } catch (e) { console.warn("[news] refresh failed", e); }
  const symbols = q.symbols ? q.symbols.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  return json({ refreshed, items: await listNews({ category: q.category, q: q.q, symbols, sinceHours: q.sinceHours ? Number(q.sinceHours) : undefined, limit: q.limit ? Number(q.limit) : 80 }) });
}, { limit: "market" });
