import { json, parseBody, withAuth } from "@/server/http";
import { logSet, setSchema } from "@/server/services/training";
import { audit } from "@/server/audit";
export const POST = withAuth(async (req, { user }) => { const r = await logSet(user.id, await parseBody(req, setSchema), user.timezone); await audit({ userId: user.id, actor: "user", action: "training.set.create", entityId: r.set.id }); return json(r, { status: 201 }); });
