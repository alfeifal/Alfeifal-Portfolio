import { z } from "zod";
import { crud, query } from "@/server/crud";
import * as t from "@/server/services/tasks";
export const tasks = crud({
  name: "tasks", createSchema: t.taskCreateSchema, updateSchema: t.taskUpdateSchema,
  list: (u, req) => { const q = query(req); return t.listTasks(u.id, { view: q.view as "today", projectId: q.projectId, goalId: q.goalId, status: q.status, limit: q.limit ? Number(q.limit) : undefined, tz: u.timezone }); },
  get: (u, id) => t.getTask(u.id, id), create: (u, i) => t.createTask(u.id, i), update: (u, id, i) => t.updateTask(u.id, id, i, u.timezone), remove: (u, id) => t.deleteTask(u.id, id, u.timezone),
});
export const idSchema = z.object({ id: z.string().uuid() });
