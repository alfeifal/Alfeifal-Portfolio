import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { assignments, events, exams, goals, journalEntries, milestones, projects, tasks } from "@/server/db/schema";
import { financialSummary, monthlyHistory } from "./finance";
import { trainingAdherence, trainingStats } from "./training";
import { studyProgress } from "./studies";
import { germanSummary } from "./german";
import { tradingStatistics } from "./trading";
import { nutritionGoals, nutritionSummary, consistencyOf } from "./nutrition";
import { portfolioHistory } from "./investing";
import { badRequest } from "@/server/http";
import { addDaysKey, daysBetween, todayKey } from "@/lib/dates";
import { round2 } from "@/lib/money";

export type Period = "week" | "month" | "quarter" | "year" | "custom";
export const PERIOD_DAYS = { week: 7, month: 30, quarter: 90, year: 365 } as const;
/** A custom range cannot be unbounded: the aggregations stay cheap and the charts stay readable. */
export const MAX_CUSTOM_DAYS = 400;

export function periodRange(period: Period, tz?: string, offset = 0) {
  const today = todayKey(tz);
  const days = PERIOD_DAYS[period === "custom" ? "month" : period];
  const to = addDaysKey(today, -offset * days);
  const from = addDaysKey(to, -(days - 1));
  return { from, to };
}

/** Resolves what the caller asked for into a validated window, plus the equally long window before it. */
export function resolveRange(input: { period?: Period; from?: string; to?: string }, tz?: string) {
  if (input.from || input.to) {
    const from = input.from ?? input.to!;
    const to = input.to ?? input.from!;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest("Dates must be YYYY-MM-DD");
    if (to < from) throw badRequest("The end of the range cannot be before its start");
    const days = daysBetween(from, to) + 1;
    if (days > MAX_CUSTOM_DAYS) throw badRequest(`A custom range cannot be longer than ${MAX_CUSTOM_DAYS} days`);
    const prevTo = addDaysKey(from, -1);
    return { period: "custom" as Period, days, range: { from, to }, previous: { from: addDaysKey(prevTo, -(days - 1)), to: prevTo } };
  }
  const period = input.period ?? "week";
  const days = PERIOD_DAYS[period === "custom" ? "month" : period];
  return { period, days, range: periodRange(period, tz), previous: periodRange(period, tz, 1) };
}

/** Percentage that refuses to divide by zero: no NaN, no Infinity, no invented denominator. */
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
/** Change against the previous period, as a share. Null when there is nothing to compare against. */
export const changePct = (current: number, previous: number) => (previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 100));

/**
 * Cross-module analytics (spec §27), always computed from stored records — never estimated, never
 * mocked. Every section reuses the module's own service, so a number here can only differ from the
 * module screen if the underlying service changed. Rates are null instead of NaN when the denominator
 * is zero, and sections report how much data they had so the UI can say "not enough" honestly.
 */
export async function analyticsOverview(userId: string, periodOrOpts: Period | { period?: Period; from?: string; to?: string }, tz?: string) {
  const resolved = resolveRange(typeof periodOrOpts === "string" ? { period: periodOrOpts } : periodOrOpts, tz);
  const { range, previous: prev, period, days: rangeDays } = resolved;
  const today = todayKey(tz);
  const [finance, financePrev, training, trainingPrev, adherence, studies, studiesPrev, german, tradingReal, tradingPaper, nutrition, nutritionPrev, nutriGoals, months, portfolio, taskStats, goalStats, projectStats] = await Promise.all([
    financialSummary(userId, range),
    financialSummary(userId, prev),
    trainingStats(userId, range),
    trainingStats(userId, prev),
    trainingAdherence(userId, range, tz),
    studyProgress(userId, range),
    studyProgress(userId, prev),
    germanSummary(userId, range),
    tradingStatistics(userId, "real", range),
    tradingStatistics(userId, "paper", range),
    nutritionSummary(userId, range),
    nutritionSummary(userId, prev),
    nutritionGoals(userId),
    monthlyHistory(userId, 12),
    portfolioHistory(userId, 120).catch(() => []),
    // Both ends are bounded: a review of a past week must not count what happened after it.
    db.select({
      done: sql<number>`count(*) filter (where ${tasks.status} = 'done' and ${tasks.completedAt} >= ${range.from}::date and ${tasks.completedAt} < ${range.to}::date + interval '1 day')`,
      created: sql<number>`count(*) filter (where ${tasks.createdAt} >= ${range.from}::date and ${tasks.createdAt} < ${range.to}::date + interval '1 day')`,
      donePrev: sql<number>`count(*) filter (where ${tasks.status} = 'done' and ${tasks.completedAt} >= ${prev.from}::date and ${tasks.completedAt} < ${prev.to}::date + interval '1 day')`,
      createdPrev: sql<number>`count(*) filter (where ${tasks.createdAt} >= ${prev.from}::date and ${tasks.createdAt} < ${prev.to}::date + interval '1 day')`,
      open: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress'))`,
      overdue: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress') and ${tasks.dueDate} < ${todayKey(tz)})`,
    }).from(tasks).where(eq(tasks.userId, userId)).then((r) => r[0]),
    db.select({ active: sql<number>`count(*) filter (where ${goals.status}='active')`, completed: sql<number>`count(*) filter (where ${goals.status}='completed')`, avgProgress: sql<number>`coalesce(avg(${goals.progress}) filter (where ${goals.status}='active'),0)`, completedInRange: sql<number>`count(*) filter (where ${goals.status}='completed' and ${goals.completedAt} >= ${range.from}::date and ${goals.completedAt} <= ${range.to}::date + interval '1 day')`, linked: sql<number>`count(*) filter (where ${goals.metricSource} is not null)`, atRisk: sql<number>`count(*) filter (where ${goals.status}='active' and ${goals.deadline} is not null and ${goals.deadline} < ${todayKey(tz)})` }).from(goals).where(eq(goals.userId, userId)).then((r) => r[0]),
    db.select({ active: sql<number>`count(*) filter (where ${projects.status}='active')`, completed: sql<number>`count(*) filter (where ${projects.status}='completed')`, total: sql<number>`count(*)`, avgProgress: sql<number>`coalesce(avg(${projects.progress}) filter (where ${projects.status}='active'),0)` }).from(projects).where(eq(projects.userId, userId)).then((r) => r[0]),
  ]);

  // --- Productivity: created and completed per day, plus the weekday distribution of completions.
  const [taskDaily, taskWeekday, milestoneStats, calendarByKind, journalStats, studyDays, examStats, assignmentStats] = await Promise.all([
    db.select({ date: sql<string>`to_char((${tasks.completedAt} at time zone ${tz ?? "UTC"})::date, 'YYYY-MM-DD')`, n: sql<number>`count(*)` }).from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, "done"), gte(tasks.completedAt, new Date(range.from)), lte(tasks.completedAt, new Date(range.to + "T23:59:59Z"))))
      .groupBy(sql`1`).orderBy(sql`1`),
    db.select({ dow: sql<number>`extract(isodow from (${tasks.completedAt} at time zone ${tz ?? "UTC"}))`, n: sql<number>`count(*)` }).from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, "done"), gte(tasks.completedAt, new Date(range.from)), lte(tasks.completedAt, new Date(range.to + "T23:59:59Z"))))
      .groupBy(sql`1`).orderBy(sql`1`),
    db.select({ total: sql<number>`count(*)`, completed: sql<number>`count(*) filter (where ${milestones.completedAt} is not null)`, completedInRange: sql<number>`count(*) filter (where ${milestones.completedAt} >= ${range.from}::date and ${milestones.completedAt} <= ${range.to}::date + interval '1 day')`, forGoals: sql<number>`count(*) filter (where ${milestones.goalId} is not null)`, forProjects: sql<number>`count(*) filter (where ${milestones.projectId} is not null)` }).from(milestones).where(eq(milestones.userId, userId)).then((r) => r[0]),
    db.select({ kind: events.kind, n: sql<number>`count(*)`, minutes: sql<number>`coalesce(sum(extract(epoch from (${events.endAt} - ${events.startAt})) / 60), 0)` }).from(events)
      .where(and(eq(events.userId, userId), gte(events.startAt, new Date(range.from + "T00:00:00")), lte(events.startAt, new Date(range.to + "T23:59:59"))))
      .groupBy(events.kind).orderBy(sql`2 desc`),
    db.select({ entries: sql<number>`count(*)`, days: sql<number>`count(distinct ${journalEntries.date})`, withMood: sql<number>`count(*) filter (where ${journalEntries.mood} is not null)`, avgMood: sql<number>`avg(${journalEntries.mood})` }).from(journalEntries)
      .where(and(eq(journalEntries.userId, userId), gte(journalEntries.date, range.from), lte(journalEntries.date, range.to))).then((r) => r[0]),
    db.select({ days: sql<number>`count(distinct date)` }).from(sql`(select date from study_sessions where user_id = ${userId} and date >= ${range.from} and date <= ${range.to}) s`).then((r) => Number(r[0]?.days ?? 0)),
    db.select({ total: sql<number>`count(*)`, upcoming: sql<number>`count(*) filter (where ${exams.date} >= ${today})`, inRange: sql<number>`count(*) filter (where ${exams.date} >= ${range.from} and ${exams.date} <= ${range.to})`, withResult: sql<number>`count(*) filter (where ${exams.result} is not null)` }).from(exams).where(eq(exams.userId, userId)).then((r) => r[0]),
    db.select({ total: sql<number>`count(*)`, open: sql<number>`count(*) filter (where ${assignments.completedAt} is null)`, overdue: sql<number>`count(*) filter (where ${assignments.completedAt} is null and ${assignments.dueDate} < ${today})`, completedInRange: sql<number>`count(*) filter (where ${assignments.completedAt} >= ${range.from}::date and ${assignments.completedAt} <= ${range.to}::date + interval '1 day')` }).from(assignments).where(eq(assignments.userId, userId)).then((r) => r[0]),
  ]);

  const done = Number(taskStats.done), created = Number(taskStats.created);
  const nutritionDaily = nutrition.daily;
  const nutritionOnTarget = (key: "calories" | "protein" | "carbs" | "fat") => {
    const target = nutriGoals[key];
    if (!target) return null;
    // "On target" = within 10% of the goal for that day.
    return nutritionDaily.filter((d) => Math.abs(d[key] - target) <= target * 0.1).length;
  };
  const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return {
    period, range, previousRange: prev, rangeDays,
    finance: {
      current: { income: finance.income, expenses: finance.expenses, net: finance.net, savingsRate: finance.savingsRate, byCategory: finance.byCategory },
      previous: { income: financePrev.income, expenses: financePrev.expenses, net: financePrev.net },
      change: { income: changePct(finance.income, financePrev.income), expenses: changePct(finance.expenses, financePrev.expenses), net: changePct(finance.net, financePrev.net) },
      monthly: months, financeBalance: finance.financeBalance,
      budgets: finance.budgets.map((b) => ({ id: b.id, name: b.name, amount: b.amount, spent: b.spent, remaining: b.remaining, pct: b.pct })),
    },
    training: {
      current: training,
      previous: { sessions: trainingPrev.sessions, volume: trainingPrev.volume, sets: trainingPrev.sets, minutes: trainingPrev.minutes },
      change: { sessions: changePct(training.sessions, trainingPrev.sessions), volume: changePct(training.volume, trainingPrev.volume) },
      adherence: { plannedDays: adherence.plannedDays, plannedSoFar: adherence.plannedSoFar, completedDays: adherence.completedDays, missedDays: adherence.missedDays, extraDays: adherence.extraDays, adherencePct: adherence.adherencePct },
      perWeek: rangeDays >= 7 ? round2((training.sessions * 7) / rangeDays) : null,
    },
    studies: {
      current: studies,
      previous: { totalMinutes: studiesPrev.totalMinutes },
      change: { minutes: changePct(studies.totalMinutes, studiesPrev.totalMinutes) },
      consistency: { daysStudied: studyDays, daysInRange: rangeDays, pct: pct(studyDays, rangeDays), avgMinutesPerStudyDay: studyDays > 0 ? round2(studies.totalMinutes / studyDays) : null },
      exams: { total: Number(examStats.total), upcoming: Number(examStats.upcoming), inRange: Number(examStats.inRange), withResult: Number(examStats.withResult) },
      assignments: { total: Number(assignmentStats.total), open: Number(assignmentStats.open), overdue: Number(assignmentStats.overdue), completedInRange: Number(assignmentStats.completedInRange) },
    },
    german,
    trading: { real: tradingReal, paper: tradingPaper },
    nutrition: {
      ...nutrition,
      previous: { average: nutritionPrev.average, daysLogged: nutritionPrev.daysLogged },
      change: { calories: changePct(nutrition.average.calories, nutritionPrev.average.calories), protein: changePct(nutrition.average.protein, nutritionPrev.average.protein) },
      coverage: { daysLogged: nutrition.daysLogged, daysInRange: rangeDays, pct: pct(nutrition.daysLogged, rangeDays) },
      compliance: {
        calories: { target: nutriGoals.calories, daysOnTarget: nutritionOnTarget("calories"), pct: pct(nutritionOnTarget("calories") ?? 0, nutrition.daysLogged) },
        protein: { target: nutriGoals.protein, daysOnTarget: nutritionOnTarget("protein"), pct: pct(nutritionOnTarget("protein") ?? 0, nutrition.daysLogged) },
        carbs: { target: nutriGoals.carbs, daysOnTarget: nutritionOnTarget("carbs"), pct: pct(nutritionOnTarget("carbs") ?? 0, nutrition.daysLogged) },
        fat: { target: nutriGoals.fat, daysOnTarget: nutritionOnTarget("fat"), pct: pct(nutritionOnTarget("fat") ?? 0, nutrition.daysLogged) },
      },
      // The same Atwater check the entries obey, applied to the period's average.
      consistency: consistencyOf(nutrition.average),
    },
    productivity: {
      done, created, open: Number(taskStats.open), overdue: Number(taskStats.overdue),
      previous: { done: Number(taskStats.donePrev), created: Number(taskStats.createdPrev) },
      change: { done: changePct(done, Number(taskStats.donePrev)), created: changePct(created, Number(taskStats.createdPrev)) },
      completionRate: pct(done, created),
      perDay: rangeDays > 0 ? round2(done / rangeDays) : null,
      daily: taskDaily.map((d) => ({ date: d.date, n: Number(d.n) })),
      byWeekday: weekdayNames.map((name, i) => ({ day: name, n: Number(taskWeekday.find((w) => Number(w.dow) === i + 1)?.n ?? 0) })),
    },
    calendar: {
      byKind: calendarByKind.map((k) => ({ kind: k.kind, events: Number(k.n), hours: round2(Number(k.minutes) / 60) })),
      totalHours: round2(calendarByKind.reduce((a, k) => a + Number(k.minutes), 0) / 60),
      events: calendarByKind.reduce((a, k) => a + Number(k.n), 0),
    },
    journal: {
      entries: Number(journalStats.entries), daysWithEntry: Number(journalStats.days), daysInRange: rangeDays,
      withMood: Number(journalStats.withMood),
      avgMood: journalStats.avgMood != null ? round2(Number(journalStats.avgMood)) : null,
    },
    investing: {
      snapshots: portfolio.map((p) => ({ date: p.date, totalValue: p.totalValue, cash: p.cash })),
      first: portfolio[0] ? { date: portfolio[0].date, totalValue: portfolio[0].totalValue } : null,
      last: portfolio.at(-1) ? { date: portfolio.at(-1)!.date, totalValue: portfolio.at(-1)!.totalValue } : null,
      changePct: portfolio.length >= 2 && portfolio[0].totalValue > 0 ? changePct(portfolio.at(-1)!.totalValue, portfolio[0].totalValue) : null,
    },
    goals: {
      active: Number(goalStats.active), completed: Number(goalStats.completed), avgProgress: Math.round(Number(goalStats.avgProgress)),
      completedInRange: Number(goalStats.completedInRange), linked: Number(goalStats.linked), pastDeadline: Number(goalStats.atRisk),
      milestones: { total: Number(milestoneStats.forGoals), completed: Number(milestoneStats.completed), completedInRange: Number(milestoneStats.completedInRange) },
    },
    projects: {
      active: Number(projectStats.active), completed: Number(projectStats.completed), total: Number(projectStats.total),
      avgProgress: Math.round(Number(projectStats.avgProgress)),
      milestones: { total: Number(milestoneStats.forProjects) },
    },
    source: "calculated" as const,
  };
}
