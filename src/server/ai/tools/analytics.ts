import { z } from "zod";
import { defineTool } from "../registry";
import { analyticsOverview, MAX_CUSTOM_DAYS } from "@/server/services/analytics";

/**
 * Analytics is read-only by nature: it computes from what the other modules stored. There is nothing to
 * write here, so no write tool exists.
 */
defineTool({
  name: "get_analytics", module: "analytics", risk: "read",
  description:
    `Cross-module analytics for a window, computed from stored records only. period: week (7 days), month (30), quarter (90), year (365), or give from/to for a custom range of at most ${MAX_CUSTOM_DAYS} days. Returns finance (income, expenses, net, savings rate, categories, budgets, 12-month history), training (sessions, volume, sets, minutes, adherence to the routine's cycle, per-week rate), studies (minutes, per subject, consistency, exams, assignments), german, trading (real and paper kept apart), nutrition (daily macros, averages, goal compliance, days logged vs days in range, Atwater check), productivity (tasks created and completed, completion rate, per weekday), calendar time by event kind, journal (entries, mood), investing snapshots, goals and projects with milestones — each against the previous period. Rates are null rather than zero when there is nothing to divide by, and every section reports how many days actually had data, so say "not enough data" instead of reading a trend into two points.`,
  schema: z.object({
    period: z.enum(["week", "month", "quarter", "year"]).default("week"),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sections: z.array(z.enum(["finance", "training", "studies", "german", "trading", "nutrition", "productivity", "calendar", "journal", "investing", "goals", "projects"])).min(1).optional().describe("Return only these sections; omit for all of them"),
  }),
  run: async (i, ctx) => {
    const all = await analyticsOverview(ctx.user.id, { period: i.period, from: i.from, to: i.to }, ctx.user.timezone);
    if (!i.sections) return all;
    const { period, range, previousRange, rangeDays, source } = all;
    const picked = Object.fromEntries(i.sections.map((s) => [s, (all as unknown as Record<string, unknown>)[s]]));
    return { period, range, previousRange, rangeDays, source, ...picked };
  },
});
