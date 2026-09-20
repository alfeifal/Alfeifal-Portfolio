import { z } from "zod";
import { json, parseBody, withAdmin } from "@/server/http";
import { requestMeta } from "@/server/auth/session";
import { deleteUserAsAdmin, getUser, setUserActive, setUserRole } from "@/server/services/admin";

const patchSchema = z.object({ isActive: z.boolean().optional(), role: z.enum(["admin", "user"]).optional() })
  .refine((v) => v.isActive !== undefined || v.role !== undefined, "Nothing to change");

export const GET = withAdmin<{ id: string }>(async (_req, { params }) => json(await getUser(params.id)));

export const PATCH = withAdmin<{ id: string }>(async (req, { user, params }) => {
  const input = await parseBody(req, patchSchema);
  const meta = await requestMeta();
  let result = await getUser(params.id);
  if (input.role !== undefined) result = await setUserRole(user, params.id, input.role, meta.ip);
  if (input.isActive !== undefined) result = await setUserActive(user, params.id, input.isActive, meta.ip);
  return json(result);
});

/**
 * Irreversible. The service refuses to delete you or the last active administrator, and writes the
 * audit row — owned by the administrator, so it outlives the cascade — before anything is destroyed.
 *
 * The client is expected to have read `/deletion-summary` and shown it first, but that is a courtesy
 * to the person clicking, not a control: the guards that matter are on the server, here.
 */
export const DELETE = withAdmin<{ id: string }>(async (_req, { user, params }) => {
  const meta = await requestMeta();
  return json(await deleteUserAsAdmin(user, params.id, meta.ip));
});
