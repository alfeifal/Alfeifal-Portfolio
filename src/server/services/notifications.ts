import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { assignments, events, exams, goals, notifications, priceAlerts, tasks } from "@/server/db/schema";
import { addDaysKey, dateKey, isoWeekKey, monthRange, todayKey, weekRange } from "@/lib/dates";
import { getPreferences, patchPreferences } from "./users";
import { financialSummary, listSavingsGoals } from "./finance";
import { weeklyTrainingStatus, workoutForDate, workoutHistory } from "./training";
import { listSubjects, studyProgress } from "./studies";
import { format } from "date-fns";

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
  /** Warn once a budget reaches this share of its amount (a second notice is sent if it is exceeded). */
  budgetWarnPct: z.number().int().min(50).max(100).default(80),
  /** Days without a single study session before the quiet-streak notice fires. */
  studyQuietDays: z.number().int().min(1).max(30).default(3),
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

  /**
   * Training (phase 3.4). Three conditions, all read from the real routine and sessions:
   * the cycle puts a workout on today and none is logged yet, a session from a past day was left open,
   * and the week is clearly behind the training days the cycle placed in it. Never more than one of each
   * per day / per session / per ISO week.
   */
  if (s.training) {
    const [today_, week] = await Promise.all([
      workoutForDate(userId, today).catch(() => null),
      weeklyTrainingStatus(userId, tz).catch(() => null),
    ]);
    const day = today_?.day;
    if (day && !day.isRest) {
      const [logged] = await workoutHistory(userId, { from: today, to: today, limit: 5 });
      if (!logged?.isWorkout) {
        await add({ kind: "training", title: `Training today: ${day.name}`, body: `${day.exercises.length} exercises · cycle day ${(today_!.dayIndex ?? 0) + 1}/${today_!.plan.cycleLength}`, href: "/training", dedupeKey: `training:day:${today}` });
      }
    }
    const openOld = (await workoutHistory(userId, { from: addDaysKey(today, -14), to: addDaysKey(today, -1), limit: 30 }).catch(() => [])).filter((w) => !w.finishedAt);
    for (const w of openOld) {
      await add({ kind: "training", title: `Workout from ${w.date} is still open`, body: w.sets ? `${w.sets} sets logged · finish it or delete it` : "no sets logged · finish it or delete it", href: `/training/sessions/${w.id}`, dedupeKey: `training:open:${w.id}` });
    }
    // "Behind" only when the plan really placed more training days than were done, by two or more.
    if (week?.plannedSoFar != null && week.plannedSoFar - week.completed >= 2) {
      await add({ kind: "training", title: `Behind on training this week`, body: `${week.completed} of the ${week.plannedSoFar} training days the cycle placed so far`, href: "/training", dedupeKey: `training:behind:${isoWeekKey(new Date(today + "T12:00:00"))}` });
    }
  }

  /**
   * Finance (phase 3.4). Budgets that reached their warning share or are already exceeded, and savings
   * goals whose deadline is within the user's deadline lead. One notice per budget and month for each
   * level, so a budget cannot notify every day.
   */
  if (s.finance) {
    const m = monthRange(new Date(today + "T12:00:00"));
    const month = today.slice(0, 7);
    const summary = await financialSummary(userId, { from: format(m.start, "yyyy-MM-dd"), to: format(m.end, "yyyy-MM-dd") }).catch(() => null);
    for (const b of summary?.budgets ?? []) {
      if (b.amount <= 0) continue;
      if (b.pct >= 100) {
        await add({ kind: "finance", title: `Budget exceeded: ${b.name}`, body: `${b.spent} of ${b.amount} spent this month (${b.pct}%)`, href: "/finance", dedupeKey: `finance:budget:${b.id}:${month}:over` });
      } else if (b.pct >= s.budgetWarnPct) {
        await add({ kind: "finance", title: `Budget at ${b.pct}%: ${b.name}`, body: `${b.remaining} left of ${b.amount} this month`, href: "/finance", dedupeKey: `finance:budget:${b.id}:${month}:warn` });
      }
    }
    const horizon = addDaysKey(today, s.deadlineLeadDays);
    const savings = await listSavingsGoals(userId).catch(() => []);
    for (const g of savings) {
      if (!g.deadline || g.completedAt || g.deadline < today || g.deadline > horizon) continue;
      if (g.targetAmount > 0 && g.currentAmount >= g.targetAmount) continue;
      const pct = g.targetAmount > 0 ? Math.round((g.currentAmount / g.targetAmount) * 100) : 0;
      await add({ kind: "finance", title: `Savings goal due ${g.deadline}: ${g.name}`, body: `${g.currentAmount} of ${g.targetAmount} saved (${pct}%)`, href: "/finance", dedupeKey: `finance:savings:${g.id}:${g.deadline}` });
    }
  }

  /**
   * Study consistency (phase 3.4). Exams and assignment deadlines are already covered by `deadlines`;
   * this is about continuity: a quiet streak with no session at all, and weekly subject goals that are
   * clearly not going to be met at the current pace. Once per day and once per subject and ISO week.
   */
  if (s.study) {
    const subjects = await listSubjects(userId).catch(() => []);
    if (subjects.length) {
      const quietFrom = addDaysKey(today, -(s.studyQuietDays - 1));
      const recent = await studyProgress(userId, { from: quietFrom, to: today }).catch(() => null);
      if (recent && recent.totalMinutes === 0) {
        await add({ kind: "study", title: `No study logged in ${s.studyQuietDays} days`, body: `Nothing since ${addDaysKey(quietFrom, -1)} across ${subjects.length} subject${subjects.length === 1 ? "" : "s"}`, href: "/studies", dedupeKey: `study:quiet:${today}` });
      }
      const { start } = weekRange(new Date(today + "T12:00:00"));
      const weekFrom = dateKey(start);
      const elapsed = Math.min(7, Math.max(1, Math.round((new Date(today + "T12:00:00").getTime() - new Date(weekFrom + "T12:00:00").getTime()) / 86400e3) + 1));
      // Only worth saying once most of the week has gone and the pace is clearly short.
      if (elapsed >= 4) {
        const weekProgress = await studyProgress(userId, { from: weekFrom, to: today }).catch(() => null);
        const weekKey = isoWeekKey(new Date(today + "T12:00:00"));
        for (const sub of weekProgress?.bySubject ?? []) {
          if (!sub.weeklyGoalMinutes || !sub.subjectId) continue;
          const expected = (sub.weeklyGoalMinutes * elapsed) / 7;
          if (sub.minutes < expected * 0.6) {
            await add({ kind: "study", title: `${sub.name}: behind the weekly goal`, body: `${sub.minutes} of ${sub.weeklyGoalMinutes} min with ${7 - elapsed} day${7 - elapsed === 1 ? "" : "s"} left`, href: "/studies", dedupeKey: `study:weekly:${sub.subjectId}:${weekKey}` });
          }
        }
        // Subjects with a goal but no session at all this week are not in bySubject.
        const seen = new Set((weekProgress?.bySubject ?? []).map((x) => x.subjectId));
        for (const sub of subjects) {
          if (!sub.weeklyGoalMinutes || seen.has(sub.id)) continue;
          await add({ kind: "study", title: `${sub.name}: behind the weekly goal`, body: `0 of ${sub.weeklyGoalMinutes} min with ${7 - elapsed} day${7 - elapsed === 1 ? "" : "s"} left`, href: "/studies", dedupeKey: `study:weekly:${sub.id}:${weekKey}` });
        }
      }
    }
  }

  return created;
}
export { asc as _asc };
