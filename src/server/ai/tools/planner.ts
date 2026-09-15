import { z } from "zod";
import { defineTool } from "../registry";
import * as planner from "@/server/services/planner";

/**
 * Planner tools. `propose_plan` writes a draft and nothing else: it cannot create tasks or events, and
 * there is deliberately no tool to accept or apply a plan — that is the user's explicit action in the UI.
 */
defineTool({
  name: "propose_plan", module: "planner", risk: "low",
  description:
    "Save a proposed plan as a DRAFT for the user to review. This creates NOTHING real: no tasks, no calendar events, no goal progress. Each item is a proposal that the user accepts or rejects afterwards in the Planner. Use it after gathering the real data (get_snapshot, get_calendar with free slots, get_tasks, get_goals, get_projects, get_today_workout, get_study_schedule). horizon 'day' uses periodKey YYYY-MM-DD, 'week' uses YYYY-Www (both default to the current one). Item kinds: 'event' (needs startAt, or an all-day date) becomes a calendar event when accepted, 'task' (optional date as its due date) becomes a task, 'note' is advice with no record behind it. Link items to a project or goal with projectId / goalId when they clearly belong to one. Never claim the plan was applied: tell the user it is waiting for their acceptance.",
  schema: z.object({
    horizon: planner.planHorizonSchema.default("day"),
    periodKey: z.string().max(20).optional(),
    title: z.string().max(200).optional(),
    content: z.string().max(20000).default(""),
    items: z.array(planner.planItemInputSchema).min(1).max(60),
  }),
  summarize: (i, r) => `propose_plan — ${i.horizon} — ${i.items.length} items (draft ${(r as { id?: string } | null)?.id?.slice(0, 8) ?? "?"})`,
  run: async (i, ctx) => {
    const plan = await planner.createDraft(ctx.user, planner.planDraftSchema.parse({ ...i, source: "ai" }), { conversationId: ctx.conversationId });
    return {
      id: plan.id, status: plan.status, horizon: plan.horizon, periodKey: plan.periodKey,
      items: plan.items.map((it) => ({ id: it.id, kind: it.kind, title: it.title, date: it.date, startAt: it.startAt, status: it.status })),
      note: "Saved as a draft. Nothing was created yet — the user must accept the plan in the Planner for the tasks and events to exist.",
    };
  },
});

defineTool({
  name: "get_plan", module: "planner", risk: "read",
  description:
    "Read a plan you proposed: by id, or the one in force for a period (horizon 'day' | 'week', periodKey defaults to today / this ISO week). Returns its status (draft, accepted, partially_accepted, rejected, superseded) and every item with its own status and whether it already became a real task or event. Use it to answer 'what did we plan', to follow up on a plan, or before proposing a new one.",
  schema: z.object({ planId: z.string().uuid().optional(), horizon: planner.planHorizonSchema.default("day"), periodKey: z.string().max(20).optional() }),
  run: (i, ctx) => (i.planId ? planner.getPlan(ctx.user.id, i.planId) : planner.currentPlan(ctx.user.id, { horizon: i.horizon, periodKey: i.periodKey, tz: ctx.user.timezone })),
});
