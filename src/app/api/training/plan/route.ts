import { json, parseBody, withAuth } from "@/server/http";
import { getPlanWithDays, planPatchSchema, seedRoutine, updatePlan } from "@/server/services/training";
import { z } from "zod";
export const GET = withAuth(async (_req, { user }) => { let p = await getPlanWithDays(user.id); if (!p) { await seedRoutine(user.id); p = await getPlanWithDays(user.id); } return json(p); });
export const PATCH = withAuth(async (req, { user }) => { const { id, ...rest } = await parseBody(req, planPatchSchema.extend({ id: z.string().uuid() })); return json(await updatePlan(user.id, id, rest)); });
