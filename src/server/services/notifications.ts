import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { assignments, events, exams, goals, notifications, priceAlerts, tasks } from "@/server/db/schema";
import { addDaysKey, todayKey } from "@/lib/dates";
import { getPreferences, patchPreferences } from "./users";

export const notificationSettingsSchema = z.object({
  tasks: z.boolean().default(true),
  deadlines: z.boolean().default(true),
  events: z.boolean().default(true),
  study: z.boolean().default(true),
  training: z.boolean().default(true),
  goals: z.boolean().default(true),
  finance: z.boolean().default(true),
  market: z.boolean().default(true),
  eventLeadMinutes: z.number().int().min(0).max(1440).default(30),
  deadlineLeadDays: z.number().int().min(0).max(30).default(3),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export async function notificationSettings(userId: string): Promise<NotificationSettings> {
  const p = await getPreferences(userId);
  return notificationSettingsSchema.parse(p.notifications ?? {});
}
export async function updateNotificationSettings(userId: string, patch: Partial<NotificationSettings>) {
  const next = notificationSettingsSchema.parse({ ...(await notificationSettings(userId)), ...patch });
  await patchPreferences(userId, { notifications: next });
  return next;
}

export async function listNotifications(userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const conds = [eq(notifications.userId, userId)];
  if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
  return db.select().from(notifications).where(and(...conds)).orderBy(desc(notifications.createdAt)).limit(opts.limit ?? 100);
}
export async function unreadCount(userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(r.n);
}
export async function markRead(userId: string, ids: string[] | "all") {
  const conds = [eq(notifications.userId, userId), isNull(notifications.readAt)];
  if (ids !== "all") conds.push(inArray(notifications.id, ids));
  await db.update(notifications).set({ readAt: new Date() }).where(and(...conds));
}
export async function deleteNotification(userId: string, id: string) {
  await db.delete(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function notify(userId: string, n: { kind: typeof notifications.$inferInsert["kind"]; title: string; body?: string | null; href?: string | null; dedupeKey?: string | null; scheduledFor?: Date | null }) {
  if (n.dedupeKey) {
    const [dup] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.dedupeKey, n.dedupeKey))).limit(1);
    if (dup) return null;
  }
  const [row] = await db.insert(notifications).values({ userId, ...n }).returning();
  return row;
}

/**
 * Generates due notifications from the user's own data (tasks, deadlines, events, exams, goals).
 * Idempotent via dedupeKey; run on app load and by the cron endpoint.
 */
export async function generateNotifications(userId: string, tz?: string) {
  const s = await notificationSettings(userId);
  const today = todayKey(tz);
  let created = 0;
  const add = async (n: Parameters<typeof notify>[1]) => { if (await notify(userId, n)) created++; };

  if (s.tasks) {
    const overdue = await db.select().from(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.status, ["todo", "in_progress"]), sql`${tasks.dueDate} < ${today}`));
    for (const t of overdue) await add({ kind: "task", title: `Overdue: ${t.title}`, body: `Was due ${t.dueDate}`, href: "/tasks?view=overdue", dedupeKey: `task:overdue:${t.id}:${today}` });
    const dueToday = await db.select().from(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.status, ["todo", "in_progress"]), eq(tasks.dueDate, today), inArray(tasks.priority, ["high", "urgent"])));
    for (const t of dueToday) await add({ kind: "task", title: `Due today: ${t.title}`, href: "/tasks", dedupeKey: `task:today:${t.id}` });
  }
  if (s.events) {
    const now = new Date();
    const soon = new Date(now.getTime() + s.eventLeadMinutes * 60000);
    const upcoming = await db.select().from(events).where(and(eq(events.userId, userId), gte(events.startAt, now), lte(events.startAt, soon)));
    for (const e of upcoming) await add({ kind: "event", title: `Starting soon: ${e.title}`, body: e.startAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: tz }), href: "/calendar", dedupeKey: `event:soon:${e.id}` });
  }
  if (s.deadlines) {
    const horizon = addDaysKey(today, s.deadlineLeadDays);
    const ex = await db.select().from(exams).where(and(eq(exams.userId, userId), gte(exams.date, today), lte(exams.date, horizon)));
    for (const e of ex) await add({ kind: "study", title: `Exam ${e.date}: ${e.title}`, href: "/studies", dedupeKey: `exam:${e.id}:${today}` });
    const as = await db.select().from(assignments).where(and(eq(assignments.userId, userId), isNull(assignments.completedAt), gte(assignments.dueDate, today), lte(assignments.dueDate, horizon)));
    for (const a of as) await add({ kind: "deadline", title: `Assignment due ${a.dueDate}: ${a.title}`, href: "/studies", dedupeKey: `assignment:${a.id}:${today}` });
    const gs = await db.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.status, "active"), gte(goals.deadline, today), lte(goals.deadline, horizon)));
    for (const g of gs) await add({ kind: "goal", title: `Goal deadline ${g.deadline}: ${g.name} (${g.progress}%)`, href: `/goals/${g.id}`, dedupeKey: `goal:deadline:${g.id}:${today}` });
  }
  if (s.market) {
    const triggered = await db.select().from(priceAlerts).where(and(eq(priceAlerts.userId, userId), eq(priceAlerts.active, false), sql`${priceAlerts.triggeredAt} > now() - interval '1 day'`));
    for (const a of triggered) await add({ kind: "market", title: `${a.symbol} alert triggered (${a.condition} ${a.price})`, href: "/trading", dedupeKey: `alert:${a.id}` });
  }
  return created;
}
export { asc as _asc };
