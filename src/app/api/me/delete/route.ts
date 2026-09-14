import { z } from "zod";
import { json, parseBody, withAuth, AppError } from "@/server/http";
import { deleteAccountAndData } from "@/server/services/export";
import { verifyPassword } from "@/server/auth/password";
import { destroySession } from "@/server/auth/session";
export const POST = withAuth(async (req, { user }) => {
  const { password, confirm } = await parseBody(req, z.object({ password: z.string(), confirm: z.literal("DELETE") }));
  if (!(await verifyPassword(password, user.passwordHash))) throw new AppError(400, "Incorrect password");
  await destroySession();
  await deleteAccountAndData(user.id);
  return json({ ok: true, confirm });
});
