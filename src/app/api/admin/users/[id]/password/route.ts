import { json, withAdmin } from "@/server/http";
import { requestMeta } from "@/server/auth/session";
import { resetUserPassword } from "@/server/services/admin";

/**
 * Issues a new temporary password for an account, forces its rotation and signs the account out
 * everywhere. This is the instance's only password recovery path — there is no email infrastructure
 * here, so there is no reset link to send.
 *
 * The response carries the new password once. Like the one handed out at account creation it is never
 * audited, never logged and never stored unhashed, so it cannot be recovered from this route a second
 * time; losing it means issuing another.
 */
export const POST = withAdmin<{ id: string }>(async (_req, { user, params }) => {
  const meta = await requestMeta();
  return json(await resetUserPassword(user, params.id, meta.ip));
});
