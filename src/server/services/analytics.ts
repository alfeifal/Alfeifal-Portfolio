import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { goals, projects, tasks } from "@/server/db/schema";
import { financialSummary, monthlyHistory } from "./finance";
import { trainingStats } from "./training";
import { studyProgress } from "./studies";
import { germanSummary } from "./german";
import { tradingStatistics } from "./trading";
import { nutritionSummary } from "./nutrition";
import { addDaysKey, todayKey } from "@/lib/dates";

export type Period = "week" | "month" | "quarter" | "year";

export function periodRange(period: Period, tz?: string, offset = 0) {
  const today = todayKey(tz);
  const days = { week: 7, month: 30, quarter: 90, year: 365 }[period];
  const to = addDaysKey(today, -offset * days);
  const from = addDaysKey(to, -(days - 1));
  return { from, to };
}

/** Cross-module analytics (spec §27), always computed from stored data. */
export async function analyticsOverview(userId: string, period: Period, tz?: string) {
  const range = periodRange(period, tz);
  const prev = periodRange(period, tz, 1);
  const [finance, financePrev, training, trainingPrev, studies, studiesPrev, german, tradingReal, tradingPaper, nutrition, months, taskStats, goalStats, projectStats] = await Promise.all([
    financialSummary(userId, range),
    financialSummary(userId, prev),
    trainingStats(userId, range),
    trainingStats(userId, prev),
    studyProgress(userId, range),
    studyProgress(userId, prev),
    germanSummary(userId, range),
    tradingStatistics(userId, "real", range),
    tradingStatistics(userId, "paper", range),
    nutritionSummary(userId, range),
    monthlyHistory(userId, 12),
    db.select({ done: sql<number>`count(*) filter (where ${tasks.status} = 'done' and ${tasks.completedAt} >= ${range.from}::date)`, created: sql<number>`count(*) filter (where ${tasks.createdAt} >= ${range.from}::date)`, open: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress'))`, overdue: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress') and ${tasks.dueDate} < ${todayKey(tz)})` }).from(tasks).where(eq(tasks.userId, userId)).then((r) => r[0]),
    db.select({ active: sql<number>`count(*) filter (where ${goals.status}='active')`, completed: sql<number>`count(*) filter (where ${goals.status}='completed')`, avgProgress: sql<number>`coalesce(avg(${goals.progress}) filter (where ${goals.status}='active'),0)` }).from(goals).where(eq(goals.userId, userId)).then((r) => r[0]),
    db.select({ active: sql<number>`count(*) filter (where ${projects.status}='active')`, completed: sql<number>`count(*) filter (where ${projects.status}='completed')` }).from(projects).where(eq(projects.userId, userId)).then((r) => r[0]),
  ]);
  const taskDaily = await db
    .select({ date: sql<string>`to_char(${tasks.completedAt}, 'YYYY-MM-DD')`, n: sql<number>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.status, "done"), gte(tasks.completedAt, new Date(range.from)), lte(tasks.completedAt, new Date(range.to + "T23:59:59Z"))))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return {
    period, range, previousRange: prev,
    finance: { current: { income: finance.income, expenses: finance.expenses, net: finance.net, savingsRate: finance.savingsRate, byCategory: finance.byCategory }, previous: { income: financePrev.income, expenses: financePrev.expenses, net: financePrev.net }, monthly: months, netWorth: finance.netWorth },
    training: { current: training, previous: { sessions: trainingPrev.sessions, volume: trainingPrev.volume, sets: trainingPrev.sets } },
    studies: { current: studies, previous: { totalMinutes: studiesPrev.totalMinutes } },
    german,
    trading: { real: tradingReal, paper: tradingPaper },
    nutrition,
    tasks: { done: Number(taskStats.done), created: Number(taskStats.created), open: Number(taskStats.open), overdue: Number(taskStats.overdue), daily: taskDaily.map((d) => ({ date: d.date, n: Number(d.n) })) },
    goals: { active: Number(goalStats.active), completed: Number(goalStats.completed), avgProgress: Math.round(Number(goalStats.avgProgress)) },
    projects: { active: Number(projectStats.active), completed: Number(projectStats.completed) },
    source: "calculated" as const,
  };
}
