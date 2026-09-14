import { json, parseBody, withAuth } from "@/server/http";
import { nutritionGoals, nutritionGoalsSchema } from "@/server/services/nutrition";
import { patchPreferences } from "@/server/services/users";
export const GET = withAuth(async (_req, { user }) => json(await nutritionGoals(user.id)));
export const PATCH = withAuth(async (req, { user }) => { const g = await parseBody(req, nutritionGoalsSchema); await patchPreferences(user.id, { nutritionGoals: g }); return json(g); });
