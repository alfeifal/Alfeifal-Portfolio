import { z } from "zod";
import { defineTool } from "../registry";
import * as p from "@/server/services/projects";
import { createTask, dateSchema } from "@/server/services/tasks";

defineTool({ name: "get_projects", module: "projects", risk: "read", description: "List projects (default active) with task counts, or one project with its tasks and milestones when id is given.", schema: z.object({ status: z.string().optional(), id: z.string().uuid().optional() }), run: (i, ctx) => (i.id ? p.getProject(ctx.user.id, i.id) : p.listProjects(ctx.user.id, i.status ?? undefined)) });
defineTool({ name: "create_project", module: "projects", risk: "low", description: "Create a project: a body of work with its own tasks and milestones. Use create_goal instead for an outcome the user wants to reach; link the two with goalId when the project serves a goal.", schema: p.projectCreateSchema.omit({ source: true }), summarize: (i) => `create_project — ${i.name}`, run: (i, ctx) => p.createProject(ctx.user.id, { ...i, source: "ai" }, "ai") });
defineTool({ name: "update_project", module: "projects", risk: "medium", description: "Update a project (status, priority, deadline, notes, progress).", schema: z.object({ id: z.string().uuid() }).extend(p.projectUpdateSchema.omit({ source: true }).shape), summarize: (i) => `update_project — ${i.id.slice(0, 8)}`, run: ({ id, ...rest }, ctx) => p.updateProject(ctx.user.id, id, rest, "ai") });
defineTool({ name: "create_project_task", module: "projects", risk: "low", description: "Create a task inside a project.", schema: z.object({ projectId: z.string().uuid(), title: z.string(), dueDate: dateSchema.optional(), priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"), description: z.string().optional(), estimatedMinutes: z.number().int().optional() }), summarize: (i) => `create_project_task — ${i.title}`, run: (i, ctx) => createTask(ctx.user.id, { ...i, category: "project", status: "todo", source: "ai" }) });

defineTool({
  name: "delete_project", module: "projects", risk: "high",
  description:
    "Permanently delete a project. Destructive and irreversible: always confirmed by the user. Its tasks are not deleted, they stop belonging to a project. Prefer update_project with status 'archived' or 'completed' when the user only wants it out of the way.",
  schema: z.object({ id: z.string().uuid(), name: z.string().min(1).max(200).describe("The project's exact name, so the confirmation says what is being deleted and the wrong record cannot be hit") }),
  summarize: (i) => `delete_project — "${i.name}"`,
  needsConfirmation: (i) => `Permanently delete the project "${i.name}"`,
  run: async (i, ctx) => {
    const project = await p.getProject(ctx.user.id, i.id);
    if (project.name.trim().toLowerCase() !== i.name.trim().toLowerCase()) throw new Error(`That id belongs to "${project.name}", not "${i.name}". Nothing was deleted — check the id with get_projects.`);
    await p.deleteProject(ctx.user.id, i.id, "ai");
    return { deleted: i.id, name: project.name, openTasks: project.openTasks };
  },
});

defineTool({
  name: "add_project_milestone", module: "projects", risk: "low",
  description: "Add a milestone to a project (the project equivalent of add_milestone for goals). Tick it with complete_milestone.",
  schema: z.object({ projectId: z.string().uuid(), title: z.string().min(1).max(200), dueDate: dateSchema.optional(), position: z.number().int().min(0).default(0) }),
  summarize: (i) => `add_project_milestone — ${i.title}`,
  run: ({ projectId, ...rest }, ctx) => p.addProjectMilestone(ctx.user.id, projectId, rest, "ai"),
});
