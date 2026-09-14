import { json, parseBody, withAuth } from "@/server/http";
import { deleteSet, setSchema, updateSet } from "@/server/services/training";
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => json(await updateSet(user.id, params.id, await parseBody(req, setSchema.partial()))));
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await deleteSet(user.id, params.id); return json({ ok: true }); });
