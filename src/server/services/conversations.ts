import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { aiActionLogs, conversations, messages } from "@/server/db/schema";
import { AppError, notFound } from "@/server/http";

/**
 * Temporary chat history (phase 3.2a).
 *
 * A conversation is a *transcript*, not a record: it lives 24 h from its last message, sliding — every
 * new message pushes the expiry 24 h further — and once that window passes with no activity it is hard
 * deleted together with its messages by the cron purge.
 *
 * What is NOT temporary, and is never touched here: `ai_action_logs` (kept, and merely unlinked by the
 * ON DELETE SET NULL on conversation_id / message_id), `ai_memory`, `ai_reports`, and every module table
 * (tasks, events, finance, goals, projects, training, studies, german...). Those follow their own rules.
 */
export const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;
export const conversationExpiry = (from: Date = new Date()) => new Date(from.getTime() + CONVERSATION_TTL_MS);
export const gone = (what = "Conversation") => new AppError(410, `${what} has expired`);

const alive = () => gt(conversations.expiresAt, new Date());

/** Conversations the user can still open, most recently used first. Expired ones are never listed. */
export function listActiveConversations(userId: string, limit = 50) {
  return db.select().from(conversations).where(and(eq(conversations.userId, userId), alive())).orderBy(desc(conversations.updatedAt)).limit(limit);
}

/** The conversation to resume when the client has no pointer (or its pointer died): the latest living one. */
export async function mostRecentActive(userId: string, kind?: string) {
  const conds = [eq(conversations.userId, userId), alive()];
  if (kind) conds.push(eq(conversations.kind, kind));
  const [c] = await db.select().from(conversations).where(and(...conds)).orderBy(desc(conversations.updatedAt)).limit(1);
  return c ?? null;
}

/** Row lookup that distinguishes "never existed" (404) from "expired" (410) so the client can react. */
export async function getLiveConversation(userId: string, id: string) {
  const [c] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  if (!c) throw notFound("Conversation");
  if (c.expiresAt <= new Date()) throw gone();
  return c;
}

/** Full transcript of one conversation. Messages are scoped by conversation id, so chats never mix. */
export async function conversationWithMessages(userId: string, id: string) {
  const c = await getLiveConversation(userId, id);
  const msgs = await db
    .select({ id: messages.id, role: messages.role, text: messages.text, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, c.id))
    .orderBy(messages.createdAt);
  const actions = await db.select().from(aiActionLogs).where(eq(aiActionLogs.conversationId, c.id)).orderBy(aiActionLogs.createdAt);
  return { ...c, messages: msgs.filter((m) => m.text.trim()), actions };
}

/**
 * Resolves what the assistant should show on mount: the conversation the client points at, or the most
 * recent living one, or nothing. Never throws for a dead pointer — that is the normal "start fresh" path.
 *
 * The fallback is restricted to the assistant's own kind. Fast Log is deliberately one-shot — it passes
 * no conversation id, so each quick note gets its own transcript — but with no filter here the assistant
 * would adopt that transcript on its next mount simply because it was the most recent, and go on writing
 * into it. That is how a `quick_entry` conversation ended up holding a ninety-minute assistant chat.
 * A transcript of another kind can still be opened deliberately from the conversation list.
 */
export async function resumeConversation(userId: string, preferredId?: string | null, kind = "assistant") {
  if (preferredId) {
    try {
      return { ...(await conversationWithMessages(userId, preferredId)), resumedFrom: "pointer" as const };
    } catch (e) {
      if (!(e instanceof AppError) || (e.status !== 404 && e.status !== 410)) throw e;
    }
  }
  const latest = await mostRecentActive(userId, kind);
  if (!latest) return null;
  return { ...(await conversationWithMessages(userId, latest.id)), resumedFrom: "latest" as const };
}

/** Slides the 24 h window forward. Called by the agent after every message it persists. */
export async function touchConversation(id: string, at: Date = new Date()) {
  await db.update(conversations).set({ updatedAt: at, expiresAt: conversationExpiry(at) }).where(eq(conversations.id, id));
}

export async function deleteConversation(userId: string, id: string) {
  await db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
}

/**
 * Hard-deletes expired transcripts (messages go with them by ON DELETE CASCADE). Action logs survive:
 * their conversation_id / message_id are set to NULL, so the audit trail stays complete.
 */
export async function purgeExpiredConversations() {
  const rows = await db.delete(conversations).where(lte(conversations.expiresAt, new Date())).returning({ id: conversations.id });
  return rows.length;
}

/** Diagnostics for tests and the settings screen: how many transcripts are alive and when the next one dies. */
export async function conversationRetention(userId: string) {
  const [r] = await db
    .select({ active: sql<number>`count(*) filter (where ${conversations.expiresAt} > now())`, expired: sql<number>`count(*) filter (where ${conversations.expiresAt} <= now())`, nextExpiry: sql<Date | null>`min(${conversations.expiresAt}) filter (where ${conversations.expiresAt} > now())` })
    .from(conversations)
    .where(eq(conversations.userId, userId));
  return { ttlHours: CONVERSATION_TTL_MS / 3600000, active: Number(r.active), expired: Number(r.expired), nextExpiry: r.nextExpiry };
}
