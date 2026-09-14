import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { journalEntries } from "@/server/db/schema";
import { notFound } from "@/server/http";
import { dateSchema } from "./tasks";
import { todayKey } from "@/lib/dates";

export const journalCreateSchema = z.object({
  date: dateSchema.optional(),
  title: z.string().max(200).nullish(),
  content: z.string().min(1).max(50000),
  kind: z.enum(["entry", "note", "reflection", "event", "achievement", "problem", "idea"]).default("entry"),
  mood: z.number().int().min(1).max(5).nullish(),
  tags: z.array(z.string().max(30)).max(20).default([]),
  source: z.enum(["user", "ai", "import"]).default("user"),
});
export const journalUpdateSchema = journalCreateSchema.partial();

export async function listJournal(userId: string, opts: { from?: string; to?: string; limit?: number; kind?: string } = {}) {
  const conds = [eq(journalEntries.userId, userId)];
  if (opts.from) conds.push(gte(journalEntries.date, opts.from));
  if (opts.to) conds.push(lte(journalEntries.date, opts.to));
  if (opts.kind) conds.push(eq(journalEntries.kind, opts.kind));
  return db.select().from(journalEntries).where(and(...conds)).orderBy(desc(journalEntries.date), desc(journalEntries.createdAt)).limit(opts.limit ?? 100);
}
export async function getEntry(userId: string, id: string) {
  const [e] = await db.select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)));
  if (!e) throw notFound("Journal entry");
  return e;
}
export async function createEntry(userId: string, input: z.infer<typeof journalCreateSchema>, tz?: string) {
  const [e] = await db.insert(journalEntries).values({ ...input, date: input.date ?? todayKey(tz), userId }).returning();
  return e;
}
export async function updateEntry(userId: string, id: string, input: z.infer<typeof journalUpdateSchema>) {
  await getEntry(userId, id);
  const [e] = await db.update(journalEntries).set(input).where(and(eq(journalEntries.id, id), eq(journalEntries.userId, userId))).returning();
  return e;
}
export async function deleteEntry(userId: string, id: string) {
  await getEntry(userId, id);
  await db.delete(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)));
}
