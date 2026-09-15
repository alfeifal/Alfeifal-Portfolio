import { z } from "zod";
import { defineTool } from "../registry";
import * as notif from "@/server/services/notifications";

defineTool({
  name: "get_notifications", module: "notifications", risk: "read",
  description: "The user's notifications, newest first. unreadOnly=true for the ones still pending.",
  schema: z.object({ unreadOnly: z.boolean().default(true), limit: z.number().int().min(1).max(100).default(20) }),
  run: (i, ctx) => notif.listNotifications(ctx.user.id, { unreadOnly: i.unreadOnly, limit: i.limit }),
});
defineTool({
  name: "mark_notifications_read", module: "notifications", risk: "low",
  description: "Mark notifications as read: a specific list of ids, or all of them with all=true. Reversible in practice (nothing is deleted).",
  schema: z.object({ ids: z.array(z.string().uuid()).max(100).optional(), all: z.boolean().default(false) }),
  summarize: (i) => `mark_notifications_read — ${i.all ? "all" : `${i.ids?.length ?? 0} items`}`,
  run: async (i, ctx) => {
    if (!i.all && !i.ids?.length) throw new Error("Give the ids to mark, or all=true");
    await notif.markRead(ctx.user.id, i.all ? "all" : i.ids!);
    return { marked: i.all ? "all" : i.ids!.length, unread: await notif.unreadCount(ctx.user.id) };
  },
});
