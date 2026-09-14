import { json, parseBody, withAuth } from "@/server/http";
import { changePassword, passwordChangeSchema } from "@/server/services/users";
import { destroyAllSessions, createSession, requestMeta } from "@/server/auth/session";
import { audit } from "@/server/audit";
export const POST = withAuth(async (req, { user }) => { await changePassword(user.id, await parseBody(req, passwordChangeSchema)); await destroyAllSessions(user.id); await createSession(user.id, await requestMeta()); await audit({ userId: user.id, actor: "user", action: "auth.password_change" }); return json({ ok: true }); });
