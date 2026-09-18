import { z } from "zod";
import { defineTool } from "../registry";
import * as t from "@/server/services/tasks";

defineTool({ name: "get_tasks", module: "tasks", risk: "read", description: "List tasks. view: today | upcoming | overdue | completed | inbox (no date) | all. The system-prompt snapshot only carries the first few tasks of today and overdue, so call this for full lists, other views and task ids before concluding anything about what is pending.", schema: z.object({ view: z.enum(["today", "upcoming", "overdue", "completed", "inbox", "all"]).default("today"), projectId: z.string().uuid().optional(), goalId: z.string().uuid().optional(), limit: z.number().int().max(200).optional() }), run: (i, ctx) => t.listTasks(ctx.user.id, { ...i, tz: ctx.user.timezone }) });
defineTool({
  name: "create_task", module: "tasks", risk: "low",
  description: "Create a task/reminder: something to DO, with an optional due date. Not create_event, which books a slot in the calendar at a specific time; not create_exam or create_study_task, which belong to a subject in Studies. recurrence: daily | weekdays | weekly | weekly:MO,WE | monthly | monthly:15 | yearly.",
  schema: t.taskCreateSchema.omit({ source: true }),
  summarize: (i) => `create_task — ${i.title}${i.dueDate ? " — " + i.dueDate : ""}`,
  run: (i, ctx) => t.createTask(ctx.user.id, { ...i, source: "ai" }),
});
defineTool({ name: "update_task", module: "tasks", risk: "low", description: "Update fields of a task by id (title, dueDate, priority, status...).", schema: z.object({ id: z.string().uuid() }).extend(t.taskUpdateSchema.omit({ source: true }).shape), summarize: (i) => `update_task — ${i.id.slice(0, 8)}`, run: ({ id, ...rest }, ctx) => t.updateTask(ctx.user.id, id, rest, ctx.user.timezone) });
defineTool({ name: "complete_task", module: "tasks", risk: "low", description: "Mark a task as done (spawns the next occurrence for recurring tasks).", schema: z.object({ id: z.string().uuid() }), summarize: (i) => `complete_task — ${i.id.slice(0, 8)}`, run: ({ id }, ctx) => t.completeTask(ctx.user.id, id, ctx.user.timezone) });
defineTool({ name: "delete_task", module: "tasks", risk: "medium", description: "Delete a task. Requires confirmation.", schema: z.object({ id: z.string().uuid() }), needsConfirmation: (i) => `Delete task ${i.id.slice(0, 8)}`, summarize: (i) => `delete_task — ${i.id.slice(0, 8)}`, run: async ({ id }, ctx) => { await t.deleteTask(ctx.user.id, id, ctx.user.timezone); return { deleted: id }; } });
