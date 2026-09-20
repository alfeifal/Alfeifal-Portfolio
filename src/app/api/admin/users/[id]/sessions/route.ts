import { json, withAdmin } from "@/server/http";
import { requestMeta } from "@/server/auth/session";
import { revokeUserSessions } from "@/server/services/admin";

/**
 * Ends every live session of an account without changing the account itself: the owner signs back in
 * with the password they already have. For a lost device, not for a lost account — that is a password
 * reset, and for an account that should not come back at all, a deactivation.
 *
 * Refused on your own account; Settings has "sign out other devices", which does not log you out of
 * the page you are standing on.
 */
export const DELETE = withAdmin<{ id: string }>(async (_req, { user, params }) => {
  const meta = await requestMeta();
  return json(await revokeUserSessions(user, params.id, meta.ip));
});
