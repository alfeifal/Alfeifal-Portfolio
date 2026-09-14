import { json, withAuth } from "@/server/http";
import { deleteNotification } from "@/server/services/notifications";
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await deleteNotification(user.id, params.id); return json({ ok: true }); });
