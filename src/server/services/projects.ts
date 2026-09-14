import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { milestones, projects, tasks } from "@/server/db/schema";
import { notFound } from "@/server/http";
import { dateSchema, prioritySchema } from "./tasks";

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

export async function listProjects(userId: string, status?: string) {
  const conds = [eq(projects.userId, userId)];
  if (status) conds.push(eq(projects.status, status as "active"));
  const rows = await db
    .select({
      project: projects,
      openTasks: sql<number>`(select count(*) from tasks t where t.project_id = projects.id and t.status in ('todo','in_progress'))`,
      doneTasks: sql<number>`(select count(*) from tasks t where t.project_id = projects.id and t.status = 'done')`,
    })
    .from(projects)
    .where(and(...conds))
    .orderBy(desc(projects.priority), asc(projects.deadline), asc(projects.name));
  return rows.map((r) => ({ ...r.project, openTasks: Number(r.openTasks), doneTasks: Number(r.doneTasks), computedProgress: computeProgress(r.project.progress, Number(r.openTasks), Number(r.doneTasks)) }));
}

function computeProgress(manual: number, open: number, done: number) {
  const total = open + done;
  if (total === 0) return manual;
  return Math.round((done / total) * 100);
}

export async function getProject(userId: string, id: string) {
  const [p] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
  if (!p) throw notFound("Project");
  const ts = await db.select().from(tasks).where(and(eq(tasks.projectId, id), eq(tasks.userId, userId))).orderBy(asc(tasks.status), asc(tasks.dueDate), asc(tasks.position));
  const ms = await db.select().from(milestones).where(eq(milestones.projectId, id)).orderBy(asc(milestones.position), asc(milestones.dueDate));
  const done = ts.filter((t) => t.status === "done").length;
  const open = ts.filter((t) => t.status === "todo" || t.status === "in_progress").length;
  return { ...p, tasks: ts, milestones: ms, openTasks: open, doneTasks: done, computedProgress: computeProgress(p.progress, open, done) };
}

export async function createProject(userId: string, input: z.infer<typeof projectCreateSchema>) {
  const [p] = await db.insert(projects).values({ ...input, userId, progress: input.progress ?? 0 }).returning();
  return p;
}
export async function updateProject(userId: string, id: string, input: z.infer<typeof projectUpdateSchema>) {
  await getProject(userId, id);
  const [p] = await db
    .update(projects)
    .set({ ...input, completedAt: input.status === "completed" ? new Date() : input.status ? null : undefined })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .returning();
  return p;
}
export async function deleteProject(userId: string, id: string) {
  await getProject(userId, id);
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
}
export async function addProjectMilestone(userId: string, projectId: string, input: { title: string; dueDate?: string | null; position?: number }) {
  await getProject(userId, projectId);
  const [m] = await db.insert(milestones).values({ ...input, userId, projectId }).returning();
  return m;
}
