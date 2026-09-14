import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { aiMemory } from "@/server/db/schema";
import { notFound } from "@/server/http";

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
/** Upsert by key when provided (so "current job schedule" stays a single memory). */
export async function rememberMemory(userId: string, input: z.infer<typeof memorySchema>) {
  if (input.key) {
    const [existing] = await db.select().from(aiMemory).where(and(eq(aiMemory.userId, userId), eq(aiMemory.key, input.key))).limit(1);
    if (existing) {
      const [m] = await db.update(aiMemory).set({ ...input, updatedAt: new Date() }).where(eq(aiMemory.id, existing.id)).returning();
      return m;
    }
  }
  const [m] = await db.insert(aiMemory).values({ ...input, userId }).returning();
  return m;
}
export async function updateMemory(userId: string, id: string, input: Partial<z.infer<typeof memorySchema>>) {
  const [m] = await db.update(aiMemory).set({ ...input, updatedAt: new Date() }).where(and(eq(aiMemory.id, id), eq(aiMemory.userId, userId))).returning();
  if (!m) throw notFound("Memory");
  return m;
}
export async function forgetMemory(userId: string, id: string) {
  await db.delete(aiMemory).where(and(eq(aiMemory.id, id), eq(aiMemory.userId, userId)));
}
export async function touchMemories(ids: string[]) {
  if (!ids.length) return;
  await db.update(aiMemory).set({ lastUsedAt: new Date() }).where(sql`${aiMemory.id} in ${ids}`);
}
