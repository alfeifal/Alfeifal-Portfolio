import { z } from "zod";
import { defineTool } from "../registry";
import { SNAPSHOT_SECTIONS, lifeSnapshot } from "@/server/services/snapshot";

defineTool({
  name: "get_snapshot", module: "ai", risk: "read",
  description:
    "Current state of the user's life, by section, computed from their own data. Use it to refresh or widen the snapshot in the system prompt (which is clipped and only looks a couple of weeks ahead), or when you need a cross-module overview before planning or answering 'what should I do'. sections: tasks (today/overdue/upcoming + counts), calendar (today + horizon), goals (progress, metric, behind-pace flag), projects (open tasks, deadlines), training (today's cycle day + this week's workouts), studies (minutes, next exams and assignments), german (minutes, streak, units passed), finance (month income/expenses/net, budgets at risk), nutrition (today's totals), reviews (period and excerpt of the latest daily and weekly review). Omit sections to get all of them. horizon is how many days ahead the forward-looking sections cover (0-31, default 7). For full lists, other periods, history or exact ids, use the module read tools instead.",
  schema: z.object({
    sections: z.array(z.enum(SNAPSHOT_SECTIONS)).min(1).max(SNAPSHOT_SECTIONS.length).optional(),
    horizon: z.number().int().min(0).max(31).default(7),
  }),
  run: (i, ctx) => lifeSnapshot(ctx.user, { sections: i.sections, horizonDays: i.horizon, tz: ctx.user.timezone }),
});
