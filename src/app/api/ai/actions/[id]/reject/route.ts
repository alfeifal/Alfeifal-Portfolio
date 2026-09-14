import { json, withAuth } from "@/server/http";
import { rejectAction } from "@/server/ai/agent";
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => { await rejectAction(user, params.id); return json({ ok: true }); });
