import { json, parseBody, withAuth } from "@/server/http";
import { nutritionGoals, nutritionGoalsSchema } from "@/server/services/nutrition";
import { patchPreferences } from "@/server/services/users";
import { audit } from "@/server/audit";
export const GET = withAuth(async (_req, { user }) => json(await nutritionGoals(user.id)));
export const PATCH = withAuth(async (req, { user }) => { const g = await parseBody(req, nutritionGoalsSchema); await patchPreferences(user.id, { nutritionGoals: g }); await audit({ userId: user.id, actor: "user", action: "nutrition.goals.update", entityType: "user", entityId: user.id, metadata: g }); return json(g); });
