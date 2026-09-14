import { and, asc, eq } from "drizzle-orm";
import { json, notFound, withAuth } from "@/server/http";
import { db } from "@/server/db";
import { aiActionLogs, conversations, messages } from "@/server/db/schema";
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  const [c] = await db.select().from(conversations).where(and(eq(conversations.id, params.id), eq(conversations.userId, user.id)));
  if (!c) throw notFound("Conversation");
  const msgs = await db.select({ id: messages.id, role: messages.role, text: messages.text, createdAt: messages.createdAt }).from(messages).where(eq(messages.conversationId, c.id)).orderBy(asc(messages.createdAt));
  const actions = await db.select().from(aiActionLogs).where(eq(aiActionLogs.conversationId, c.id)).orderBy(asc(aiActionLogs.createdAt));
  return json({ ...c, messages: msgs.filter((m) => m.text.trim()), actions });
});
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => { await db.delete(conversations).where(and(eq(conversations.id, params.id), eq(conversations.userId, user.id))); return json({ ok: true }); });
