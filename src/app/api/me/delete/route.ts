import { z } from "zod";
import { json, parseBody, withAuth, AppError } from "@/server/http";
import { deleteAccountAndData } from "@/server/services/export";
import { activeAdminCount } from "@/server/services/admin";
import { verifyPassword } from "@/server/auth/password";
import { destroySession, isAdmin } from "@/server/auth/session";

/**
 * Deleting your own account, data and all. The password check is the consent.
 *
 * The one refusal: the last active administrator cannot delete themselves. On a single-account
 * instance that would erase the instance's only owner, and on a shared one it would leave every
 * remaining account with nobody able to administer it — with no way back in. Hand the role to
 * somebody else from /admin first. This mirrors the guards on deactivation and demotion, which the
 * delete path would otherwise walk straight past.
 */
export const POST = withAuth(async (req, { user }) => {
  const { password, confirm } = await parseBody(req, z.object({ password: z.string(), confirm: z.literal("DELETE") }));
  if (!(await verifyPassword(password, user.passwordHash))) throw new AppError(400, "Incorrect password");
  if (isAdmin(user) && (await activeAdminCount()) <= 1) {
    throw new AppError(400, "This is the last active administrator. Make another account an administrator first, then delete this one.");
  }
  await destroySession();
  await deleteAccountAndData(user.id);
  return json({ ok: true, confirm });
});
