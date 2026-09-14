import { z } from "zod";
import { eq } from "drizzle-orm";
import { AppError, json, notFound, parseBody, withAuth } from "@/server/http";
import { db } from "@/server/db";
import { marketNews } from "@/server/db/schema";
import { explainNews } from "@/server/ai/reports";
import { setNewsAi } from "@/server/services/market";
import { aiConfigured } from "@/server/ai/client";
export const POST = withAuth(async (req) => {
  if (!aiConfigured()) throw new AppError(503, "AI not configured");
  const { id } = await parseBody(req, z.object({ id: z.string().uuid() }));
  const [n] = await db.select().from(marketNews).where(eq(marketNews.id, id));
  if (!n) throw notFound("News item");
  if (n.aiSummary) return json({ aiSummary: n.aiSummary, aiWhyItMatters: n.aiWhyItMatters });
  const ai = await explainNews(n);
  await setNewsAi(id, ai);
  return json(ai);
}, { limit: "ai" });
