import { json, withAuth } from "@/server/http";
import { deleteEntry } from "@/server/services/nutrition";
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await deleteEntry(user.id, params.id); return json({ ok: true }); });
