import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { processRecurring } from "@/server/services/finance";
import { generateNotifications } from "@/server/services/notifications";
import { refreshNews, checkAlerts } from "@/server/services/market";
import { snapshotPortfolio } from "@/server/services/investing";
import { purgeExpiredSessions } from "@/server/auth/session";
import { purgeExpiredConversations } from "@/server/services/conversations";

/**
 * Scheduled maintenance (call hourly from Vercel Cron / GitHub Actions / any scheduler):
 * Authorization: Bearer $CRON_SECRET
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.replace(/^Bearer\s+/i, "");
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const all = await db.select().from(users);
  const report: Record<string, unknown> = { users: all.length };
  report.news = await refreshNews(true).catch((e) => `failed: ${(e as Error).message}`);
  await purgeExpiredSessions();
  report.purgedConversations = await purgeExpiredConversations(); // chat transcripts older than 24 h; action logs, memory and reports are kept
  for (const u of all) {
    report[u.id] = {
      recurring: await processRecurring(u.id, u.timezone).catch(() => "failed"),
      notifications: await generateNotifications(u.id, u.timezone).catch(() => "failed"),
      alerts: await checkAlerts(u.id).catch(() => "failed"),
      snapshot: await snapshotPortfolio(u.id, u.timezone).then(() => "ok").catch(() => "failed"),
    };
  }
  return NextResponse.json(report);
}
