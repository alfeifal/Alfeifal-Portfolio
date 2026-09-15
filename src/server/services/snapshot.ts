import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { aiReports } from "@/server/db/schema";
import type { SessionUser } from "@/server/auth/session";
import { listTasks, taskCounts } from "./tasks";
import { listEvents } from "./calendar";
import { listGoals } from "./goals";
import { goalPace, isLinked } from "./goal-metrics";
import { listProjects } from "./projects";
import { listAssignments, listExams, studyProgress } from "./studies";
import { weeklyTrainingStatus, workoutForDate } from "./training";
import { germanSummary } from "./german";
import { financialSummary } from "./finance";
import { dailyNutrition } from "./nutrition";
import { addDaysKey, todayKey } from "@/lib/dates";

/**
 * Life snapshot (phase 3.1): one place that answers "what is the state of this user right now",
 * assembled from the existing services — it owns no queries of its own beyond reading the latest
 * stored report, and no business logic. Two consumers today: the assistant's system prompt (compact
 * rendering, hard size cap) and the `get_snapshot` tool (any section, on demand). Home, the planner
 * and the reviews are meant to reuse it in later phases instead of re-assembling the same data.
 */
export const SNAPSHOT_SECTIONS = ["tasks", "calendar", "goals", "projects", "training", "studies", "german", "finance", "nutrition", "reviews"] as const;
export type SnapshotSection = (typeof SNAPSHOT_SECTIONS)[number];

/** Sections cheap and useful enough to sit in every system prompt. The rest is fetched with get_snapshot. */
export const COMPACT_SECTIONS: SnapshotSection[] = ["tasks", "calendar", "goals", "projects", "training", "studies", "german", "finance", "reviews"];

/**
 * Context budget. The snapshot block of the system prompt is capped at this many characters
 * (roughly 1.5k tokens): the assistant is told what was left out and can pull it with get_snapshot,
 * so a user with hundreds of records costs the same per message as a user with ten.
 */
export const SNAPSHOT_BUDGET_CHARS = 6000;

export interface SnapshotOptions {
  sections?: readonly SnapshotSection[];
  /** Days ahead covered by the forward-looking sections (calendar, upcoming tasks, deadlines). */
  horizonDays?: number;
  tz?: string;
}

type Ctx = { user: SessionUser; userId: string; tz: string; today: string; horizonDays: number; horizonEnd: string };

const short = (id: string) => id.slice(0, 8);
const hhmm = (d: Date, tz: string) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: tz });

async function latestReportRow(userId: string, kind: string) {
  // Read directly instead of importing ai/reports.ts: services must not depend on the AI layer
  // (ai/context.ts already depends on this file, and the import would close a cycle).
  const [r] = await db.select({ periodKey: aiReports.periodKey, createdAt: aiReports.createdAt, content: aiReports.content }).from(aiReports).where(and(eq(aiReports.userId, userId), eq(aiReports.kind, kind))).orderBy(desc(aiReports.createdAt)).limit(1);
  return r ?? null;
}

const LOADERS: { [K in SnapshotSection]: (c: Ctx) => Promise<unknown> } = {
  async tasks(c) {
    const [today, overdue, upcoming, counts] = await Promise.all([
      listTasks(c.userId, { view: "today", tz: c.tz, limit: 12 }),
      listTasks(c.userId, { view: "overdue", tz: c.tz, limit: 10 }),
      c.horizonDays > 0 ? listTasks(c.userId, { view: "upcoming", tz: c.tz, limit: 20 }) : Promise.resolve([]),
      taskCounts(c.userId, c.tz),
    ]);
    const slim = (t: (typeof today)[number]) => ({ id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority, projectId: t.projectId, goalId: t.goalId });
    return {
      counts,
      today: today.map(slim),
      overdue: overdue.map(slim),
      upcoming: upcoming.filter((t) => t.dueDate && t.dueDate > c.today && t.dueDate <= c.horizonEnd).map(slim),
    };
  },
  async calendar(c) {
    const to = new Date(c.horizonEnd + "T23:59:59");
    const rows = await listEvents(c.userId, { from: new Date(c.today + "T00:00:00"), to }).catch(() => []);
    const slim = rows.map((e) => ({ id: e.id, title: e.title, kind: e.kind, date: todayKey(c.tz, e.startAt), start: e.allDay ? null : hhmm(e.startAt, c.tz), end: e.allDay ? null : hhmm(e.endAt, c.tz), allDay: e.allDay, taskId: e.taskId, projectId: e.projectId, goalId: e.goalId }));
    return { today: slim.filter((e) => e.date === c.today), ahead: slim.filter((e) => e.date > c.today) };
  },
  async goals(c) {
    const rows = await listGoals(c.userId, "active", c.tz);
    return rows.map((g) => ({
      id: g.id, name: g.name, category: g.category, progress: g.progress, deadline: g.deadline,
      metric: g.metricTarget != null ? { current: g.metricCurrent ?? 0, target: g.metricTarget, unit: g.metricUnit } : null,
      tracks: isLinked(g) ? `${g.metricSource}/${g.metricKind} per ${g.metricPeriod}` : null,
      behindPace: isLinked(g) ? goalPace(g, c.today, c.tz).atRisk : false,
    }));
  },
  async projects(c) {
    const rows = await listProjects(c.userId, "active");
    return rows.map((p) => ({ id: p.id, name: p.name, status: p.status, progress: p.computedProgress, openTasks: p.openTasks, deadline: p.deadline, priority: p.priority }));
  },
  async training(c) {
    const [workout, week] = await Promise.all([workoutForDate(c.userId, c.today).catch(() => null), weeklyTrainingStatus(c.userId, c.tz).catch(() => null)]);
    return {
      week,
      today: workout ? {
        cycleDay: `${workout.dayIndex + 1}/${workout.plan.cycleLength}`,
        day: workout.day ? { name: workout.day.name, isRest: workout.day.isRest, exercises: workout.day.exercises.length, notes: workout.day.notes } : null,
        session: workout.session ? { id: workout.session.id, finished: Boolean(workout.session.finishedAt) } : null,
      } : null,
    };
  },
  async studies(c) {
    const [exams, assignments, week] = await Promise.all([
      listExams(c.userId, true, c.tz).catch(() => []),
      listAssignments(c.userId, true).catch(() => []),
      studyProgress(c.userId, { from: addDaysKey(c.today, -6), to: c.today }).catch(() => null),
    ]);
    return {
      minutesLast7Days: week?.totalMinutes ?? 0,
      bySubject: (week?.bySubject ?? []).map((s) => ({ name: s.name, minutes: s.minutes, weeklyGoalMinutes: s.weeklyGoalMinutes })),
      nextExams: exams.slice(0, 3).map((e) => ({ id: e.id, title: e.title, date: e.date, subject: e.subjectName })),
      nextAssignments: assignments.filter((a) => a.dueDate).slice(0, 3).map((a) => ({ id: a.id, title: a.title, dueDate: a.dueDate, subject: a.subjectName })),
    };
  },
  async german(c) {
    const s = await germanSummary(c.userId, { from: addDaysKey(c.today, -6), to: c.today }).catch(() => null);
    return s ? { minutesLast7Days: s.totalMinutes, streak: s.streak, unitsPassed: s.unitsPassed, lastStudyDay: s.lastStudyDay, xp: s.xp } : null;
  },
  async finance(c) {
    const f = await financialSummary(c.userId, { from: c.today.slice(0, 7) + "-01", to: c.today }).catch(() => null);
    if (!f) return null;
    return {
      month: c.today.slice(0, 7), income: f.income, expenses: f.expenses, net: f.net, savingsRate: f.savingsRate,
      topCategories: f.byCategory.slice(0, 3).map((x) => ({ name: x.name, total: x.total })),
      budgetsAtRisk: f.budgets.filter((b) => b.pct >= 80).map((b) => ({ name: b.name, pct: b.pct, remaining: b.remaining })),
      cashInFinanceAccounts: f.financeBalance,
    };
  },
  async nutrition(c) {
    const n = await dailyNutrition(c.userId, c.today).catch(() => null);
    return n ? { date: c.today, totals: n.totals, goals: n.goals, meals: n.meals.length, estimatedItems: n.estimatedItems } : null;
  },
  async reviews(c) {
    const [daily, weekly] = await Promise.all([latestReportRow(c.userId, "daily_review"), latestReportRow(c.userId, "weekly_review")]);
    const slim = (r: Awaited<ReturnType<typeof latestReportRow>>) => (r ? { periodKey: r.periodKey, createdAt: r.createdAt, excerpt: r.content.slice(0, 400) } : null);
    return { daily: slim(daily), weekly: slim(weekly) };
  },
};

export interface LifeSnapshot {
  today: string;
  tz: string;
  horizonDays: number;
  horizonEnd: string;
  sections: Partial<Record<SnapshotSection, unknown>>;
  source: "calculated";
}

/** Loads only the requested sections, in parallel. Unknown sections are ignored by the type system. */
export async function lifeSnapshot(user: SessionUser, opts: SnapshotOptions = {}): Promise<LifeSnapshot> {
  const tz = opts.tz ?? user.timezone;
  const today = todayKey(tz);
  const horizonDays = Math.max(0, Math.min(opts.horizonDays ?? 7, 31));
  const ctx: Ctx = { user, userId: user.id, tz, today, horizonDays, horizonEnd: addDaysKey(today, horizonDays) };
  const wanted = [...new Set(opts.sections ?? SNAPSHOT_SECTIONS)].filter((s): s is SnapshotSection => SNAPSHOT_SECTIONS.includes(s));
  const entries = await Promise.all(wanted.map(async (s) => [s, await LOADERS[s](ctx).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }))] as const));
  return { today, tz, horizonDays, horizonEnd: ctx.horizonEnd, sections: Object.fromEntries(entries), source: "calculated" };
}

type Sec<T> = T | undefined;
type TasksSec = Sec<{ counts: { today: number; overdue: number; open: number }; today: { id: string; title: string; dueDate: string | null; priority: string }[]; overdue: { id: string; title: string; dueDate: string | null }[]; upcoming: { title: string; dueDate: string | null }[] }>;
type CalSec = Sec<{ today: { title: string; kind: string; start: string | null; end: string | null; allDay: boolean }[]; ahead: { date: string; title: string }[] }>;
type GoalsSec = Sec<{ name: string; progress: number; deadline: string | null; metric: { current: number; target: number; unit: string | null } | null; behindPace: boolean }[]>;
type ProjSec = Sec<{ name: string; progress: number; openTasks: number; deadline: string | null }[]>;
type TrainSec = Sec<{ week: { completed: number; plannedDays: number | null } | null; today: { cycleDay: string; day: { name: string; isRest: boolean; exercises: number; notes: string | null } | null; session: { finished: boolean } | null } | null }>;
type StudySec = Sec<{ minutesLast7Days: number; nextExams: { title: string; date: string }[]; nextAssignments: { title: string; dueDate: string | null }[] }>;
type GermanSec = Sec<{ minutesLast7Days: number; streak: number; unitsPassed: number } | null>;
type FinSec = Sec<{ income: number; expenses: number; net: number; topCategories: { name: string; total: number }[]; budgetsAtRisk: { name: string; pct: number }[] } | null>;
type RevSec = Sec<{ daily: { periodKey: string } | null; weekly: { periodKey: string } | null }>;

/**
 * Compact rendering for the system prompt: one line per section, ids shortened, lists clipped.
 * Returns the lines plus what was clipped, so the caller can tell the model to use get_snapshot.
 */
export function renderCompact(snap: LifeSnapshot): string[] {
  const s = snap.sections;
  const lines: string[] = [];
  const t = s.tasks as TasksSec;
  if (t) {
    lines.push(`- Tasks: ${t.counts.open} open · ${t.counts.today} due today · ${t.counts.overdue} overdue.`);
    if (t.today.length) lines.push(`  Today: ${t.today.slice(0, 8).map((x) => `${x.title} [${x.priority}, id ${short(x.id)}]`).join("; ")}${t.today.length > 8 ? `; +${t.today.length - 8} more` : ""}`);
    if (t.overdue.length) lines.push(`  Overdue: ${t.overdue.slice(0, 5).map((x) => `${x.title} (${x.dueDate}, id ${short(x.id)})`).join("; ")}${t.overdue.length > 5 ? `; +${t.overdue.length - 5} more` : ""}`);
    if (t.upcoming.length) lines.push(`  Next ${snap.horizonDays} days: ${t.upcoming.length} tasks due.`);
  }
  const c = s.calendar as CalSec;
  if (c) {
    lines.push(`- Calendar today: ${c.today.map((e) => `${e.allDay ? "all day" : `${e.start}–${e.end}`} ${e.title} (${e.kind})`).join("; ") || "nothing scheduled"}`);
    if (c.ahead.length) lines.push(`  Ahead (${snap.horizonDays}d): ${c.ahead.length} events, next ${c.ahead.slice(0, 3).map((e) => `${e.date} ${e.title}`).join("; ")}`);
  }
  const g = s.goals as GoalsSec;
  if (g) lines.push(`- Active goals (${g.length}): ${g.slice(0, 6).map((x) => `${x.name} ${x.progress}%${x.metric ? ` (${x.metric.current}/${x.metric.target} ${x.metric.unit ?? ""})`.replace(" )", ")") : ""}${x.behindPace ? " BEHIND PACE" : ""}${x.deadline ? ` by ${x.deadline}` : ""}`).join("; ") || "none"}`);
  const p = s.projects as ProjSec;
  if (p) lines.push(`- Active projects (${p.length}): ${p.slice(0, 5).map((x) => `${x.name} ${x.progress}% · ${x.openTasks} open${x.deadline ? ` · by ${x.deadline}` : ""}`).join("; ") || "none"}`);
  const tr = s.training as TrainSec;
  if (tr) {
    const day = tr.today?.day;
    const state = tr.today?.session ? (tr.today.session.finished ? " (session finished)" : " (session in progress)") : "";
    lines.push(`- Training today${tr.today ? ` (cycle day ${tr.today.cycleDay})` : ""}: ${day ? (day.isRest ? `rest day${day.notes ? " — " + day.notes : ""}` : `${day.name} · ${day.exercises} exercises`) : "no active plan"}${state}`);
    if (tr.week) lines.push(`  This week: ${tr.week.completed} workout${tr.week.completed === 1 ? "" : "s"} done${tr.week.plannedDays != null ? ` of ${tr.week.plannedDays} training days the cycle places in this week` : ""}.`);
  }
  const st = s.studies as StudySec;
  if (st) {
    lines.push(`- Studies: ${st.minutesLast7Days} min in the last 7 days.`);
    if (st.nextExams.length) lines.push(`  Next exams: ${st.nextExams.map((e) => `${e.title} (${e.date})`).join("; ")}`);
    if (st.nextAssignments.length) lines.push(`  Next assignments: ${st.nextAssignments.map((a) => `${a.title} (due ${a.dueDate})`).join("; ")}`);
  }
  const de = s.german as GermanSec;
  if (de) lines.push(`- German: ${de.minutesLast7Days} min in the last 7 days · streak ${de.streak} · ${de.unitsPassed} units passed.`);
  const f = s.finance as FinSec;
  if (f) {
    lines.push(`- Finance this month: income ${f.income}, expenses ${f.expenses}, net ${f.net}${f.topCategories.length ? `, top ${f.topCategories.map((x) => `${x.name} ${x.total}`).join(", ")}` : ""}`);
    if (f.budgetsAtRisk.length) lines.push(`  Budgets at or above 80%: ${f.budgetsAtRisk.map((b) => `${b.name} ${b.pct}%`).join("; ")}`);
  }
  const r = s.reviews as RevSec;
  if (r) lines.push(`- Last reviews: daily ${r.daily?.periodKey ?? "none yet"} · weekly ${r.weekly?.periodKey ?? "none yet"}. Call get_snapshot(["reviews"]) to read them.`);
  return lines;
}

/**
 * Enforces the context budget: keeps whole lines until the cap is reached and appends an explicit
 * note, so the model knows the snapshot is partial instead of assuming it saw everything.
 */
export function fitToBudget(lines: string[], budget = SNAPSHOT_BUDGET_CHARS) {
  const out: string[] = [];
  let used = 0;
  let clipped = 0;
  for (const line of lines) {
    if (used + line.length + 1 > budget) { clipped++; continue; }
    out.push(line);
    used += line.length + 1;
  }
  if (clipped) out.push(`- (${clipped} snapshot lines omitted to stay within the context budget — call get_snapshot for the full picture.)`);
  return { lines: out, chars: used, clipped };
}
