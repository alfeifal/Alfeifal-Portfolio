import { z } from "zod";
import { defineTool } from "../registry";
import * as rev from "@/server/services/reviews";

/**
 * Reviews for the assistant.
 *
 * Reading is free. Generating is a `low`-risk write because it creates nothing the user did not
 * already have: every number comes from Analytics, the row is keyed by period so a second call
 * refreshes rather than duplicates, and the user's own notes are never touched. There is deliberately
 * no tool to write facts, edit a stored review or add an insight by hand — the assistant can ask for a
 * review to be computed, and it can read one, and that is the whole surface.
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

defineTool({
  name: "list_reviews", module: "reviews", risk: "read",
  description: "List the user's stored weekly and monthly reviews, newest period first. Returns each review's id, type, period and whether it already carries AI insights or the user's own notes — not the full metrics.",
  schema: z.object({
    type: rev.reviewTypeSchema.optional().describe("Restrict to weekly or monthly. Omit for both."),
    limit: z.number().int().min(1).max(50).default(12),
  }),
  run: async (i, ctx) => {
    const rows = await rev.listReviews(ctx.user.id, { type: i.type, limit: i.limit });
    return rows.map((r) => ({
      id: r.id, type: r.type, period: rev.periodLabel(r.type, r.periodStart, r.periodEnd),
      periodStart: r.periodStart, periodEnd: r.periodEnd, status: r.status,
      hasAiInsights: Boolean(r.aiInsights), hasUserNotes: Boolean(r.userNotes),
      generatedAt: r.generatedAt,
    }));
  },
});

defineTool({
  name: "get_review", module: "reviews", risk: "read",
  description: "Read one stored review in full: its measured facts, the changes against the previous comparable period, the observations derived from those numbers in code, any AI insights, and the user's own notes. A null metric means it was not measured — never treat it as zero.",
  schema: z.object({ id: z.string().uuid().describe("The review's id, from list_reviews.") }),
  run: async (i, ctx) => {
    const r = await rev.getReview(ctx.user.id, i.id);
    return {
      id: r.id, type: r.type, period: rev.periodLabel(r.type, r.periodStart, r.periodEnd),
      periodStart: r.periodStart, periodEnd: r.periodEnd, status: r.status,
      facts: r.facts, trends: r.trends, observations: r.observations,
      aiInsights: r.aiInsights ?? null, userNotes: r.userNotes ?? null,
      generatedAt: r.generatedAt,
    };
  },
});

defineTool({
  name: "generate_review", module: "reviews", risk: "low",
  description: "Compute and store the weekly or monthly review for the period containing the given date (today by default). Every figure is calculated from the user's own records through Analytics — you cannot supply or adjust a number. Running it again for the same period refreshes that review instead of creating a second one, and leaves the user's notes untouched.",
  schema: z.object({
    type: rev.reviewTypeSchema,
    date: dateSchema.optional().describe("Any day inside the period to review. Defaults to today."),
  }),
  summarize: (i, result) => {
    const r = result as { periodStart?: string; periodEnd?: string } | null;
    return `generate_review — ${i.type}${r?.periodStart ? ` — ${r.periodStart} → ${r.periodEnd}` : ""}`;
  },
  run: async (i, ctx) => {
    const r = await rev.generateReview(ctx.user.id, i.type, i.date, ctx.user.timezone);
    return { id: r.id, type: r.type, periodStart: r.periodStart, periodEnd: r.periodEnd, facts: r.facts, observations: r.observations };
  },
});
