import { json, parseBody, withAuth } from "@/server/http";
import { deleteSession, getSession, sessionPatchSchema, updateSession } from "@/server/services/training";
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => json(await getSession(user.id, params.id)));
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => json(await updateSession(user.id, params.id, await parseBody(req, sessionPatchSchema))));
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await deleteSession(user.id, params.id); return json({ ok: true }); });
