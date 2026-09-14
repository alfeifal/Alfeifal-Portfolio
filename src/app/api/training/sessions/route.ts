import { json, parseBody, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { sessionStartSchema, startSession, workoutHistory } from "@/server/services/training";
export const GET = withAuth(async (req, { user }) => { const q = query(req); return json(await workoutHistory(user.id, { limit: q.limit ? Number(q.limit) : undefined, from: q.from, to: q.to })); });
export const POST = withAuth(async (req, { user }) => json(await startSession(user.id, await parseBody(req, sessionStartSchema), user.timezone), { status: 201 }));
