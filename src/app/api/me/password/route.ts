import { json, parseBody, withAuth } from "@/server/http";
import { changePassword, passwordChangeSchema } from "@/server/services/users";
import { destroyAllSessions, createSession, requestMeta } from "@/server/auth/session";
import { audit } from "@/server/audit";
/**
 * Every other session is dropped and a fresh one is issued for this device, so a password change
 * really ends access from anywhere the old one was used — including whoever handed over a temporary
 * one. Only the fact of the change is audited; no password material goes near the log.
 */
export const POST = withAuth(async (req, { user }) => {
  const { wasForced } = await changePassword(user.id, await parseBody(req, passwordChangeSchema));
  await destroyAllSessions(user.id);
  await createSession(user.id, await requestMeta());
  await audit({ userId: user.id, actor: "user", action: "auth.password_change", metadata: { forced: wasForced } });
  return json({ ok: true, wasForced });
});
