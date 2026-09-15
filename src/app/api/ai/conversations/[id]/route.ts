import { json, withAuth } from "@/server/http";
import { conversationWithMessages, deleteConversation } from "@/server/services/conversations";
/** 404 when it never existed, 410 when it expired: the client tells the two apart and starts fresh. */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => json(await conversationWithMessages(user.id, params.id)));
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await deleteConversation(user.id, params.id); return json({ ok: true }); });
