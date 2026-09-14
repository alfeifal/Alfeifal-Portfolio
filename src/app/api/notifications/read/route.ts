import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { markRead } from "@/server/services/notifications";
export const POST = withAuth(async (req, { user }) => { const { ids } = await parseBody(req, z.object({ ids: z.union([z.literal("all"), z.array(z.string().uuid())]) })); await markRead(user.id, ids); return json({ ok: true }); });
