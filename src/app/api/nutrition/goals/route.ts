import { json, parseBody, withAuth } from "@/server/http";
import { nutritionGoals, nutritionGoalsSchema, updateNutritionGoals } from "@/server/services/nutrition";
import { audit } from "@/server/audit";
export const GET = withAuth(async (_req, { user }) => json(await nutritionGoals(user.id)));
export const PATCH = withAuth(async (req, { user }) => { const input = await parseBody(req, nutritionGoalsSchema); const r = await updateNutritionGoals(user.id, input); await audit({ userId: user.id, actor: "user", action: "nutrition.goals.update", entityType: "user", entityId: user.id, metadata: r }); return json(r.goals); });
