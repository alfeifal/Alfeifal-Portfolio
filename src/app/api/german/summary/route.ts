import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { germanSummary } from "@/server/services/german";
import { addDaysKey, todayKey } from "@/lib/dates";
export const GET = withAuth(async (req, { user }) => { const q = query(req); const to = q.to ?? todayKey(user.timezone); return json(await germanSummary(user.id, { from: q.from ?? addDaysKey(to, -6), to })); });
