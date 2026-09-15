/**
 * Phase 3.2a — temporary chat history. A transcript lives 24 h from its last message (sliding), can be
 * resumed exactly where it was left, never mixes with another chat, and is hard-deleted once it expires,
 * leaving the action log, the structured memory, the reports and every module's data untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { aiActionLogs, aiMemory, aiReports, conversations, messages, tasks } from "@/server/db/schema";
import {
  CONVERSATION_TTL_MS,
  conversationExpiry,
  conversationRetention,
  conversationWithMessages,
  deleteConversation,
  getLiveConversation,
  listActiveConversations,
  mostRecentActive,
  purgeExpiredConversations,
  resumeConversation,
  touchConversation,
} from "@/server/services/conversations";
import { AppError } from "@/server/http";
import * as memory from "@/server/services/memory";
import * as taskService from "@/server/services/tasks";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

/** Creates a conversation with messages, as agent.chat does (same columns, no Anthropic call). */
async function seedChat(userId: string, title: string, texts: string[], opts: { expiresAt?: Date; kind?: string } = {}) {
  const [c] = await db.insert(conversations).values({ userId, title, kind: opts.kind ?? "assistant", expiresAt: opts.expiresAt ?? conversationExpiry() }).returning();
  for (const [i, text] of texts.entries()) {
    await db.insert(messages).values({ conversationId: c.id, role: i % 2 === 0 ? "user" : "assistant", text, content: [{ type: "text", text }] });
  }
  return c;
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const hoursAhead = (h: number) => new Date(Date.now() + h * 3600_000);

d("phase 3.2a — conversation retention and resume", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); other = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });

  it("1. leaving and re-entering resumes the same conversation, where it was left", async () => {
    const chat = await seedChat(user.id, "Dinner planning", ["I spent 18 on dinner", "Logged it.", "And 6 on coffee"]);
    // What the page does on mount with the pointer the browser remembered.
    const resumed = await resumeConversation(user.id, chat.id);
    expect(resumed?.id).toBe(chat.id);
    expect(resumed?.resumedFrom).toBe("pointer");
    expect(resumed?.messages.map((m) => m.text)).toEqual(["I spent 18 on dinner", "Logged it.", "And 6 on coffee"]);
  });

  it("2. different chats never mix, and one user never sees another's transcript", async () => {
    const a = await seedChat(user.id, "Chat A", ["only in A"]);
    const b = await seedChat(user.id, "Chat B", ["only in B"]);
    expect((await conversationWithMessages(user.id, a.id)).messages.map((m) => m.text)).toEqual(["only in A"]);
    expect((await conversationWithMessages(user.id, b.id)).messages.map((m) => m.text)).toEqual(["only in B"]);
    const theirs = await seedChat(other.id, "Theirs", ["private"]);
    await expect(conversationWithMessages(user.id, theirs.id)).rejects.toMatchObject({ status: 404 });
    expect((await listActiveConversations(other.id)).map((c) => c.id)).toEqual([theirs.id]);
    expect((await listActiveConversations(user.id)).some((c) => c.id === theirs.id)).toBe(false);
  });

  it("3. a new message slides the expiry another 24 h from now", async () => {
    const chat = await seedChat(user.id, "Sliding", ["first"], { expiresAt: hoursAhead(2) });
    const before = (await getLiveConversation(user.id, chat.id)).expiresAt;
    expect(before.getTime()).toBeLessThan(Date.now() + 3 * 3600_000);
    const at = new Date();
    await touchConversation(chat.id, at);
    const after = (await getLiveConversation(user.id, chat.id)).expiresAt;
    expect(after.getTime()).toBe(at.getTime() + CONVERSATION_TTL_MS);
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it("4. an expired conversation cannot be resumed, listed or opened", async () => {
    const dead = await seedChat(user.id, "Yesterday", ["old talk"], { expiresAt: hoursAgo(1) });
    await expect(getLiveConversation(user.id, dead.id)).rejects.toMatchObject({ status: 410 });
    await expect(conversationWithMessages(user.id, dead.id)).rejects.toBeInstanceOf(AppError);
    expect((await listActiveConversations(user.id)).some((c) => c.id === dead.id)).toBe(false);
    expect((await mostRecentActive(user.id))?.id).not.toBe(dead.id);
    // Resuming with a dead pointer falls back to the most recent living chat instead of failing.
    const alive = await seedChat(user.id, "Fresh", ["hello"]);
    const resumed = await resumeConversation(user.id, dead.id);
    expect(resumed?.id).toBe(alive.id);
    expect(resumed?.resumedFrom).toBe("latest");
  });

  it("5. purging deletes expired conversations and their messages, and only those", async () => {
    const victim = await seedChat(user.id, "To purge", ["one", "two", "three"], { expiresAt: hoursAgo(2) });
    const survivor = await seedChat(user.id, "To keep", ["still here"]);
    const theirsDead = await seedChat(other.id, "Theirs old", ["gone too"], { expiresAt: hoursAgo(30) });
    const countMessages = (id: string) => db.select({ n: sql<number>`count(*)` }).from(messages).where(eq(messages.conversationId, id)).then((r) => Number(r[0].n));
    expect(await countMessages(victim.id)).toBe(3);
    const purged = await purgeExpiredConversations();
    expect(purged).toBeGreaterThanOrEqual(2);
    expect(await db.select().from(conversations).where(eq(conversations.id, victim.id))).toHaveLength(0);
    expect(await db.select().from(conversations).where(eq(conversations.id, theirsDead.id))).toHaveLength(0);
    expect(await countMessages(victim.id)).toBe(0);
    expect((await getLiveConversation(user.id, survivor.id)).id).toBe(survivor.id);
    expect(await countMessages(survivor.id)).toBe(1);
  });

  it("6 & 7. purging keeps the action log (unlinked), the memory, the reports and the module data", async () => {
    const chat = await seedChat(user.id, "With actions", ["do something"], { expiresAt: hoursAgo(1) });
    const [msg] = await db.select().from(messages).where(eq(messages.conversationId, chat.id));
    const [log] = await db.insert(aiActionLogs).values({ userId: user.id, conversationId: chat.id, messageId: msg.id, tool: "add_expense", risk: "low", params: { amount: 12 }, status: "success", summary: "add_expense — 12" }).returning();
    const remembered = await memory.rememberMemory(user.id, memory.memorySchema.parse({ content: "Trains at 19:00", kind: "preference" }));
    const [report] = await db.insert(aiReports).values({ userId: user.id, kind: "daily_review", periodKey: "2026-09-14", content: "Yesterday went well." }).returning();
    const task = await taskService.createTask(user.id, taskService.taskCreateSchema.parse({ title: "Survives the purge" }));

    await purgeExpiredConversations();

    const [keptLog] = await db.select().from(aiActionLogs).where(eq(aiActionLogs.id, log.id));
    expect(keptLog).toBeTruthy();
    expect(keptLog.conversationId).toBeNull(); // ON DELETE SET NULL
    expect(keptLog.messageId).toBeNull();
    expect(keptLog.summary).toBe("add_expense — 12");
    expect(await db.select().from(aiMemory).where(eq(aiMemory.id, remembered.id))).toHaveLength(1);
    expect(await db.select().from(aiReports).where(eq(aiReports.id, report.id))).toHaveLength(1);
    expect(await db.select().from(tasks).where(and(eq(tasks.id, task.id), eq(tasks.userId, user.id)))).toHaveLength(1);
  });

  it("8. another device with no pointer still lands on the most recent living conversation", async () => {
    const older = await seedChat(user.id, "Older", ["older"]);
    await touchConversation(older.id, new Date(Date.now() - 60_000));
    const newer = await seedChat(user.id, "Newest", ["newest"]);
    await touchConversation(newer.id, new Date());
    const fromOtherDevice = await resumeConversation(user.id, null);
    expect(fromOtherDevice?.id).toBe(newer.id);
    expect(fromOtherDevice?.resumedFrom).toBe("latest");
    // A pointer belonging to somebody else is ignored, not honoured.
    const theirs = await seedChat(other.id, "Not yours", ["nope"]);
    expect((await resumeConversation(user.id, theirs.id))?.id).toBe(newer.id);
  });

  it("9. no regression: expiry defaults to 24 h, deleting by hand still works, retention is reportable", async () => {
    const chat = await seedChat(user.id, "Default ttl", ["hi"]);
    expect(chat.expiresAt.getTime() - chat.createdAt.getTime()).toBeGreaterThan(23 * 3600_000);
    expect(chat.expiresAt.getTime() - chat.createdAt.getTime()).toBeLessThanOrEqual(CONVERSATION_TTL_MS + 1000);
    const retention = await conversationRetention(user.id);
    expect(retention.ttlHours).toBe(24);
    expect(retention.active).toBeGreaterThan(0);
    await deleteConversation(user.id, chat.id);
    await expect(getLiveConversation(user.id, chat.id)).rejects.toMatchObject({ status: 404 });
    // Deleting somebody else's conversation is a no-op, not an error that leaks its existence.
    const theirs = await seedChat(other.id, "Safe", ["safe"]);
    await deleteConversation(user.id, theirs.id);
    expect((await getLiveConversation(other.id, theirs.id)).id).toBe(theirs.id);
  });
});
