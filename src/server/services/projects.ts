import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { milestones, projects, tasks } from "@/server/db/schema";
import { notFound } from "@/server/http";
import { dateSchema, prioritySchema } from "./tasks";
import { deriveProgress } from "./progress";
import { audit, type AuditActor } from "@/server/audit";
import { todayKey } from "@/lib/dates";

export const projectStatusSchema = z.enum(["idea", "planning", "active", "on_hold", "completed", "archived"]);
export const projectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullish(),
  kind: z.string().max(30).default("personal"),
  status: projectStatusSchema.default("active"),
  priority: prioritySchema.default("medium"),
  deadline: dateSchema.nullish(),
  goalId: z.string().uuid().nullish(),
  notes: z.string().max(20000).nullish(),
  progress: z.number().int().min(0).max(100).optional(),
  source: z.enum(["user", "ai", "import"]).default("user"),
});
export const projectUpdateSchema = projectCreateSchema.partial();

/** The counts `deriveProgress` needs, as correlated subqueries so one row comes back per project. */
const projectCounts = {
  openTasks: sql<number>`(select count(*) from tasks t where t.project_id = projects.id and t.status in ('todo','in_progress'))`,
  doneTasks: sql<number>`(select count(*) from tasks t where t.project_id = projects.id and t.status = 'done')`,
  totalMilestones: sql<number>`(select count(*) from milestones m where m.project_id = projects.id)`,
  doneMilestones: sql<number>`(select count(*) from milestones m where m.project_id = projects.id and m.completed_at is not null)`,
  overdueMilestones: sql<number>`(select count(*) from milestones m where m.project_id = projects.id and m.completed_at is null and m.due_date is not null and m.due_date < current_date)`,
  overdueTasks: sql<number>`(select count(*) from tasks t where t.project_id = projects.id and t.status in ('todo','in_progress') and t.due_date is not null and t.due_date < current_date)`,
};

const withProgress = <T extends { progress: number }>(project: T, c: Record<keyof typeof projectCounts, number>) => {
  const derived = deriveProgress(c, project.progress);
  return {
    ...project,
    openTasks: c.openTasks, doneTasks: c.doneTasks,
    totalMilestones: c.totalMilestones, doneMilestones: c.doneMilestones,
    overdueMilestones: c.overdueMilestones, overdueTasks: c.overdueTasks,
    computedProgress: derived.progress,
    progressBasis: derived.basis,
    progressDone: derived.done,
    progressTotal: derived.total,
  };
};

export async function listProjects(userId: string, status?: string) {
  const conds = [eq(projects.userId, userId)];
  if (status) conds.push(eq(projects.status, status as "active"));
  const rows = await db
    .select({ project: projects, ...projectCounts })
    .from(projects)
    .where(and(...conds))
    .orderBy(desc(projects.priority), asc(projects.deadline), asc(projects.name));
  return rows.map((r) => withProgress(r.project, {
    openTasks: Number(r.openTasks), doneTasks: Number(r.doneTasks),
    totalMilestones: Number(r.totalMilestones), doneMilestones: Number(r.doneMilestones),
    overdueMilestones: Number(r.overdueMilestones), overdueTasks: Number(r.overdueTasks),
  }));
}

/**
 * Recomputes and persists a project's progress from its own tasks and milestones.
 *
 * The stored column exists so aggregates (Analytics, and through it Reviews) do not have to re-derive
 * every project; this keeps it equal to what the detail page shows. It writes only on a real change,
 * which keeps it idempotent and keeps the audit log free of no-op entries.
 */
export async function recomputeProjectProgress(userId: string, projectId: string, cause: string) {
  const [row] = await db.select({ project: projects, ...projectCounts }).from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!row) return null;
  const counts = {
    openTasks: Number(row.openTasks), doneTasks: Number(row.doneTasks),
    totalMilestones: Number(row.totalMilestones), doneMilestones: Number(row.doneMilestones),
    overdueMilestones: Number(row.overdueMilestones), overdueTasks: Number(row.overdueTasks),
  };
  const derived = deriveProgress(counts, row.project.progress);
  if (derived.progress === row.project.progress) return row.project;
  const [next] = await db.update(projects).set({ progress: derived.progress })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId))).returning();
  await audit({ userId, actor: "system", action: "project.progress_recomputed", entityType: "project", entityId: projectId, metadata: { cause, basis: derived.basis, before: row.project.progress, after: derived.progress, done: derived.done, total: derived.total } });
  return next;
}

export async function getProject(userId: string, id: string) {
  const [p] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
  if (!p) throw notFound("Project");
  const ts = await db.select().from(tasks).where(and(eq(tasks.projectId, id), eq(tasks.userId, userId))).orderBy(asc(tasks.status), asc(tasks.dueDate), asc(tasks.position));
  const ms = await db.select().from(milestones).where(and(eq(milestones.projectId, id), eq(milestones.userId, userId))).orderBy(asc(milestones.position), asc(milestones.dueDate));
  const today = todayKey();
  const counts = {
    openTasks: ts.filter((t) => t.status === "todo" || t.status === "in_progress").length,
    doneTasks: ts.filter((t) => t.status === "done").length,
    totalMilestones: ms.length,
    doneMilestones: ms.filter((m) => m.completedAt).length,
    overdueMilestones: ms.filter((m) => !m.completedAt && m.dueDate && m.dueDate < today).length,
    overdueTasks: ts.filter((t) => (t.status === "todo" || t.status === "in_progress") && t.dueDate && t.dueDate < today).length,
  };
  return { ...withProgress(p, counts), tasks: ts, milestones: ms };
}

export async function createProject(userId: string, input: z.infer<typeof projectCreateSchema>, actor: AuditActor = "user") {
  const [p] = await db.insert(projects).values({ ...input, userId, progress: input.progress ?? 0, completedAt: input.status === "completed" ? new Date() : null }).returning();
  await audit({ userId, actor, action: "project.created", entityType: "project", entityId: p.id, metadata: { name: p.name, status: p.status } });
  return p;
}

export async function updateProject(userId: string, id: string, input: z.infer<typeof projectUpdateSchema>, actor: AuditActor = "user") {
  const current = await getProject(userId, id);
  // Completing keeps the original completion date; leaving "completed" clears it. An update that does
  // not mention status leaves it alone, so editing notes never re-dates a finished project.
  const completedAt = input.status === undefined ? undefined : input.status === "completed" ? current.completedAt ?? new Date() : null;
  const [p] = await db
    .update(projects)
    .set({ ...input, completedAt })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .returning();
  await audit({ userId, actor, action: "project.updated", entityType: "project", entityId: id, metadata: { fields: Object.keys(input), status: p.status, previousStatus: current.status } });
  return p;
}

export async function deleteProject(userId: string, id: string, actor: AuditActor = "user") {
  const current = await getProject(userId, id);
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
  await audit({ userId, actor, action: "project.deleted", entityType: "project", entityId: id, metadata: { name: current.name, tasks: current.tasks.length, milestones: current.milestones.length } });
  return { deleted: id };
}

export async function addProjectMilestone(userId: string, projectId: string, input: { title: string; dueDate?: string | null; position?: number }, actor: AuditActor = "user") {
  await getProject(userId, projectId);
  const [m] = await db.insert(milestones).values({ ...input, userId, projectId }).returning();
  await audit({ userId, actor, action: "milestone.created", entityType: "milestone", entityId: m.id, metadata: { projectId, title: m.title } });
  // A first milestone can change what progress is derived from, so the stored value is refreshed.
  await recomputeProjectProgress(userId, projectId, "milestone.created");
  return m;
}
