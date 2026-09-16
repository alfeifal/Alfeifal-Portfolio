import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { reviews } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/http";
import { analyticsOverview, changePct } from "./analytics";
import { addDaysKey, dateKey, isoWeekKey, monthRange, todayKey, weekRange } from "@/lib/dates";

/**
 * Periodic reviews (spec §29, phase 3.7).
 *
 * A review is a *projection* of Analytics, not a second implementation of it. Every number below is
 * read from `analyticsOverview`, which already computes each module's metrics through that module's own
 * service and already resolves the previous comparable window. Nothing here recomputes a metric, and
 * nothing here queries a domain table — so a figure in a review cannot drift from the same figure on
 * the Analytics screen.
 *
 * The three layers are kept apart because they carry different authority:
 *   facts        — measured. `null` means "not measured", and is never rendered as 0.
 *   trends       — the same measures against the previous period, `null` when there is nothing to compare.
 *   observations — derived by the rules in `deriveObservations`, in code, with the evidence attached.
 * AI insights are added afterwards by `attachAiInsights`, and the review is complete without them.
 */

export const reviewTypeSchema = z.enum(["weekly", "monthly"]);
export type ReviewType = z.infer<typeof reviewTypeSchema>;

/** Below this, a percentage over the period would be noise rather than a measurement. */
export const MIN_DAYS_FOR_RATE = 3;
/** A trend needs something to compare against on both sides. */
export const MIN_FOR_TREND = 1;

export type Sufficiency = "ok" | "insufficient" | "none";

/** What a module's data supports. `none` = nothing recorded, `insufficient` = too little to rate. */
export function sufficiency(records: number, daysCovered = MIN_DAYS_FOR_RATE): Sufficiency {
  if (records <= 0) return "none";
  if (daysCovered < MIN_DAYS_FOR_RATE) return "insufficient";
  return "ok";
}

export interface Observation {
  /** Which section it belongs to, so the UI can place it. */
  module: string;
  /** "fact" states something measured; "gap" reports missing data; "trend" reports a change. */
  kind: "fact" | "trend" | "gap";
  text: string;
  /** The metric values this statement rests on. An observation with no evidence is not emitted. */
  evidence: Record<string, number | string | null>;
}

/** Resolves the review type and an anchor date into inclusive bounds and the previous comparable period. */
export function reviewPeriod(type: ReviewType, anchor: string, tz?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw badRequest("The date must be YYYY-MM-DD");
  void tz;
  const d = new Date(anchor + "T12:00:00");
  if (type === "weekly") {
    const { start, end } = weekRange(d);
    const from = dateKey(start);
    const to = dateKey(end);
    return { from, to, previous: { from: addDaysKey(from, -7), to: addDaysKey(from, -1) } };
  }
  const { start, end } = monthRange(d);
  const from = dateKey(start);
  const to = dateKey(end);
  const prevEnd = addDaysKey(from, -1);
  const prev = monthRange(new Date(prevEnd + "T12:00:00"));
  return { from, to, previous: { from: dateKey(prev.start), to: dateKey(prev.end) } };
}

type Analytics = Awaited<ReturnType<typeof analyticsOverview>>;

/**
 * Turns the analytics payload into the review's structured facts.
 *
 * Every section reports its own `data` sufficiency alongside the numbers, so the UI can say "no data"
 * or "not enough data" instead of printing a zero that looks like a measurement.
 */
export function buildFacts(a: Analytics) {
  const days = a.rangeDays;
  return {
    period: { from: a.range.from, to: a.range.to, days, previous: a.previousRange },
    productivity: {
      data: sufficiency(a.productivity.created + a.productivity.done, days),
      created: a.productivity.created, completed: a.productivity.done,
      open: a.productivity.open, overdue: a.productivity.overdue,
      completionRate: a.productivity.completionRate, perDay: a.productivity.perDay,
    },
    training: {
      data: sufficiency(a.training.current.sessions, days),
      sessions: a.training.current.sessions, volume: a.training.current.volume,
      sets: a.training.current.sets, minutes: a.training.current.minutes,
      perWeek: a.training.perWeek,
      adherence: a.training.adherence, // plannedDays null when there is no active plan
    },
    nutrition: {
      data: sufficiency(a.nutrition.daysLogged, a.nutrition.daysLogged),
      daysLogged: a.nutrition.daysLogged, coverage: a.nutrition.coverage,
      average: a.nutrition.average, compliance: a.nutrition.compliance,
      consistency: a.nutrition.consistency,
    },
    finance: {
      data: sufficiency(a.finance.current.income + a.finance.current.expenses > 0 ? 1 : 0, days),
      income: a.finance.current.income, expenses: a.finance.current.expenses,
      net: a.finance.current.net, savingsRate: a.finance.current.savingsRate,
      topCategories: a.finance.current.byCategory.slice(0, 5),
      budgets: a.finance.budgets,
    },
    studies: {
      data: sufficiency(a.studies.current.totalMinutes, a.studies.consistency.daysStudied),
      minutes: a.studies.current.totalMinutes, bySubject: a.studies.current.bySubject,
      consistency: a.studies.consistency, exams: a.studies.exams, assignments: a.studies.assignments,
    },
    goals: {
      data: sufficiency(a.goals.active + a.goals.completed, days),
      active: a.goals.active, completed: a.goals.completed, avgProgress: a.goals.avgProgress,
      completedInRange: a.goals.completedInRange, pastDeadline: a.goals.pastDeadline,
      milestones: a.goals.milestones,
    },
    projects: {
      data: sufficiency(a.projects.active + a.projects.completed, days),
      active: a.projects.active, completed: a.projects.completed,
      avgProgress: a.projects.avgProgress, milestones: a.projects.milestones,
      completedInRange: a.projects.completedInRange, overdue: a.projects.overdue,
    },
    journal: {
      data: sufficiency(a.journal.entries, days),
      entries: a.journal.entries, daysWithEntry: a.journal.daysWithEntry,
      withMood: a.journal.withMood, avgMood: a.journal.avgMood,
    },
    calendar: {
      data: sufficiency(a.calendar.events, days),
      events: a.calendar.events, totalHours: a.calendar.totalHours, byKind: a.calendar.byKind,
    },
  };
}

/**
 * Period-over-period change, taken from Analytics where it already exists and computed with the same
 * `changePct` guard everywhere else. A `null` means "no comparable previous value", never 0 %.
 */
export function buildTrends(a: Analytics) {
  const prevNutrition = a.nutrition.previous.average;
  return {
    previousPeriod: a.previousRange,
    productivity: { completed: a.productivity.change.done, created: a.productivity.change.created, previous: a.productivity.previous },
    training: {
      sessions: a.training.change.sessions, volume: a.training.change.volume,
      previous: a.training.previous,
    },
    nutrition: {
      calories: a.nutrition.change.calories, protein: a.nutrition.change.protein,
      daysLogged: changePct(a.nutrition.daysLogged, a.nutrition.previous.daysLogged),
      previous: { average: prevNutrition, daysLogged: a.nutrition.previous.daysLogged },
    },
    finance: { income: a.finance.change.income, expenses: a.finance.change.expenses, net: a.finance.change.net, previous: a.finance.previous },
    studies: { minutes: a.studies.change.minutes, previous: a.studies.previous },
    investing: { changePct: a.investing.changePct, first: a.investing.first, last: a.investing.last },
  };
}

const arrow = (v: number | null) => (v == null ? "" : v > 0 ? `+${v}%` : `${v}%`);

/**
 * Derives statements from the facts, in code.
 *
 * Each rule only fires when the data it needs exists, and each statement carries the numbers it rests
 * on. Nothing here interprets motive, mood or health, and nothing here fires on an empty module: a
 * section with no records produces a `gap` observation saying so, not a zero dressed up as a result.
 */
export function deriveObservations(facts: ReturnType<typeof buildFacts>, trends: ReturnType<typeof buildTrends>): Observation[] {
  const out: Observation[] = [];
  const add = (o: Observation) => out.push(o);

  // ---- productivity
  const p = facts.productivity;
  if (p.data === "none") add({ module: "productivity", kind: "gap", text: "No tasks were created or completed in this period.", evidence: { created: p.created, completed: p.completed } });
  else {
    add({ module: "productivity", kind: "fact", text: `${p.completed} of ${p.created} tasks created in the period were completed${p.completionRate != null ? ` (${p.completionRate}%)` : ""}.`, evidence: { completed: p.completed, created: p.created, completionRate: p.completionRate } });
    if (p.overdue > 0) add({ module: "productivity", kind: "fact", text: `${p.overdue} task${p.overdue === 1 ? " is" : "s are"} past their due date.`, evidence: { overdue: p.overdue } });
    if (trends.productivity.completed != null) add({ module: "productivity", kind: "trend", text: `Tasks completed ${arrow(trends.productivity.completed)} against the previous period (${trends.productivity.previous.done} → ${p.completed}).`, evidence: { current: p.completed, previous: trends.productivity.previous.done, changePct: trends.productivity.completed } });
  }

  // ---- training
  const t = facts.training;
  if (t.data === "none") add({ module: "training", kind: "gap", text: "No training sessions were logged in this period.", evidence: { sessions: 0 } });
  else {
    add({ module: "training", kind: "fact", text: `${t.sessions} session${t.sessions === 1 ? "" : "s"}, ${t.volume} kg of total volume across ${t.sets} sets.`, evidence: { sessions: t.sessions, volume: t.volume, sets: t.sets } });
    if (trends.training.sessions != null) add({ module: "training", kind: "trend", text: `Sessions ${trends.training.sessions >= 0 ? "up" : "down"} ${arrow(trends.training.sessions)} against the previous period (${trends.training.previous.sessions} → ${t.sessions}).`, evidence: { current: t.sessions, previous: trends.training.previous.sessions, changePct: trends.training.sessions } });
  }
  // Adherence is only meaningful with an active plan and days that have already come due.
  if (t.adherence.plannedDays == null) add({ module: "training", kind: "gap", text: "No active training plan, so adherence cannot be measured.", evidence: { plannedDays: null } });
  else if (t.adherence.adherencePct == null) add({ module: "training", kind: "gap", text: "The plan placed no training day that has already come due in this period.", evidence: { plannedSoFar: t.adherence.plannedSoFar } });
  else {
    // Adherence is about the *planned* days that were hit. `completedDays` counts every day trained,
    // including unplanned ones, so using it here would read as "2 of the 1 planned days".
    const hit = (t.adherence.plannedSoFar ?? 0) - (t.adherence.missedDays ?? 0);
    add({ module: "training", kind: "fact", text: `${t.adherence.adherencePct}% adherence: ${hit} of the ${t.adherence.plannedSoFar} planned day${t.adherence.plannedSoFar === 1 ? "" : "s"} that have come due.`, evidence: { adherencePct: t.adherence.adherencePct, hit, plannedSoFar: t.adherence.plannedSoFar } });
    if ((t.adherence.extraDays ?? 0) > 0) add({ module: "training", kind: "fact", text: `${t.adherence.extraDays} session${t.adherence.extraDays === 1 ? "" : "s"} on days the cycle did not place one.`, evidence: { extraDays: t.adherence.extraDays } });
  }

  // ---- nutrition
  const n = facts.nutrition;
  if (n.data === "none") add({ module: "nutrition", kind: "gap", text: "Nothing was logged in Nutrition in this period.", evidence: { daysLogged: 0 } });
  else {
    add({ module: "nutrition", kind: "fact", text: `Logged on ${n.daysLogged} of ${n.coverage.daysInRange} days${n.coverage.pct != null ? ` (${n.coverage.pct}% coverage)` : ""}, averaging ${n.average.calories} kcal and ${n.average.protein} g of protein on the days logged.`, evidence: { daysLogged: n.daysLogged, coveragePct: n.coverage.pct, calories: n.average.calories, protein: n.average.protein } });
    if (n.data === "insufficient") add({ module: "nutrition", kind: "gap", text: `Only ${n.daysLogged} day${n.daysLogged === 1 ? "" : "s"} logged — too few to read the averages as representative of the period.`, evidence: { daysLogged: n.daysLogged, needed: MIN_DAYS_FOR_RATE } });
    else if (trends.nutrition.calories != null) add({ module: "nutrition", kind: "trend", text: `Average calories ${arrow(trends.nutrition.calories)} against the previous period.`, evidence: { changePct: trends.nutrition.calories, previous: trends.nutrition.previous.average.calories, current: n.average.calories } });
  }

  // ---- finance
  const f = facts.finance;
  if (f.data === "none") add({ module: "finance", kind: "gap", text: "No income or expenses were recorded in this period.", evidence: { income: f.income, expenses: f.expenses } });
  else {
    add({ module: "finance", kind: "fact", text: `Income ${f.income}, expenses ${f.expenses}, net ${f.net}${f.savingsRate != null ? ` (${f.savingsRate}% saved)` : ""}.`, evidence: { income: f.income, expenses: f.expenses, net: f.net, savingsRate: f.savingsRate } });
    if (trends.finance.expenses != null) add({ module: "finance", kind: "trend", text: `Expenses ${arrow(trends.finance.expenses)} against the previous period (${trends.finance.previous.expenses} → ${f.expenses}).`, evidence: { changePct: trends.finance.expenses, previous: trends.finance.previous.expenses, current: f.expenses } });
    const top = f.topCategories[0];
    if (top && f.expenses > 0) add({ module: "finance", kind: "fact", text: `The largest expense category was ${top.name} at ${Math.abs(top.total)}.`, evidence: { category: top.name, total: top.total } });
    for (const b of f.budgets.filter((x) => x.pct != null && x.pct >= 100)) add({ module: "finance", kind: "fact", text: `The ${b.name} budget is over its limit: ${b.spent} of ${b.amount}.`, evidence: { budget: b.name, spent: b.spent, amount: b.amount, pct: b.pct } });
  }

  // ---- studies
  const s = facts.studies;
  if (s.data === "none") add({ module: "studies", kind: "gap", text: "No study time was logged in this period.", evidence: { minutes: 0 } });
  else {
    add({ module: "studies", kind: "fact", text: `${s.minutes} minutes studied across ${s.consistency.daysStudied} of ${s.consistency.daysInRange} days.`, evidence: { minutes: s.minutes, daysStudied: s.consistency.daysStudied, daysInRange: s.consistency.daysInRange } });
    if (trends.studies.minutes != null) add({ module: "studies", kind: "trend", text: `Study minutes ${arrow(trends.studies.minutes)} against the previous period.`, evidence: { changePct: trends.studies.minutes, previous: trends.studies.previous.totalMinutes, current: s.minutes } });
  }
  if (s.exams.upcoming > 0) add({ module: "studies", kind: "fact", text: `${s.exams.upcoming} exam${s.exams.upcoming === 1 ? " is" : "s are"} still ahead.`, evidence: { upcoming: s.exams.upcoming } });
  if (s.assignments.overdue > 0) add({ module: "studies", kind: "fact", text: `${s.assignments.overdue} assignment${s.assignments.overdue === 1 ? " is" : "s are"} overdue.`, evidence: { overdue: s.assignments.overdue } });

  // ---- goals & projects
  const g = facts.goals;
  if (g.data === "none") add({ module: "goals", kind: "gap", text: "No goals are being tracked.", evidence: { active: 0 } });
  else {
    add({ module: "goals", kind: "fact", text: `${g.active} active goal${g.active === 1 ? "" : "s"}, average progress ${g.avgProgress}%.`, evidence: { active: g.active, avgProgress: g.avgProgress } });
    if (g.milestones.completedInRange > 0) add({ module: "goals", kind: "fact", text: `${g.milestones.completedInRange} milestone${g.milestones.completedInRange === 1 ? " was" : "s were"} completed in this period.`, evidence: { completedInRange: g.milestones.completedInRange } });
    if (g.pastDeadline > 0) add({ module: "goals", kind: "fact", text: `${g.pastDeadline} goal${g.pastDeadline === 1 ? " is" : "s are"} past their deadline and still open.`, evidence: { pastDeadline: g.pastDeadline } });
    if (g.milestones.overdue > 0) add({ module: "goals", kind: "fact", text: `${g.milestones.overdue} goal milestone${g.milestones.overdue === 1 ? " is" : "s are"} past their due date and still open.`, evidence: { overdue: g.milestones.overdue } });
  }
  const pr = facts.projects;
  if (pr.data === "none") add({ module: "projects", kind: "gap", text: "No projects are being tracked.", evidence: { active: 0 } });
  else {
    add({ module: "projects", kind: "fact", text: `${pr.active} active project${pr.active === 1 ? "" : "s"}, average progress ${pr.avgProgress}%.`, evidence: { active: pr.active, avgProgress: pr.avgProgress } });
    if (pr.completedInRange > 0) add({ module: "projects", kind: "fact", text: `${pr.completedInRange} project${pr.completedInRange === 1 ? " was" : "s were"} completed in this period.`, evidence: { completedInRange: pr.completedInRange } });
    if (pr.overdue > 0) add({ module: "projects", kind: "fact", text: `${pr.overdue} project${pr.overdue === 1 ? " is" : "s are"} past their deadline and still open.`, evidence: { overdue: pr.overdue } });
    if (pr.milestones.overdue > 0) add({ module: "projects", kind: "fact", text: `${pr.milestones.overdue} project milestone${pr.milestones.overdue === 1 ? " is" : "s are"} past their due date and still open.`, evidence: { overdue: pr.milestones.overdue } });
  }

  // ---- journal & calendar
  const j = facts.journal;
  if (j.data === "none") add({ module: "journal", kind: "gap", text: "No journal entries in this period.", evidence: { entries: 0 } });
  else add({ module: "journal", kind: "fact", text: `${j.entries} journal entr${j.entries === 1 ? "y" : "ies"} across ${j.daysWithEntry} days.`, evidence: { entries: j.entries, daysWithEntry: j.daysWithEntry } });
  const c = facts.calendar;
  if (c.data !== "none") add({ module: "calendar", kind: "fact", text: `${c.events} calendar event${c.events === 1 ? "" : "s"}, ${c.totalHours} hours in total.`, evidence: { events: c.events, totalHours: c.totalHours } });

  return out;
}

export interface GeneratedReview {
  type: ReviewType;
  periodStart: string;
  periodEnd: string;
  facts: ReturnType<typeof buildFacts>;
  trends: ReturnType<typeof buildTrends>;
  observations: Observation[];
}

/**
 * Computes a review without persisting it. Needs no API key: it is Analytics plus the rules above.
 */
export async function computeReview(userId: string, type: ReviewType, anchor?: string, tz?: string): Promise<GeneratedReview> {
  const period = reviewPeriod(type, anchor ?? todayKey(tz), tz);
  const a = await analyticsOverview(userId, { from: period.from, to: period.to }, tz);
  const facts = buildFacts(a);
  const trends = buildTrends(a);
  return { type, periodStart: period.from, periodEnd: period.to, facts, trends, observations: deriveObservations(facts, trends) };
}

/**
 * Generates and stores a review.
 *
 * Regeneration is an update in place, keyed by (user, type, periodStart, periodEnd): pressing Generate
 * twice refreshes the numbers of the same review rather than creating a second one, and the user's own
 * notes — and the status they imply — survive untouched. AI insights are dropped on regeneration because
 * they described the previous numbers; they are re-attached explicitly.
 */
export async function generateReview(userId: string, type: ReviewType, anchor?: string, tz?: string) {
  const r = await computeReview(userId, type, anchor, tz);
  const [row] = await db
    .insert(reviews)
    .values({ userId, type: r.type, periodStart: r.periodStart, periodEnd: r.periodEnd, facts: r.facts, trends: r.trends, observations: r.observations, generatedAt: new Date() })
    .onConflictDoUpdate({
      target: [reviews.userId, reviews.type, reviews.periodStart, reviews.periodEnd],
      set: { facts: r.facts, trends: r.trends, observations: r.observations, generatedAt: new Date(), updatedAt: new Date(), aiInsights: null, aiGeneratedAt: null, aiModel: null },
    })
    .returning();
  return row;
}

export async function getReview(userId: string, id: string) {
  const [row] = await db.select().from(reviews).where(and(eq(reviews.id, id), eq(reviews.userId, userId)));
  if (!row) throw notFound("Review");
  return row;
}

/** The stored review for a period, or null. Used to show what exists before generating again. */
export async function findReview(userId: string, type: ReviewType, periodStart: string, periodEnd: string) {
  const [row] = await db.select().from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.type, type), eq(reviews.periodStart, periodStart), eq(reviews.periodEnd, periodEnd)));
  return row ?? null;
}

export async function listReviews(userId: string, opts: { type?: ReviewType; limit?: number; from?: string; to?: string } = {}) {
  const conds = [eq(reviews.userId, userId)];
  if (opts.type) conds.push(eq(reviews.type, opts.type));
  if (opts.from) conds.push(gte(reviews.periodEnd, opts.from));
  if (opts.to) conds.push(lte(reviews.periodStart, opts.to));
  return db.select().from(reviews).where(and(...conds)).orderBy(desc(reviews.periodEnd), desc(reviews.generatedAt)).limit(Math.min(Math.max(opts.limit ?? 24, 1), 100));
}

export const notesSchema = z.object({ userNotes: z.string().max(5000).nullable() });

/**
 * Saves the user's own notes. Writing a note marks the review `reviewed`; clearing it returns the
 * review to `generated`. Nothing else on the review is touched — in particular this never edits facts.
 */
export async function setUserNotes(userId: string, id: string, userNotes: string | null) {
  const text = userNotes?.trim() ? userNotes.trim() : null;
  const [row] = await db.update(reviews)
    .set({ userNotes: text, status: text ? "reviewed" : "generated", updatedAt: new Date() })
    .where(and(eq(reviews.id, id), eq(reviews.userId, userId)))
    .returning();
  if (!row) throw notFound("Review");
  return row;
}

export async function deleteReview(userId: string, id: string) {
  const [row] = await db.delete(reviews).where(and(eq(reviews.id, id), eq(reviews.userId, userId))).returning({ id: reviews.id });
  if (!row) throw notFound("Review");
  return { deleted: row.id };
}

/** Counts, for the compact snapshot: how many reviews exist and when the last period ended. */
export async function reviewsDigest(userId: string) {
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    lastEnd: sql<string | null>`max(${reviews.periodEnd})`,
  }).from(reviews).where(eq(reviews.userId, userId));
  return { total: Number(row?.total ?? 0), lastPeriodEnd: row?.lastEnd ?? null };
}

/** Human-readable label for a period: the month for a monthly review, the ISO week for a weekly one. */
export function periodLabel(type: ReviewType, periodStart: string, periodEnd: string) {
  return type === "monthly" ? periodStart.slice(0, 7) : `${isoWeekKey(new Date(periodStart + "T12:00:00"))} (${periodStart} → ${periodEnd})`;
}
