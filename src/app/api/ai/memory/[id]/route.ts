import { json, parseBody, withAuth } from "@/server/http";
import { forgetMemory, memorySchema, updateMemory } from "@/server/services/memory";
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => json(await updateMemory(user.id, params.id, await parseBody(req, memorySchema.partial()))));
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await forgetMemory(user.id, params.id); return json({ ok: true }); });
