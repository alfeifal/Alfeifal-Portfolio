import { json, parseBody, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { sessionStartSchema, startSession, workoutHistory } from "@/server/services/training";
import { audit } from "@/server/audit";
export const GET = withAuth(async (req, { user }) => { const q = query(req); return json(await workoutHistory(user.id, { limit: q.limit ? Number(q.limit) : undefined, from: q.from, to: q.to })); });
export const POST = withAuth(async (req, { user }) => {
  const s = await startSession(user.id, await parseBody(req, sessionStartSchema), user.timezone);
  await audit({ userId: user.id, actor: "user", action: "training.session.start", entityType: "workout_session", entityId: s.id, metadata: { date: s.date, dayName: s.dayName } });
  return json(s, { status: 201 });
});
