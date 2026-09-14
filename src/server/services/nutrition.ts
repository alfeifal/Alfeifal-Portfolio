import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { foods, meals, nutritionEntries } from "@/server/db/schema";
import { notFound } from "@/server/http";
import { dateSchema } from "./tasks";
import { todayKey } from "@/lib/dates";
import { round2 } from "@/lib/money";
import { getPreferences } from "./users";

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

export async function logMeal(userId: string, input: z.infer<typeof mealSchema>, tz?: string) {
  return db.transaction(async (tx) => {
    const [m] = await tx.insert(meals).values({ userId, date: input.date ?? todayKey(tz), type: input.type, name: input.name, notes: input.notes, source: input.source }).returning();
    const items = await tx.insert(nutritionEntries).values(input.items.map((i) => ({ ...i, userId, mealId: m.id }))).returning();
    return { ...m, items };
  });
}
export async function deleteMeal(userId: string, id: string) {
  const r = await db.delete(meals).where(and(eq(meals.id, id), eq(meals.userId, userId))).returning({ id: meals.id });
  if (!r.length) throw notFound("Meal");
}
export async function deleteEntry(userId: string, id: string) {
  await db.delete(nutritionEntries).where(and(eq(nutritionEntries.id, id), eq(nutritionEntries.userId, userId)));
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
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  let estimated = 0;
  for (const i of items) { totals.calories += i.calories; totals.protein += i.protein; totals.carbs += i.carbs; totals.fat += i.fat; if (i.source === "estimated" || i.source === "ai") estimated++; }
  const goals = await nutritionGoals(userId);
  return {
    date,
    meals: ms.map((m) => ({ ...m, items: items.filter((i) => i.mealId === m.id) })),
    totals: { calories: round2(totals.calories), protein: round2(totals.protein), carbs: round2(totals.carbs), fat: round2(totals.fat) },
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
  const daily = rows.map((r) => ({ date: r.date, calories: round2(Number(r.calories)), protein: round2(Number(r.protein)), carbs: round2(Number(r.carbs)), fat: round2(Number(r.fat)), estimatedItems: Number(r.estimated), items: Number(r.items) }));
  const days = daily.length || 1;
  const avg = { calories: round2(daily.reduce((a, b) => a + b.calories, 0) / days), protein: round2(daily.reduce((a, b) => a + b.protein, 0) / days), carbs: round2(daily.reduce((a, b) => a + b.carbs, 0) / days), fat: round2(daily.reduce((a, b) => a + b.fat, 0) / days) };
  return { range, daily, average: avg, daysLogged: daily.length, goals: await nutritionGoals(userId), source: "calculated" as const };
}
export { desc as _desc };
