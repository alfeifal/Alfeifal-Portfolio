import { and, asc, eq, gte, lt, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { events } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/http";
import { assertOwned } from "@/server/ownership";

export const eventKindSchema = z.enum(["event", "work", "training", "study", "german", "personal", "deadline", "reminder", "meal", "market"]);
export const eventCreateSchema = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(5000).nullish(),
    kind: eventKindSchema.default("event"),
    startAt: z.coerce.date(),
    endAt: z.coerce.date().optional(),
    allDay: z.boolean().default(false),
    location: z.string().max(300).nullish(),
    taskId: z.string().uuid().nullish(),
    projectId: z.string().uuid().nullish(),
    goalId: z.string().uuid().nullish(),
    link: z.object({ type: z.string(), id: z.string() }).nullish(),
    recurrence: z.string().max(50).nullish(),
    reminderMinutes: z.number().int().min(0).max(10080).nullish(),
    color: z.string().max(20).nullish(),
    source: z.enum(["user", "ai", "import"]).default("user"),
  })
  .transform((e) => ({ ...e, endAt: e.endAt ?? new Date(e.startAt.getTime() + (e.allDay ? 24 * 3600e3 : 3600e3)) }));
export const eventUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).nullish(),
  kind: eventKindSchema.optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(300).nullish(),
  taskId: z.string().uuid().nullish(),
  projectId: z.string().uuid().nullish(),
  goalId: z.string().uuid().nullish(),
  recurrence: z.string().max(50).nullish(),
  reminderMinutes: z.number().int().min(0).max(10080).nullish(),
  color: z.string().max(20).nullish(),
});

export async function listEvents(userId: string, range: { from: Date; to: Date }) {
  if (range.to <= range.from) throw badRequest("Invalid range");
  return db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), lt(events.startAt, range.to), gte(events.endAt, range.from)))
    .orderBy(asc(events.startAt));
}

export async function getEvent(userId: string, id: string) {
  const [e] = await db.select().from(events).where(and(eq(events.id, id), eq(events.userId, userId)));
  if (!e) throw notFound("Event");
  return e;
}

export async function createEvent(userId: string, input: z.infer<typeof eventCreateSchema>) {
  if (input.endAt < input.startAt) throw badRequest("End must be after start");
  await assertOwned(userId, { task: input.taskId, project: input.projectId, goal: input.goalId });
  const [e] = await db.insert(events).values({ ...input, userId }).returning();
  return e;
}

export async function updateEvent(userId: string, id: string, input: z.infer<typeof eventUpdateSchema>) {
  const current = await getEvent(userId, id);
  await assertOwned(userId, { task: input.taskId, project: input.projectId, goal: input.goalId });
  const startAt = input.startAt ?? current.startAt;
  const endAt = input.endAt ?? (input.startAt ? new Date(input.startAt.getTime() + (current.endAt.getTime() - current.startAt.getTime())) : current.endAt);
  if (endAt < startAt) throw badRequest("End must be after start");
  const [e] = await db.update(events).set({ ...input, startAt, endAt }).where(and(eq(events.id, id), eq(events.userId, userId))).returning();
  return e;
}

export async function deleteEvent(userId: string, id: string) {
  await getEvent(userId, id);
  await db.delete(events).where(and(eq(events.id, id), eq(events.userId, userId)));
}

/** Free slots between `from` and `to` given existing events (used by the planner). */
export async function freeSlots(userId: string, from: Date, to: Date, minMinutes = 30) {
  const busy = await db.select({ s: events.startAt, e: events.endAt }).from(events).where(and(eq(events.userId, userId), lt(events.startAt, to), gte(events.endAt, from), lte(events.startAt, to))).orderBy(asc(events.startAt));
  const slots: { start: Date; end: Date; minutes: number }[] = [];
  let cursor = from;
  for (const b of busy) {
    if (b.s > cursor) {
      const minutes = (b.s.getTime() - cursor.getTime()) / 60000;
      if (minutes >= minMinutes) slots.push({ start: cursor, end: b.s, minutes });
    }
    if (b.e > cursor) cursor = b.e;
  }
  if (to > cursor) {
    const minutes = (to.getTime() - cursor.getTime()) / 60000;
    if (minutes >= minMinutes) slots.push({ start: cursor, end: to, minutes });
  }
  return slots;
}
