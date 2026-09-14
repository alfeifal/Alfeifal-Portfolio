import { z } from "zod";
import { defineTool } from "../registry";
import * as p from "@/server/services/projects";
import { createTask, dateSchema } from "@/server/services/tasks";

defineTool({ name: "get_projects", module: "projects", risk: "read", description: "List projects (default active) with task counts, or one project with its tasks and milestones when id is given.", schema: z.object({ status: z.string().optional(), id: z.string().uuid().optional() }), run: (i, ctx) => (i.id ? p.getProject(ctx.user.id, i.id) : p.listProjects(ctx.user.id, i.status ?? undefined)) });
defineTool({ name: "create_project", module: "projects", risk: "low", description: "Create a project.", schema: p.projectCreateSchema.omit({ source: true }), summarize: (i) => `create_project — ${i.name}`, run: (i, ctx) => p.createProject(ctx.user.id, { ...i, source: "ai" }) });
defineTool({ name: "update_project", module: "projects", risk: "medium", description: "Update a project (status, priority, deadline, notes, progress).", schema: z.object({ id: z.string().uuid() }).extend(p.projectUpdateSchema.omit({ source: true }).shape), summarize: (i) => `update_project — ${i.id.slice(0, 8)}`, run: ({ id, ...rest }, ctx) => p.updateProject(ctx.user.id, id, rest) });
defineTool({ name: "create_project_task", module: "projects", risk: "low", description: "Create a task inside a project.", schema: z.object({ projectId: z.string().uuid(), title: z.string(), dueDate: dateSchema.optional(), priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"), description: z.string().optional(), estimatedMinutes: z.number().int().optional() }), summarize: (i) => `create_project_task — ${i.title}`, run: (i, ctx) => createTask(ctx.user.id, { ...i, category: "project", status: "todo", source: "ai" }) });
