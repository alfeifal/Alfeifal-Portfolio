import { json, withAuth } from "@/server/http";
import { query } from "@/server/crud";
import { generateNotifications, listNotifications, unreadCount } from "@/server/services/notifications";
export const GET = withAuth(async (req, { user }) => { const q = query(req); if (q.generate === "1") await generateNotifications(user.id, user.timezone); return json({ items: await listNotifications(user.id, { unreadOnly: q.unread === "1", limit: q.limit ? Number(q.limit) : undefined }), unread: await unreadCount(user.id) }); });
