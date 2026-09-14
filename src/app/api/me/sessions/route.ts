import { json, withAuth } from "@/server/http";
import { destroyAllSessions, createSession, requestMeta } from "@/server/auth/session";
export const DELETE = withAuth(async (_req, { user }) => { await destroyAllSessions(user.id); await createSession(user.id, await requestMeta()); return json({ ok: true }); });
