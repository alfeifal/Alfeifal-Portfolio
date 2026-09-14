import { z } from "zod";
import { defineTool } from "../registry";
import * as n from "@/server/services/nutrition";
import { dateSchema } from "@/server/services/tasks";
import { todayKey, addDaysKey } from "@/lib/dates";

defineTool({
  name: "log_meal", module: "nutrition", risk: "low",
  description: "Log a meal with its items. For each item give calories/protein/carbs/fat as consumed. Use source='estimated' with a confidence (0-100) when you estimated the values yourself, 'user' only when the user gave exact numbers.",
  schema: z.object({ date: dateSchema.optional(), type: z.enum(["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"]).default("snack"), name: z.string().optional(), notes: z.string().optional(), items: z.array(z.object({ description: z.string(), quantity: z.number().positive().default(1), unit: z.enum(["g", "ml", "serving", "unit"]).default("serving"), calories: z.number().min(0), protein: z.number().min(0).default(0), carbs: z.number().min(0).default(0), fat: z.number().min(0).default(0), source: z.enum(["user", "estimated"]).default("estimated"), confidence: z.number().int().min(0).max(100).optional() })).min(1) }),
  summarize: (i) => `log_meal — ${i.type} — ${i.items.length} items — ${Math.round(i.items.reduce((a, b) => a + b.calories, 0))} kcal`,
  run: (i, ctx) => n.logMeal(ctx.user.id, { ...i, source: "ai" }, ctx.user.timezone),
});
defineTool({ name: "get_daily_nutrition", module: "nutrition", risk: "read", description: "Meals and totals vs goals for a date (default today), with counts of exact vs estimated items.", schema: z.object({ date: dateSchema.optional() }), run: (i, ctx) => n.dailyNutrition(ctx.user.id, i.date ?? todayKey(ctx.user.timezone)) });
defineTool({ name: "get_nutrition_summary", module: "nutrition", risk: "read", description: "Daily totals and averages for a range (default last 7 days).", schema: z.object({ from: dateSchema.optional(), to: dateSchema.optional() }), run: (i, ctx) => { const to = i.to ?? todayKey(ctx.user.timezone); return n.nutritionSummary(ctx.user.id, { from: i.from ?? addDaysKey(to, -6), to }); } });
defineTool({ name: "delete_meal", module: "nutrition", risk: "medium", description: "Delete a logged meal. Requires confirmation.", schema: z.object({ id: z.string().uuid() }), needsConfirmation: () => "Delete meal", summarize: (i) => `delete_meal — ${i.id.slice(0, 8)}`, run: async (i, ctx) => { await n.deleteMeal(ctx.user.id, i.id); return { deleted: i.id }; } });
