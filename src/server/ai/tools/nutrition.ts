import { z } from "zod";
import { defineTool } from "../registry";
import * as n from "@/server/services/nutrition";
import { dateSchema } from "@/server/services/tasks";
import { todayKey, addDaysKey } from "@/lib/dates";

defineTool({
  name: "log_meal", module: "nutrition", risk: "low",
  description:
    "Log a meal with its items. For each item give calories/protein/carbs/fat and say what they refer to with `basis`: 'total' (the whole amount eaten, the default), '100g' (values per 100 g — the server multiplies by the quantity, so give quantity in g) or 'serving' (values for one serving). Prefer '100g' with an explicit quantity when you know per-100 g figures: the server does the arithmetic, you do not. Set `food` to the name of one of the user's saved foods to use its stored values instead of estimating (that is labelled as database data). Use source='estimated' with a confidence (0-100) when you estimated the values, 'user' only when the user gave exact numbers. The server checks that the energy matches the macros (protein×4 + carbs×4 + fat×9) and, for estimates, recomputes the calories from the macros when they disagree; the result lists any adjustment, and you must report it to the user instead of repeating your original number.",
  schema: z.object({
    date: dateSchema.optional(),
    type: z.enum(["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"]).default("snack"),
    name: z.string().optional(),
    notes: z.string().optional(),
    items: z.array(z.object({
      description: z.string(),
      food: z.string().max(150).optional(),
      quantity: z.number().positive().default(1),
      unit: z.enum(["g", "ml", "serving", "unit"]).default("serving"),
      basis: n.basisSchema.default("total"),
      calories: z.number().min(0).optional(),
      protein: z.number().min(0).default(0),
      carbs: z.number().min(0).default(0),
      fat: z.number().min(0).default(0),
      source: z.enum(["user", "estimated"]).default("estimated"),
      confidence: z.number().int().min(0).max(100).optional(),
    })).min(1),
  }),
  summarize: (i, r) => {
    const kcal = (r as { items?: { calories: number }[] } | null)?.items?.reduce((a, b) => a + b.calories, 0);
    return `log_meal — ${i.type} — ${i.items.length} items${kcal != null ? ` — ${Math.round(kcal)} kcal` : ""}`;
  },
  run: async (i, ctx) => {
    const items = [];
    for (const it of i.items) {
      const food = it.food ? await n.resolveFood(ctx.user.id, { name: it.food }) : null;
      if (food) {
        // Stored food: its own values win over the model's guess, and they are per serving.
        items.push({ description: it.description, foodId: food.id, quantity: it.quantity, unit: it.unit, basis: "serving" as const, calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat, source: "import" as const, confidence: null });
      } else {
        if (it.calories == null) throw new Error(`No calories given for "${it.description}" and no saved food matched "${it.food ?? it.description}"`);
        items.push({ description: it.description, foodId: null, quantity: it.quantity, unit: it.unit, basis: it.basis, calories: it.calories, protein: it.protein, carbs: it.carbs, fat: it.fat, source: it.source, confidence: it.confidence ?? null });
      }
    }
    const meal = await n.logMeal(ctx.user.id, n.mealSchema.parse({ date: i.date, type: i.type, name: i.name, notes: i.notes, items, source: "ai" }), ctx.user.timezone);
    return {
      ...meal,
      note: meal.adjustments.length
        ? "Some calories were recomputed from the macros because they did not add up. Tell the user the stored values, not your original ones."
        : "Stored as given; energy and macros agree.",
    };
  },
});
defineTool({ name: "get_daily_nutrition", module: "nutrition", risk: "read", description: "Meals and totals vs goals for a date (default today), with counts of exact vs estimated items.", schema: z.object({ date: dateSchema.optional() }), run: (i, ctx) => n.dailyNutrition(ctx.user.id, i.date ?? todayKey(ctx.user.timezone)) });
defineTool({ name: "get_nutrition_summary", module: "nutrition", risk: "read", description: "Daily totals and averages for a range (default last 7 days).", schema: z.object({ from: dateSchema.optional(), to: dateSchema.optional() }), run: (i, ctx) => { const to = i.to ?? todayKey(ctx.user.timezone); return n.nutritionSummary(ctx.user.id, { from: i.from ?? addDaysKey(to, -6), to }); } });
defineTool({ name: "delete_meal", module: "nutrition", risk: "medium", description: "Delete a logged meal. Requires confirmation.", schema: z.object({ id: z.string().uuid() }), needsConfirmation: () => "Delete meal", summarize: (i) => `delete_meal — ${i.id.slice(0, 8)}`, run: async (i, ctx) => { await n.deleteMeal(ctx.user.id, i.id); return { deleted: i.id }; } });
