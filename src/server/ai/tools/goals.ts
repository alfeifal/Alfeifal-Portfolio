import { z } from "zod";
import { defineTool } from "../registry";
import * as g from "@/server/services/goals";

const LINKED = "Linked goals: set metricSource + metricKind + metricPeriod and the goal tracks real data automatically (no manual updates). Allowed: tasks/completed_tasks (week|month|total, metricRef = project id, otherwise the tasks linked to this goal), training/completed_workouts or training/volume_kg (week|month|total), study/minutes (week|month|total, metricRef = subject id or slug), german/minutes (week|month|total) or german/units_passed (total), finance/net_savings or finance/income (week|month|total). A linked goal needs a positive metricTarget and its progress can never be set by hand.";

defineTool({ name: "get_goals", module: "goals", risk: "read", description: "List goals (default active) with progress and deadlines.", schema: z.object({ status: z.enum(["active", "paused", "completed", "abandoned"]).optional(), id: z.string().uuid().optional() }), run: (i, ctx) => (i.id ? g.getGoal(ctx.user.id, i.id, ctx.user.timezone) : g.listGoals(ctx.user.id, i.status ?? "active", ctx.user.timezone)) });
defineTool({ name: "create_goal", module: "goals", risk: "low", description: `Create a goal; optional metric (name/unit/target) makes progress computable. ${LINKED}`, schema: g.goalCreateSchema.omit({ source: true }), summarize: (i) => `create_goal — ${i.name}`, run: (i, ctx) => g.createGoal(ctx.user.id, { ...i, source: "ai" }, ctx.user.timezone, "ai") });
defineTool({ name: "update_goal", module: "goals", risk: "medium", description: `Update a goal (name, deadline, status, metric...). Confirmation required when changing status to abandoned. ${LINKED}`, schema: z.object({ id: z.string().uuid() }).extend(g.goalUpdateSchema.omit({ source: true }).shape), needsConfirmation: (i) => (i.status === "abandoned" ? "Abandon goal" : false), summarize: (i) => `update_goal — ${i.id.slice(0, 8)}`, run: ({ id, ...rest }, ctx) => g.updateGoal(ctx.user.id, id, rest, ctx.user.timezone, "ai") });
defineTool({ name: "update_goal_progress", module: "goals", risk: "low", description: "Set progress (0-100) or metricCurrent, or add a delta to the metric. Only for manual goals: a linked goal (metricSource set) is computed from its module and rejects this call — log the activity instead.", schema: z.object({ id: z.string().uuid(), progress: z.number().int().min(0).max(100).optional(), metricCurrent: z.number().optional(), delta: z.number().optional() }), summarize: (i) => `update_goal_progress — ${i.id.slice(0, 8)}`, run: ({ id, ...rest }, ctx) => g.updateGoalProgress(ctx.user.id, id, rest, ctx.user.timezone) });
defineTool({ name: "add_milestone", module: "goals", risk: "low", description: "Add a milestone to a goal.", schema: z.object({ goalId: z.string().uuid(), title: z.string(), dueDate: z.string().optional() }), summarize: (i) => `add_milestone — ${i.title}`, run: (i, ctx) => g.addMilestone(ctx.user.id, i.goalId, { title: i.title, dueDate: i.dueDate, position: 0 }, "ai") });

defineTool({
  name: "complete_milestone", module: "goals", risk: "low",
  description: "Tick a goal milestone as reached (or untick it with done=false). Get milestone ids from get_goals with the goal's id.",
  schema: z.object({ id: z.string().uuid(), done: z.boolean().default(true) }),
  summarize: (i) => `complete_milestone — ${i.id.slice(0, 8)}${i.done ? "" : " (reopened)"}`,
  run: (i, ctx) => g.toggleMilestone(ctx.user.id, i.id, i.done, "ai"),
});
defineTool({
  name: "delete_goal", module: "goals", risk: "high",
  description:
    "Permanently delete a goal and its milestones. Destructive and irreversible: always confirmed by the user, who is shown the goal's name. Prefer update_goal with status 'abandoned' or 'completed' when the user just wants to stop tracking it.",
  schema: z.object({ id: z.string().uuid(), name: z.string().min(1).max(200).describe("The goal's exact name, so the confirmation says what is being deleted and the wrong record cannot be hit") }),
  summarize: (i) => `delete_goal — "${i.name}"`,
  needsConfirmation: (i) => `Permanently delete the goal "${i.name}" and its milestones`,
  run: async (i, ctx) => {
    const goal = await g.getGoal(ctx.user.id, i.id);
    if (goal.name.trim().toLowerCase() !== i.name.trim().toLowerCase()) throw new Error(`That id belongs to "${goal.name}", not "${i.name}". Nothing was deleted — check the id with get_goals.`);
    await g.deleteGoal(ctx.user.id, i.id, "ai");
    return { deleted: i.id, name: goal.name, milestones: goal.milestones.length };
  },
});

defineTool({
  name: "delete_milestone", module: "goals", risk: "medium",
  description: "Delete a goal milestone. Requires confirmation. Use complete_milestone with done=false to simply untick it.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete milestone ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_milestone — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => g.deleteMilestone(ctx.user.id, i.id, "ai"),
});

defineTool({
  name: "update_milestone", module: "goals", risk: "low",
  description: "Edit a milestone that already exists: its title, its due date, its order, or whether it is done. Works for milestones of a goal and of a project alike. Get ids from get_goals or get_projects with the parent's id.",
  schema: z.object({ id: z.string().uuid() }).extend(g.milestoneUpdateSchema.shape),
  summarize: (i) => `update_milestone — ${i.title ?? i.id.slice(0, 8)}`,
  run: ({ id, ...rest }, ctx) => g.updateMilestone(ctx.user.id, id, rest, "ai"),
});
