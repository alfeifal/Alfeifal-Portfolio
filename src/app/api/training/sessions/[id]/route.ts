import { json, parseBody, withAuth } from "@/server/http";
import { deleteSession, getSession, sessionPatchSchema, updateSession } from "@/server/services/training";
import { audit } from "@/server/audit";
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => json(await getSession(user.id, params.id)));
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  const body = await parseBody(req, sessionPatchSchema);
  const s = await updateSession(user.id, params.id, body);
  await audit({ userId: user.id, actor: "user", action: body.finished ? "training.session.finish" : "training.session.update", entityType: "workout_session", entityId: s.id, metadata: { finished: body.finished ?? null, durationMinutes: s.durationMinutes } });
  return json(s);
});
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await deleteSession(user.id, params.id); await audit({ userId: user.id, actor: "user", action: "training.session.delete", entityType: "workout_session", entityId: params.id }); return json({ ok: true }); });
