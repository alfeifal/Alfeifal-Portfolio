import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { dailyNutrition } from "@/server/services/nutrition";
import { todayKey } from "@/lib/dates";
export const GET = withAuth(async (req, { user }) => json(await dailyNutrition(user.id, query(req).date ?? todayKey(user.timezone))));
