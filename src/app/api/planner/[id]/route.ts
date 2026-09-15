import { json, withAuth } from "@/server/http";
import { deletePlan, getPlan } from "@/server/services/planner";
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => json(await getPlan(user.id, params.id)));
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await deletePlan(user.id, params.id); return json({ ok: true }); });
