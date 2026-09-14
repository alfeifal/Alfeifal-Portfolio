import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { deleteMilestone, toggleMilestone } from "@/server/services/goals";
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => { const { done } = await parseBody(req, z.object({ done: z.boolean() })); return json(await toggleMilestone(user.id, params.id, done)); });
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await deleteMilestone(user.id, params.id); return json({ ok: true }); });
