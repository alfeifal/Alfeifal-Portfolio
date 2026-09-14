import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { goals, milestones, tasks } from "@/server/db/schema";
import { notFound } from "@/server/http";
import { clamp } from "@/lib/utils";
import { dateSchema, prioritySchema } from "./tasks";

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
  source: z.enum(["user", "ai", "import"]).default("user"),
});
export const goalUpdateSchema = goalCreateSchema.partial();
export const milestoneSchema = z.object({ title: z.string().min(1).max(200), dueDate: dateSchema.nullish(), position: z.number().int().default(0) });

export async function listGoals(userId: string, status?: string) {
  const conds = [eq(goals.userId, userId)];
  if (status) conds.push(eq(goals.status, status as "active"));
  return db.select().from(goals).where(and(...conds)).orderBy(desc(goals.priority), asc(goals.deadline));
}

export async function getGoal(userId: string, id: string) {
  const [g] = await db.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)));
  if (!g) throw notFound("Goal");
  const ms = await db.select().from(milestones).where(eq(milestones.goalId, id)).orderBy(asc(milestones.position), asc(milestones.dueDate));
  const ts = await db.select().from(tasks).where(and(eq(tasks.goalId, id), eq(tasks.userId, userId))).orderBy(asc(tasks.dueDate));
  return { ...g, milestones: ms, tasks: ts };
}

function derivedProgress(input: { progress?: number; metricTarget?: number | null; metricCurrent?: number | null }) {
  if (input.metricTarget && input.metricTarget > 0 && input.metricCurrent != null) return clamp(Math.round((input.metricCurrent / input.metricTarget) * 100), 0, 100);
  return input.progress;
}

export async function createGoal(userId: string, input: z.infer<typeof goalCreateSchema>) {
  const progress = derivedProgress(input) ?? 0;
  const [g] = await db.insert(goals).values({ ...input, userId, progress, completedAt: input.status === "completed" ? new Date() : null }).returning();
  return g;
}

export async function updateGoal(userId: string, id: string, input: z.infer<typeof goalUpdateSchema>) {
  const current = await getGoal(userId, id);
  const merged = { ...current, ...input };
  const progress = derivedProgress(merged) ?? current.progress;
  const status = input.status ?? (progress >= 100 && current.status === "active" ? "completed" : current.status);
  const [g] = await db
    .update(goals)
    .set({ ...input, progress, status, completedAt: status === "completed" ? current.completedAt ?? new Date() : null })
    .where(and(eq(goals.id, id), eq(goals.userId, userId)))
    .returning();
  return g;
}

export async function updateGoalProgress(userId: string, id: string, input: { progress?: number; metricCurrent?: number; delta?: number }) {
  const g = await getGoal(userId, id);
  const metricCurrent = input.metricCurrent ?? (input.delta != null ? (g.metricCurrent ?? 0) + input.delta : g.metricCurrent);
  return updateGoal(userId, id, { progress: input.progress, metricCurrent });
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
