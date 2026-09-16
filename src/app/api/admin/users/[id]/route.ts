import { z } from "zod";
import { json, parseBody, withAdmin } from "@/server/http";
import { requestMeta } from "@/server/auth/session";
import { getUser, setUserActive, setUserRole } from "@/server/services/admin";

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
