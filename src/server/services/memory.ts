import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { aiMemory } from "@/server/db/schema";
import { AppError, notFound } from "@/server/http";

export const memorySchema = z.object({
  kind: z.enum(["fact", "preference", "context", "goal", "routine", "person", "note"]).default("fact"),
  key: z.string().max(100).nullish(),
  content: z.string().min(1).max(2000),
  importance: z.number().int().min(1).max(5).default(3),
  pinned: z.boolean().default(false),
  source: z.enum(["user", "ai"]).default("ai"),
  expiresAt: z.coerce.date().nullish(),
});

export async function listMemory(userId: string, opts: { limit?: number; kind?: string } = {}) {
  const conds = [eq(aiMemory.userId, userId), or(sql`${aiMemory.expiresAt} is null`, sql`${aiMemory.expiresAt} > now()`)!];
  if (opts.kind) conds.push(eq(aiMemory.kind, opts.kind as "fact"));
  return db.select().from(aiMemory).where(and(...conds)).orderBy(desc(aiMemory.pinned), desc(aiMemory.importance), desc(aiMemory.updatedAt)).limit(opts.limit ?? 200);
}
/**
 * A memory has two identities and they are not interchangeable:
 *
 *  - `id`  — the UUID primary key. Stable, unique, but never shown to the model in the system prompt.
 *  - `key` — an optional semantic slug the assistant itself chooses ("investments_trading212",
 *            "work_schedule"). It is what `rememberMemory` upserts on, and what the context block
 *            renders as `[kind:key]`, so it is the only handle the model actually has.
 *
 * `key` is therefore a legitimate address for a memory, but it is NOT a UUID and must never be coerced
 * into one. `resolveMemoryId` is the single place that turns either handle into a real row id.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A key has no uniqueness constraint, so resolution is pinned to the most recently updated row. */
export async function findMemoryByKey(userId: string, key: string) {
  const [m] = await db.select().from(aiMemory)
    .where(and(eq(aiMemory.userId, userId), eq(aiMemory.key, key)))
    .orderBy(desc(aiMemory.updatedAt), desc(aiMemory.createdAt))
    .limit(1);
  return m ?? null;
}

/**
 * Turns `{ id }` or `{ key }` into the row id of a memory owned by `userId`.
 * Always scoped to the caller: another user's memory resolves to "not found", never to their row.
 */
export async function resolveMemoryId(userId: string, ref: { id?: string | null; key?: string | null }): Promise<string> {
  if (ref.id) {
    if (!UUID_RE.test(ref.id)) throw new AppError(400, `"${ref.id}" is not a memory id. If this is a memory key, pass it as "key" instead.`);
    const [m] = await db.select({ id: aiMemory.id }).from(aiMemory).where(and(eq(aiMemory.id, ref.id), eq(aiMemory.userId, userId)));
    if (!m) throw notFound("Memory");
    return m.id;
  }
  if (ref.key) {
    const m = await findMemoryByKey(userId, ref.key);
    if (!m) throw notFound(`Memory with key "${ref.key}"`);
    return m.id;
  }
  throw new AppError(400, "Provide either the memory id (UUID) or its key.");
}

/** Keyword search over the user's own memories. Read-only; used by the assistant to find a real id. */
export async function searchMemory(userId: string, q: string, limit = 10) {
  const term = q.trim();
  const conds = [eq(aiMemory.userId, userId), or(sql`${aiMemory.expiresAt} is null`, sql`${aiMemory.expiresAt} > now()`)!];
  if (term) {
    const like = `%${term}%`;
    conds.push(or(sql`${aiMemory.content} ilike ${like}`, sql`${aiMemory.key} ilike ${like}`, sql`${aiMemory.kind}::text ilike ${like}`)!);
  }
  return db.select().from(aiMemory).where(and(...conds))
    .orderBy(desc(aiMemory.pinned), desc(aiMemory.importance), desc(aiMemory.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 50));
}

/** Reads one memory by either handle. Pure read: it does not touch updatedAt. */
export async function getMemory(userId: string, ref: { id?: string | null; key?: string | null }) {
  const id = await resolveMemoryId(userId, ref);
  const [m] = await db.select().from(aiMemory).where(and(eq(aiMemory.id, id), eq(aiMemory.userId, userId)));
  if (!m) throw notFound("Memory");
  return m;
}

/** Upsert by key when provided (so "current job schedule" stays a single memory). */
export async function rememberMemory(userId: string, input: z.infer<typeof memorySchema>) {
  if (input.key) {
    const existing = await findMemoryByKey(userId, input.key);
    if (existing) {
      const [m] = await db.update(aiMemory).set({ ...input, updatedAt: new Date() }).where(eq(aiMemory.id, existing.id)).returning();
      return m;
    }
  }
  const [m] = await db.insert(aiMemory).values({ ...input, userId }).returning();
  return m;
}

/** Edits a memory addressed by UUID or by key. Only fields actually supplied are written. */
export async function updateMemory(userId: string, ref: string | { id?: string | null; key?: string | null }, input: Partial<z.infer<typeof memorySchema>>) {
  const id = await resolveMemoryId(userId, typeof ref === "string" ? { id: ref } : ref);
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const [m] = await db.update(aiMemory).set({ ...patch, updatedAt: new Date() }).where(and(eq(aiMemory.id, id), eq(aiMemory.userId, userId))).returning();
  if (!m) throw notFound("Memory");
  return m;
}

export async function forgetMemory(userId: string, ref: string | { id?: string | null; key?: string | null }) {
  const id = await resolveMemoryId(userId, typeof ref === "string" ? { id: ref } : ref);
  await db.delete(aiMemory).where(and(eq(aiMemory.id, id), eq(aiMemory.userId, userId)));
  return { deleted: id };
}
export async function touchMemories(ids: string[]) {
  if (!ids.length) return;
  await db.update(aiMemory).set({ lastUsedAt: new Date() }).where(sql`${aiMemory.id} in ${ids}`);
}
