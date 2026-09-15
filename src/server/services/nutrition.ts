import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { foods, meals, nutritionEntries } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/http";
import { dateSchema } from "./tasks";
import { todayKey } from "@/lib/dates";
import { round2 } from "@/lib/money";
import { getPreferences, patchPreferences } from "./users";

/**
 * Nutrition arithmetic (single source of truth).
 *
 * Energy and macros are four separate numbers, so nothing stops them contradicting each other — that is
 * exactly how an estimate like "1000 kcal, 140 g protein, 0 g carbs, 72 g fat" (1208 kcal of macros) used
 * to reach the database and then poison every total downstream. Every write now goes through
 * `normalizeEntry`, and every read reports the check, so a contradiction can neither be stored silently
 * for an estimate nor hidden for exact data.
 *
 * Policy by source:
 *  - estimated / ai  → the system's own guess: energy is recomputed from the macros (Atwater) when it
 *                      falls outside tolerance, and the adjustment is reported to the caller.
 *  - user / import   → declared by the user or taken from a food database: values are kept verbatim
 *                      (real labels do deviate), but the discrepancy is surfaced on read.
 */
export const ATWATER = { protein: 4, carbs: 4, fat: 9 } as const;
export interface Macros { calories: number; protein: number; carbs: number; fat: number }

/** Energy implied by the macros, in kcal. */
export function macroCalories(m: Pick<Macros, "protein" | "carbs" | "fat">) {
  return round2(m.protein * ATWATER.protein + m.carbs * ATWATER.carbs + m.fat * ATWATER.fat);
}
/** Rounding and real food data justify some slack: 25 kcal, or 10% of the macro energy, whichever is larger. */
export function consistencyTolerance(macroKcal: number) {
  return Math.max(25, round2(macroKcal * 0.1));
}
export interface Consistency { macroCalories: number; delta: number; tolerance: number; ok: boolean }
export function consistencyOf(m: Macros): Consistency {
  const mc = macroCalories(m);
  const tolerance = consistencyTolerance(mc);
  const delta = round2(m.calories - mc);
  return { macroCalories: mc, delta, tolerance, ok: Math.abs(delta) <= tolerance };
}

/** What the given numbers refer to, before quantity is applied. */
export const basisSchema = z.enum(["total", "100g", "serving"]);
export type Basis = z.infer<typeof basisSchema>;

/**
 * How much of the reference amount was actually consumed. This is the only place quantities are turned
 * into a multiplier, so 100 g, 400 g, 1 serving and 2 servings all scale through the same arithmetic.
 */
export function scaleFactor(opts: { basis: Basis; quantity: number; unit: string; servingGrams?: number | null }) {
  const { basis, quantity, unit } = opts;
  if (basis === "total") return 1;
  if (basis === "100g") {
    if (unit === "g" || unit === "ml") return quantity / 100;
    if (opts.servingGrams) return (quantity * opts.servingGrams) / 100;
    throw badRequest('Values given per 100 g need a quantity in g/ml, or a food with a known serving weight');
  }
  if (unit === "serving" || unit === "unit") return quantity;
  if ((unit === "g" || unit === "ml") && opts.servingGrams) return quantity / opts.servingGrams;
  throw badRequest('Values given per serving need a quantity in servings, or a food with a known serving weight');
}

export interface NormalizedEntry extends Macros { adjustment?: { field: "calories"; from: number; to: number; reason: string } }
/**
 * Scales the reference values to what was eaten and reconciles energy with macros for estimates.
 * Used by every writer (manual API and the AI tool), so no path can bypass it.
 */
export function normalizeEntry(input: Macros & { quantity: number; unit: string; basis?: Basis; source: string; servingGrams?: number | null }): NormalizedEntry {
  const f = scaleFactor({ basis: input.basis ?? "total", quantity: input.quantity, unit: input.unit, servingGrams: input.servingGrams });
  const scaled: Macros = { calories: round2(input.calories * f), protein: round2(input.protein * f), carbs: round2(input.carbs * f), fat: round2(input.fat * f) };
  const estimate = input.source === "estimated" || input.source === "ai";
  const check = consistencyOf(scaled);
  if (estimate && !check.ok) {
    return { ...scaled, calories: check.macroCalories, adjustment: { field: "calories", from: scaled.calories, to: check.macroCalories, reason: `energy did not match the macros (${scaled.calories} kcal given, ${check.macroCalories} kcal from ${scaled.protein}P/${scaled.carbs}C/${scaled.fat}F); recomputed from the macros` } };
  }
  return scaled;
}

/** The one place entry rows are added up. Reused by the day view so totals cannot drift from the items. */
export function totalsOf(entries: Macros[]): Macros {
  const t = entries.reduce((a, e) => ({ calories: a.calories + e.calories, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  return { calories: round2(t.calories), protein: round2(t.protein), carbs: round2(t.carbs), fat: round2(t.fat) };
}

export const foodSchema = z.object({
  name: z.string().min(1).max(150),
  brand: z.string().max(100).nullish(),
  servingGrams: z.number().positive().nullish(),
  calories: z.number().min(0),
  protein: z.number().min(0).default(0),
  carbs: z.number().min(0).default(0),
  fat: z.number().min(0).default(0),
  source: z.enum(["user", "ai", "import", "estimated"]).default("user"),
});
export const entrySchema = z.object({
  foodId: z.string().uuid().nullish(),
  description: z.string().min(1).max(200),
  quantity: z.number().positive().default(1),
  unit: z.enum(["g", "ml", "serving", "unit"]).default("serving"),
  /** What the numbers below refer to: the whole amount eaten (default), per 100 g, or per serving. */
  basis: basisSchema.default("total"),
  calories: z.number().min(0),
  protein: z.number().min(0).default(0),
  carbs: z.number().min(0).default(0),
  fat: z.number().min(0).default(0),
  /** "user" = exact values typed by the user, "estimated" = AI estimate, "import" = food database. */
  source: z.enum(["user", "estimated", "import", "ai"]).default("user"),
  confidence: z.number().int().min(0).max(100).nullish(),
});
export const mealSchema = z.object({
  date: dateSchema.optional(),
  type: z.enum(["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"]).default("snack"),
  name: z.string().max(150).nullish(),
  notes: z.string().max(2000).nullish(),
  items: z.array(entrySchema).min(1).max(40),
  source: z.enum(["user", "ai", "import"]).default("user"),
});
export const nutritionGoalsSchema = z.object({ calories: z.number().int().min(0).max(10000), protein: z.number().int().min(0).max(1000), carbs: z.number().int().min(0).max(2000), fat: z.number().int().min(0).max(1000) });

export async function listFoods(userId: string, q?: string) {
  const conds = [eq(foods.userId, userId)];
  if (q) conds.push(sql`${foods.name} ilike ${"%" + q + "%"}`);
  return db.select().from(foods).where(and(...conds)).orderBy(asc(foods.name)).limit(100);
}
export async function createFood(userId: string, input: z.infer<typeof foodSchema>) {
  const [f] = await db.insert(foods).values({ ...input, userId }).returning();
  return f;
}
export async function deleteFood(userId: string, id: string) {
  await db.delete(foods).where(and(eq(foods.id, id), eq(foods.userId, userId)));
}

/** Looks up one of the user's saved foods by id or (case-insensitively) by name. */
export async function resolveFood(userId: string, ref: { foodId?: string | null; name?: string | null }) {
  if (ref.foodId) {
    const [f] = await db.select().from(foods).where(and(eq(foods.id, ref.foodId), eq(foods.userId, userId))).limit(1);
    return f ?? null;
  }
  if (ref.name) {
    const [f] = await db.select().from(foods).where(and(eq(foods.userId, userId), sql`lower(${foods.name}) = lower(${ref.name})`)).limit(1);
    return f ?? null;
  }
  return null;
}

export async function logMeal(userId: string, input: z.infer<typeof mealSchema>, tz?: string) {
  // Normalise first: scaling and the energy/macro check happen before anything is written, and the
  // adjustments are returned so the caller (and the assistant) can report exactly what was stored.
  const adjustments: { description: string; from: number; to: number; reason: string }[] = [];
  const prepared: (Omit<z.infer<typeof entrySchema>, "basis"> & { userId: string })[] = [];
  for (const i of input.items) {
    const food = i.foodId ? await resolveFood(userId, { foodId: i.foodId }) : null;
    if (i.foodId && !food) throw notFound("Food");
    const n = normalizeEntry({ ...i, servingGrams: food?.servingGrams ?? null });
    if (n.adjustment) adjustments.push({ description: i.description, from: n.adjustment.from, to: n.adjustment.to, reason: n.adjustment.reason });
    const { basis: _basis, ...rest } = i;
    prepared.push({ ...rest, calories: n.calories, protein: n.protein, carbs: n.carbs, fat: n.fat, userId });
  }
  return db.transaction(async (tx) => {
    const [m] = await tx.insert(meals).values({ userId, date: input.date ?? todayKey(tz), type: input.type, name: input.name, notes: input.notes, source: input.source }).returning();
    const items = await tx.insert(nutritionEntries).values(prepared.map((i) => ({ ...i, mealId: m.id }))).returning();
    return { ...m, items, adjustments };
  });
}
export async function deleteMeal(userId: string, id: string) {
  const r = await db.delete(meals).where(and(eq(meals.id, id), eq(meals.userId, userId))).returning({ id: meals.id });
  if (!r.length) throw notFound("Meal");
}
export async function deleteEntry(userId: string, id: string) {
  await db.delete(nutritionEntries).where(and(eq(nutritionEntries.id, id), eq(nutritionEntries.userId, userId)));
}

/**
 * Updates the daily targets. They live in the user's preferences (the existing source of truth — no
 * second table), and the same energy/macro rule the entries obey is applied here: a target set that
 * contradicts itself would make every "x% of your goal" reading meaningless. Returns the previous and
 * the new values so the caller can show exactly what changed.
 */
export async function updateNutritionGoals(userId: string, input: z.infer<typeof nutritionGoalsSchema>) {
  const check = consistencyOf(input);
  if (!check.ok) {
    throw badRequest(`These targets are not consistent: ${input.protein}g protein, ${input.carbs}g carbs and ${input.fat}g fat add up to ${check.macroCalories} kcal, not ${input.calories} kcal (off by ${check.delta}). Adjust the calories or the macros.`);
  }
  const previous = await nutritionGoals(userId);
  await patchPreferences(userId, { nutritionGoals: input });
  return { previous, goals: await nutritionGoals(userId) };
}

export async function nutritionGoals(userId: string) {
  const p = await getPreferences(userId);
  const g = (p.nutritionGoals as z.infer<typeof nutritionGoalsSchema> | undefined) ?? { calories: 2600, protein: 160, carbs: 300, fat: 80 };
  return g;
}

export async function dailyNutrition(userId: string, date: string) {
  const ms = await db.select().from(meals).where(and(eq(meals.userId, userId), eq(meals.date, date))).orderBy(asc(meals.loggedAt));
  const ids = ms.map((m) => m.id);
  const items = ids.length ? await db.select().from(nutritionEntries).where(sql`${nutritionEntries.mealId} in ${ids}`) : [];
  const withCheck = items.map((i) => ({ ...i, consistency: consistencyOf(i) }));
  const estimated = withCheck.filter((i) => i.source === "estimated" || i.source === "ai").length;
  const totals = totalsOf(withCheck);
  const goals = await nutritionGoals(userId);
  return {
    date,
    meals: ms.map((m) => ({ ...m, items: withCheck.filter((i) => i.mealId === m.id), totals: totalsOf(withCheck.filter((i) => i.mealId === m.id)) })),
    totals,
    /** Energy implied by the day's macros, and whether the stored calories agree with it. */
    consistency: { ...consistencyOf(totals), entriesOff: withCheck.filter((i) => !i.consistency.ok).length },
    goals,
    estimatedItems: estimated,
    exactItems: items.length - estimated,
    source: "calculated" as const,
  };
}

export async function nutritionSummary(userId: string, range: { from: string; to: string }) {
  const rows = await db
    .select({ date: meals.date, calories: sql<number>`sum(${nutritionEntries.calories})`, protein: sql<number>`sum(${nutritionEntries.protein})`, carbs: sql<number>`sum(${nutritionEntries.carbs})`, fat: sql<number>`sum(${nutritionEntries.fat})`, estimated: sql<number>`count(*) filter (where ${nutritionEntries.source} in ('estimated','ai'))`, items: sql<number>`count(*)` })
    .from(nutritionEntries)
    .innerJoin(meals, eq(meals.id, nutritionEntries.mealId))
    .where(and(eq(meals.userId, userId), gte(meals.date, range.from), lte(meals.date, range.to)))
    .groupBy(meals.date)
    .orderBy(asc(meals.date));
  const daily = rows.map((r) => {
    const m = { calories: round2(Number(r.calories)), protein: round2(Number(r.protein)), carbs: round2(Number(r.carbs)), fat: round2(Number(r.fat)) };
    // Same check as the day view, so a range never tells a different story than a single day.
    return { date: r.date, ...m, consistency: consistencyOf(m), estimatedItems: Number(r.estimated), items: Number(r.items) };
  });
  const days = daily.length || 1;
  const avg = { calories: round2(daily.reduce((a, b) => a + b.calories, 0) / days), protein: round2(daily.reduce((a, b) => a + b.protein, 0) / days), carbs: round2(daily.reduce((a, b) => a + b.carbs, 0) / days), fat: round2(daily.reduce((a, b) => a + b.fat, 0) / days) };
  return { range, daily, average: avg, daysLogged: daily.length, goals: await nutritionGoals(userId), source: "calculated" as const };
}
export { desc as _desc };
