import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { goals, studySessions, subjects, tasks, transactions, users, workoutSessions, workoutSets } from "@/server/db/schema";
import { badRequest } from "@/server/http";
import { addDaysKey, dateKey, daysBetween, isoWeekKey, monthRange, todayKey, weekRange } from "@/lib/dates";
import { clamp } from "@/lib/utils";
import { round2 } from "@/lib/money";
import { GERMAN_SUBJECT_SLUG } from "./studies";
import { getGermanState, unitsPassedFromState } from "./german";

/**
 * Linked goal metrics (phase 2). A linked goal never stores a counter of its own: its current value is a
 * query over the module that owns the data, so recomputing it any number of times gives the same answer.
 * Only metrics the system can compute exactly are offered here.
 */
export const METRIC_SOURCES = {
  tasks: {
    label: "Tasks",
    kinds: {
      completed_tasks: { unit: "tasks", label: "Completed tasks", periods: ["week", "month", "total"] as const, ref: "optional project id; without it, the tasks linked to this goal (task.goalId)" },
    },
  },
  training: {
    label: "Training",
    kinds: {
      completed_workouts: { unit: "workouts", label: "Workouts (sessions with at least one working set)", periods: ["week", "month", "total"] as const, ref: null },
      volume_kg: { unit: "kg", label: "Training volume (weight × reps, working sets)", periods: ["week", "month", "total"] as const, ref: null },
    },
  },
  study: {
    label: "Studies",
    kinds: {
      minutes: { unit: "min", label: "Study minutes", periods: ["week", "month", "total"] as const, ref: "optional subject id or slug; without it, all subjects" },
    },
  },
  german: {
    label: "German",
    kinds: {
      minutes: { unit: "min", label: "German study minutes", periods: ["week", "month", "total"] as const, ref: null },
      units_passed: { unit: "units", label: "German units passed (test ≥ 70 % in the module)", periods: ["total"] as const, ref: null },
    },
  },
  finance: {
    label: "Finance",
    kinds: {
      net_savings: { unit: "EUR", label: "Net savings (income − expenses, transfers excluded)", periods: ["week", "month", "total"] as const, ref: null },
      income: { unit: "EUR", label: "Income", periods: ["week", "month", "total"] as const, ref: null },
    },
  },
} as const;
export type MetricSource = keyof typeof METRIC_SOURCES;
export type MetricKind = { [S in MetricSource]: keyof (typeof METRIC_SOURCES)[S]["kinds"] }[MetricSource];
export type MetricPeriod = "week" | "month" | "total";
export const METRIC_SOURCE_VALUES = Object.keys(METRIC_SOURCES) as MetricSource[];
export const METRIC_KIND_VALUES = [...new Set(Object.values(METRIC_SOURCES).flatMap((s) => Object.keys(s.kinds)))] as MetricKind[];
export const METRIC_PERIOD_VALUES: MetricPeriod[] = ["week", "month", "total"];

export interface MetricLink { metricSource: MetricSource; metricKind: MetricKind; metricRef: string | null; metricPeriod: MetricPeriod }
type GoalRow = typeof goals.$inferSelect;

export function isLinked(g: Pick<GoalRow, "metricSource">): g is GoalRow & { metricSource: MetricSource } {
  return g.metricSource != null;
}

/**
 * Validates and completes the link fields of a goal (create/update, UI and AI). Throws a 400 with the allowed
 * combinations when the request cannot be computed. Legacy rule kept from phase 1: a goal with category
 * "german", unit "min" and a target is a German-minutes goal even if no source was given.
 */
export function normalizeMetricLink<T extends { category?: string | null; metricSource?: string | null; metricKind?: string | null; metricRef?: string | null; metricPeriod?: string | null; metricTarget?: number | null; metricUnit?: string | null; metricName?: string | null }>(input: T): T {
  let { metricSource, metricKind, metricPeriod } = input;
  if (!metricSource && input.category === "german" && input.metricUnit === "min" && input.metricTarget && input.metricTarget > 0) {
    metricSource = "german"; metricKind = "minutes"; metricPeriod = metricPeriod ?? "total";
  }
  if (!metricSource) return { ...input, metricSource: null, metricKind: null, metricRef: null, metricPeriod: null };
  const src = METRIC_SOURCES[metricSource as MetricSource];
  if (!src) throw badRequest(`Unknown metricSource "${metricSource}". Allowed: ${METRIC_SOURCE_VALUES.join(", ")}`);
  const kinds = src.kinds as Record<string, { unit: string; label: string; periods: readonly string[]; ref: string | null }>;
  const kind = metricKind ? kinds[metricKind] : undefined;
  if (!kind) throw badRequest(`metricKind for source "${metricSource}" must be one of: ${Object.keys(kinds).join(", ")}`);
  const period = (metricPeriod ?? (kind.periods.includes("week") ? "week" : "total")) as MetricPeriod;
  if (!kind.periods.includes(period)) throw badRequest(`metricPeriod for ${metricSource}/${metricKind} must be one of: ${kind.periods.join(", ")}`);
  if (!input.metricTarget || input.metricTarget <= 0) throw badRequest("A linked goal needs a positive metricTarget");
  if (input.metricRef && !kind.ref) throw badRequest(`${metricSource}/${metricKind} does not take a metricRef`);
  return { ...input, metricSource, metricKind, metricPeriod: period, metricRef: input.metricRef ?? null, metricUnit: input.metricUnit ?? kind.unit, metricName: input.metricName ?? kind.label };
}

export async function resolveTz(userId: string, tz?: string) {
  if (tz) return tz;
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  return u?.tz ?? "Europe/Madrid";
}

/** Date window (inclusive YYYY-MM-DD keys) a goal's metric is measured over, plus the key that identifies this period. */
export function metricPeriodBounds(g: Pick<GoalRow, "metricPeriod" | "createdAt" | "deadline">, today: string, tz = "UTC") {
  const anchor = new Date(today + "T12:00:00");
  if (g.metricPeriod === "week") {
    const from = dateKey(weekRange(anchor).start);
    return { from, to: addDaysKey(from, 6), key: isoWeekKey(anchor) };
  }
  if (g.metricPeriod === "month") {
    const m = monthRange(anchor);
    return { from: dateKey(m.start), to: dateKey(m.end), key: today.slice(0, 7) };
  }
  // total: from the day the goal was created (the goal's own timeline, in the user's timezone) until its deadline, if any
  const from = todayKey(tz, g.createdAt);
  return { from, to: g.deadline && g.deadline >= today ? g.deadline : "9999-12-31", key: "total" };
}

/**
 * Pace check with one explicit rule: a goal is *at risk* when at least 40 % of its period has elapsed and the
 * current value is below 75 % of the value a steady pace would have reached. Goals without a bounded period
 * (total without deadline) are never at risk.
 */
export function goalPace(g: Pick<GoalRow, "metricPeriod" | "createdAt" | "deadline" | "metricTarget" | "metricCurrent" | "progress" | "status">, today: string, tz = "UTC") {
  const b = metricPeriodBounds(g, today, tz);
  const end = b.to === "9999-12-31" ? null : b.to;
  if (!end || !g.metricTarget || g.metricTarget <= 0) return { ...b, elapsedFraction: null, expected: null, atRisk: false };
  const total = Math.max(1, daysBetween(b.from, end) + 1);
  const elapsed = clamp(daysBetween(b.from, today) + 1, 0, total);
  const elapsedFraction = elapsed / total;
  const expected = round2(elapsedFraction * g.metricTarget);
  const atRisk = g.status === "active" && g.progress < 100 && elapsedFraction >= 0.4 && (g.metricCurrent ?? 0) < expected * 0.75;
  return { ...b, elapsedFraction: round2(elapsedFraction), expected, atRisk };
}

async function resolveSubjectRef(userId: string, ref: string | null) {
  if (!ref) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  const [s] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.userId, userId), isUuid ? eq(subjects.id, ref) : eq(subjects.slug, ref))).limit(1);
  return s?.id ?? null;
}

/** The current value of a linked goal, read from the owning module. */
export async function computeGoalMetric(userId: string, g: GoalRow, tz: string): Promise<number> {
  if (!isLinked(g)) return g.metricCurrent ?? 0;
  const today = todayKey(tz);
  const { from, to } = metricPeriodBounds(g, today, tz);
  const localDate = (col: unknown) => sql`(${col} at time zone ${tz})::date`;
  switch (`${g.metricSource}/${g.metricKind}`) {
    case "tasks/completed_tasks": {
      const scope = g.metricRef ? eq(tasks.projectId, g.metricRef) : eq(tasks.goalId, g.id);
      const [r] = await db.select({ n: sql<number>`count(*)` }).from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.status, "done"), scope, sql`${tasks.completedAt} is not null`, gte(localDate(tasks.completedAt), from), lte(localDate(tasks.completedAt), to)));
      return Number(r.n);
    }
    case "training/completed_workouts": {
      const [r] = await db.select({ n: sql<number>`count(*)` }).from(workoutSessions).where(and(eq(workoutSessions.userId, userId), gte(workoutSessions.date, from), lte(workoutSessions.date, to), sql`exists (select 1 from workout_sets ws where ws.session_id = workout_sessions.id and not ws.is_warmup)`));
      return Number(r.n);
    }
    case "training/volume_kg": {
      const [r] = await db.select({ v: sql<number>`coalesce(sum(coalesce(${workoutSets.weightKg},0) * coalesce(${workoutSets.reps},0)),0)` }).from(workoutSets).innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId)).where(and(eq(workoutSets.userId, userId), eq(workoutSets.isWarmup, false), gte(workoutSessions.date, from), lte(workoutSessions.date, to)));
      return round2(Number(r.v));
    }
    case "study/minutes":
    case "german/minutes": {
      const subjectId = g.metricSource === "german" ? await resolveSubjectRef(userId, GERMAN_SUBJECT_SLUG) : await resolveSubjectRef(userId, g.metricRef);
      if (g.metricSource === "german" && !subjectId) return 0;
      const conds = [eq(studySessions.userId, userId), gte(studySessions.date, from), lte(studySessions.date, to)];
      if (subjectId) conds.push(eq(studySessions.subjectId, subjectId));
      const [r] = await db.select({ m: sql<number>`coalesce(sum(${studySessions.durationMinutes}),0)` }).from(studySessions).where(and(...conds));
      return Number(r.m);
    }
    case "german/units_passed": {
      const st = await getGermanState(userId);
      return unitsPassedFromState(st.state);
    }
    case "finance/net_savings":
    case "finance/income": {
      const types = g.metricKind === "income" ? ["income"] : ["income", "expense"];
      const rows = await db.select({ type: transactions.type, total: sql<number>`coalesce(sum(${transactions.amount}),0)` }).from(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.type, types as ("income" | "expense")[]), gte(transactions.date, from), lte(transactions.date, to))).groupBy(transactions.type);
      const income = Number(rows.find((r) => r.type === "income")?.total ?? 0);
      const expenses = Number(rows.find((r) => r.type === "expense")?.total ?? 0);
      return round2(g.metricKind === "income" ? income : income - expenses);
    }
    default:
      throw badRequest(`Unsupported metric ${g.metricSource}/${g.metricKind}`);
  }
}
