import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { tasks } from "@/server/db/schema";
import { notFound } from "@/server/http";
import { addDaysKey, todayKey } from "@/lib/dates";
import { emitDomainEvent } from "@/server/events/bus";

export const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const taskStatusSchema = z.enum(["todo", "in_progress", "done", "cancelled"]);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const taskCreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).nullish(),
  priority: prioritySchema.default("medium"),
  status: taskStatusSchema.default("todo"),
  category: z.string().max(50).nullish(),
  dueDate: dateSchema.nullish(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  projectId: z.string().uuid().nullish(),
  goalId: z.string().uuid().nullish(),
  milestoneId: z.string().uuid().nullish(),
  recurrence: z.string().max(50).nullish(),
  estimatedMinutes: z.number().int().min(1).max(1440).nullish(),
  source: z.enum(["user", "ai", "import"]).default("user"),
});
export const taskUpdateSchema = taskCreateSchema.partial();
export type TaskCreate = z.infer<typeof taskCreateSchema>;

export async function listTasks(userId: string, filter: { view?: "today" | "upcoming" | "overdue" | "completed" | "all" | "inbox"; projectId?: string; goalId?: string; status?: string; limit?: number; tz?: string } = {}) {
  const today = todayKey(filter.tz);
  const conds = [eq(tasks.userId, userId)];
  const open = inArray(tasks.status, ["todo", "in_progress"]);
  switch (filter.view) {
    case "today": conds.push(open, lte(tasks.dueDate, today)); break;
    case "upcoming": conds.push(open, gte(tasks.dueDate, addDaysKey(today, 1))); break;
    case "overdue": conds.push(open, lt(tasks.dueDate, today)); break;
    case "completed": conds.push(eq(tasks.status, "done")); break;
    case "inbox": conds.push(open, isNull(tasks.dueDate)); break;
    case "all": break;
    default: conds.push(open);
  }
  if (filter.projectId) conds.push(eq(tasks.projectId, filter.projectId));
  if (filter.goalId) conds.push(eq(tasks.goalId, filter.goalId));
  if (filter.status) conds.push(eq(tasks.status, filter.status as "todo"));
  return db
    .select()
    .from(tasks)
    .where(and(...conds))
    .orderBy(filter.view === "completed" ? desc(tasks.completedAt) : sql`${tasks.dueDate} asc nulls last`, desc(tasks.priority), asc(tasks.position), asc(tasks.createdAt))
    .limit(filter.limit ?? 200);
}

export async function getTask(userId: string, id: string) {
  const [t] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  if (!t) throw notFound("Task");
  return t;
}

export async function createTask(userId: string, input: TaskCreate) {
  const [t] = await db.insert(tasks).values({ ...input, userId, completedAt: input.status === "done" ? new Date() : null }).returning();
  return t;
}

export async function updateTask(userId: string, id: string, input: z.infer<typeof taskUpdateSchema>, tz?: string) {
  const prev = await getTask(userId, id);
  const patch: Partial<typeof tasks.$inferInsert> = { ...input };
  if (input.status === "done" && prev.status !== "done") patch.completedAt = new Date();
  else if (input.status && input.status !== "done") patch.completedAt = null;
  const [t] = await db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.userId, userId))).returning();
  if (t.status === "done" && prev.status !== "done") await emitDomainEvent(userId, { type: "task.completed", taskId: t.id, projectId: t.projectId, goalId: t.goalId, date: todayKey(tz) }, { tz });
  else if (prev.status === "done" && t.status !== "done") await emitDomainEvent(userId, { type: "task.changed", taskId: t.id, projectId: t.projectId, goalId: t.goalId, reason: "reopened" }, { tz });
  else if (prev.status === "done" && (prev.goalId !== t.goalId || prev.projectId !== t.projectId)) await emitDomainEvent(userId, { type: "task.changed", taskId: t.id, projectId: t.projectId, goalId: t.goalId, reason: "updated" }, { tz });
  return t;
}

/** Completing a recurring task spawns the next occurrence. */
export async function completeTask(userId: string, id: string, tz?: string) {
  const t = await getTask(userId, id);
  const [done] = await db.update(tasks).set({ status: "done", completedAt: new Date() }).where(eq(tasks.id, id)).returning();
  let next: typeof tasks.$inferSelect | null = null;
  if (t.recurrence && t.dueDate) {
    const nextDate = nextOccurrence(t.dueDate, t.recurrence);
    if (nextDate) {
      [next] = await db
        .insert(tasks)
        .values({ userId, title: t.title, description: t.description, priority: t.priority, category: t.category, dueDate: nextDate, dueTime: t.dueTime, projectId: t.projectId, goalId: t.goalId, recurrence: t.recurrence, recurrenceParentId: t.recurrenceParentId ?? t.id, estimatedMinutes: t.estimatedMinutes, source: t.source })
        .returning();
    }
  }
  if (t.status !== "done") await emitDomainEvent(userId, { type: "task.completed", taskId: done.id, projectId: done.projectId, goalId: done.goalId, date: todayKey(tz) }, { tz });
  return { task: done, next };
}

export async function deleteTask(userId: string, id: string, tz?: string) {
  const t = await getTask(userId, id);
  await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  // Announced whatever its status was: removing an *open* task changes the denominator of its
  // project's and goal's progress just as much as removing a completed one changes the numerator.
  if (t.status === "done" || t.projectId || t.goalId) {
    await emitDomainEvent(userId, { type: "task.changed", taskId: id, projectId: t.projectId, goalId: t.goalId, reason: "deleted" }, { tz });
  }
}

/** recurrence grammar: daily | weekdays | weekly | weekly:MO,WE,FR | monthly | monthly:15 | yearly */
export function nextOccurrence(from: string, rule: string): string | null {
  const [kind, arg] = rule.split(":");
  const dow = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const d = new Date(from + "T00:00:00Z");
  switch (kind) {
    case "daily": return addDaysKey(from, 1);
    case "weekdays": { let k = from; do { k = addDaysKey(k, 1); } while ([0, 6].includes(new Date(k + "T00:00:00Z").getUTCDay())); return k; }
    case "weekly": {
      if (!arg) return addDaysKey(from, 7);
      const days = arg.split(",").map((s) => dow.indexOf(s.trim().toUpperCase())).filter((i) => i >= 0);
      if (!days.length) return addDaysKey(from, 7);
      let k = from;
      for (let i = 0; i < 8; i++) { k = addDaysKey(k, 1); if (days.includes(new Date(k + "T00:00:00Z").getUTCDay())) return k; }
      return null;
    }
    case "monthly": {
      const day = arg ? Number(arg) : d.getUTCDate();
      const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      const last = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate();
      n.setUTCDate(Math.min(day, last));
      return n.toISOString().slice(0, 10);
    }
    case "yearly": { const n = new Date(d); n.setUTCFullYear(d.getUTCFullYear() + 1); return n.toISOString().slice(0, 10); }
    default: return null;
  }
}

export async function taskCounts(userId: string, tz?: string) {
  const today = todayKey(tz);
  const open = inArray(tasks.status, ["todo", "in_progress"]);
  const [row] = await db
    .select({
      today: sql<number>`count(*) filter (where ${tasks.dueDate} = ${today})`,
      overdue: sql<number>`count(*) filter (where ${tasks.dueDate} < ${today})`,
      open: sql<number>`count(*)`,
    })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), open));
  return { today: Number(row.today), overdue: Number(row.overdue), open: Number(row.open) };
}
