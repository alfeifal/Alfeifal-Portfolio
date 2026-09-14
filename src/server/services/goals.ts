import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { goals, milestones, tasks } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/http";
import { audit } from "@/server/audit";
import { emitDomainEvent } from "@/server/events/bus";
import type { GoalState } from "@/server/events/types";
import { clamp } from "@/lib/utils";
import { todayKey } from "@/lib/dates";
import { dateSchema, prioritySchema } from "./tasks";
import { METRIC_KIND_VALUES, METRIC_PERIOD_VALUES, METRIC_SOURCE_VALUES, computeGoalMetric, goalPace, isLinked, normalizeMetricLink, resolveTz, type MetricSource } from "./goal-metrics";
export { METRIC_SOURCES } from "./goal-metrics";

export const goalStatusSchema = z.enum(["active", "paused", "completed", "abandoned"]);
export const goalCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullish(),
  category: z.string().max(50).default("personal"),
  status: goalStatusSchema.default("active"),
  priority: prioritySchema.default("medium"),
  deadline: dateSchema.nullish(),
  progress: z.number().int().min(0).max(100).default(0),
  metricName: z.string().max(100).nullish(),
  metricUnit: z.string().max(30).nullish(),
  metricTarget: z.number().nullish(),
  metricCurrent: z.number().nullish(),
  /** Linked metric: progress computed from the module's own data. See METRIC_SOURCES for allowed kind/period per source. */
  metricSource: z.enum(METRIC_SOURCE_VALUES as [MetricSource, ...MetricSource[]]).nullish(),
  metricKind: z.enum(METRIC_KIND_VALUES as [string, ...string[]]).nullish(),
  metricRef: z.string().max(100).nullish(),
  metricPeriod: z.enum(METRIC_PERIOD_VALUES as ["week", "month", "total"]).nullish(),
  source: z.enum(["user", "ai", "import"]).default("user"),
});
export const goalUpdateSchema = goalCreateSchema.partial();
export const milestoneSchema = z.object({ title: z.string().min(1).max(200), dueDate: dateSchema.nullish(), position: z.number().int().default(0) });

type GoalRow = typeof goals.$inferSelect;

export async function listGoals(userId: string, status?: string, tz?: string) {
  const conds = [eq(goals.userId, userId)];
  if (status) conds.push(eq(goals.status, status as "active"));
  const rows = await db.select().from(goals).where(and(...conds)).orderBy(desc(goals.priority), asc(goals.deadline));
  // Linked goals are read from their source of truth: this catches period roll-overs (a new week/month) that no event announces.
  const stale = rows.filter((g) => isLinked(g) && g.status === "active");
  if (!stale.length) return rows;
  const refreshed = await recomputeLinkedGoals(userId, { goalIds: stale.map((g) => g.id), cause: "read", tz });
  return rows.map((g) => refreshed.byId.get(g.id) ?? g);
}

export async function getGoal(userId: string, id: string, tz?: string) {
  let [g] = await db.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)));
  if (!g) throw notFound("Goal");
  if (isLinked(g) && g.status === "active") g = (await recomputeLinkedGoals(userId, { goalIds: [id], cause: "read", tz })).byId.get(id) ?? g;
  const ms = await db.select().from(milestones).where(eq(milestones.goalId, id)).orderBy(asc(milestones.position), asc(milestones.dueDate));
  const ts = await db.select().from(tasks).where(and(eq(tasks.goalId, id), eq(tasks.userId, userId))).orderBy(asc(tasks.dueDate));
  const userTz = await resolveTz(userId, tz);
  const pace = isLinked(g) ? goalPace(g, todayKey(userTz), userTz) : null;
  return { ...g, milestones: ms, tasks: ts, pace };
}

function derivedProgress(input: { progress?: number; metricTarget?: number | null; metricCurrent?: number | null }) {
  if (input.metricTarget && input.metricTarget > 0 && input.metricCurrent != null) return clamp(Math.round((input.metricCurrent / input.metricTarget) * 100), 0, 100);
  return input.progress;
}

export async function createGoal(userId: string, input: z.infer<typeof goalCreateSchema>, tz?: string) {
  const normalized = normalizeMetricLink(input);
  const progress = derivedProgress(normalized) ?? 0;
  const [g] = await db.insert(goals).values({ ...normalized, userId, progress, completedAt: input.status === "completed" ? new Date() : null }).returning();
  if (isLinked(g)) return (await recomputeLinkedGoals(userId, { goalIds: [g.id], cause: "goal.created", tz })).byId.get(g.id) ?? g;
  return g;
}

export async function updateGoal(userId: string, id: string, input: z.infer<typeof goalUpdateSchema>, tz?: string) {
  const current = await getGoal(userId, id, tz);
  const merged = normalizeMetricLink({ ...current, ...input });
  if (merged.metricSource && (input.metricCurrent != null || input.progress != null)) {
    throw badRequest(`This goal's progress is computed from ${merged.metricSource} data (${merged.metricKind}); log the activity itself instead of editing the number.`);
  }
  const { milestones: _m, tasks: _t, pace: _p, ...row } = merged as typeof merged & { milestones?: unknown; tasks?: unknown; pace?: unknown };
  const progress = derivedProgress(row) ?? current.progress;
  const status = input.status ?? (progress >= 100 && current.status === "active" && !row.metricSource ? "completed" : current.status);
  const [g] = await db
    .update(goals)
    .set({ ...input, metricSource: row.metricSource, metricKind: row.metricKind, metricRef: row.metricRef, metricPeriod: row.metricPeriod, metricUnit: row.metricUnit, metricName: row.metricName, progress, status, completedAt: status === "completed" ? current.completedAt ?? new Date() : null })
    .where(and(eq(goals.id, id), eq(goals.userId, userId)))
    .returning();
  if (isLinked(g) && g.status === "active") return (await recomputeLinkedGoals(userId, { goalIds: [id], cause: "goal.updated", tz })).byId.get(id) ?? g;
  return g;
}

/** Manual progress. Refused for linked goals: their value comes from the owning module (log the activity instead). */
export async function updateGoalProgress(userId: string, id: string, input: { progress?: number; metricCurrent?: number; delta?: number }, tz?: string) {
  const g = await getGoal(userId, id, tz);
  if (isLinked(g)) throw badRequest(`Progress of "${g.name}" is computed from ${g.metricSource} data (${g.metricKind}, ${g.metricPeriod}); log the activity itself instead of editing the number.`);
  const metricCurrent = input.metricCurrent ?? (input.delta != null ? (g.metricCurrent ?? 0) + input.delta : g.metricCurrent);
  return updateGoal(userId, id, { progress: input.progress, metricCurrent }, tz);
}

const goalState = (g: GoalRow, today: string, tz: string): GoalState => ({ metricCurrent: g.metricCurrent, progress: g.progress, status: g.status, atRisk: goalPace(g, today, tz).atRisk });

/**
 * Recompute linked goals from their source of truth (phase 2). Idempotent: the value is a query result, so
 * running this for the same event twice — or for no event at all — cannot double count. Only goals whose
 * value actually changed are written, audited (actor "system", action goal.recomputed) and announced with a
 * `goal.progress_changed` event. Periodic goals (week/month) never auto-complete: they reset with the period.
 */
export async function recomputeLinkedGoals(userId: string, opts: { sources?: MetricSource[]; goalIds?: string[]; cause: string; tz?: string; depth?: number }) {
  const tz = await resolveTz(userId, opts.tz);
  const today = todayKey(tz);
  const conds = [eq(goals.userId, userId), eq(goals.status, "active"), isNotNull(goals.metricSource)];
  if (opts.goalIds) conds.push(inArray(goals.id, opts.goalIds));
  if (opts.sources) conds.push(inArray(goals.metricSource, opts.sources));
  const rows = await db.select().from(goals).where(and(...conds));
  const byId = new Map<string, GoalRow>();
  const changed: { goal: GoalRow; before: GoalState; after: GoalState }[] = [];
  for (const g of rows) {
    const value = await computeGoalMetric(userId, g, tz);
    if (g.metricCurrent === value) { byId.set(g.id, g); continue; }
    const progress = derivedProgress({ ...g, metricCurrent: value }) ?? g.progress;
    const completes = progress >= 100 && g.metricPeriod === "total";
    const [next] = await db
      .update(goals)
      .set({ metricCurrent: value, progress, status: completes ? "completed" : g.status, completedAt: completes ? g.completedAt ?? new Date() : g.completedAt })
      .where(and(eq(goals.id, g.id), eq(goals.userId, userId)))
      .returning();
    byId.set(g.id, next);
    const before = goalState(g, today, tz), after = goalState(next, today, tz);
    changed.push({ goal: next, before, after });
    await audit({ userId, actor: "system", action: "goal.recomputed", entityType: "goal", entityId: g.id, metadata: { cause: opts.cause, source: g.metricSource, kind: g.metricKind, period: g.metricPeriod, before, after } });
    await emitDomainEvent(userId, { type: "goal.progress_changed", goalId: g.id, name: g.name, cause: opts.cause, periodKey: goalPace(next, today, tz).key, unit: g.metricUnit, target: g.metricTarget, before, after }, { tz, depth: (opts.depth ?? 0) + 1 });
  }
  return { byId, changed };
}

export async function deleteGoal(userId: string, id: string) {
  await getGoal(userId, id);
  await db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)));
}

export async function addMilestone(userId: string, goalId: string, input: z.infer<typeof milestoneSchema>) {
  await getGoal(userId, goalId);
  const [m] = await db.insert(milestones).values({ ...input, userId, goalId }).returning();
  return m;
}
export async function toggleMilestone(userId: string, id: string, done: boolean) {
  const [m] = await db.update(milestones).set({ completedAt: done ? new Date() : null }).where(and(eq(milestones.id, id), eq(milestones.userId, userId))).returning();
  if (!m) throw notFound("Milestone");
  return m;
}
export async function deleteMilestone(userId: string, id: string) {
  await db.delete(milestones).where(and(eq(milestones.id, id), eq(milestones.userId, userId)));
}
