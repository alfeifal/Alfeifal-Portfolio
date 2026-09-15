/**
 * Nutrition audit (energy vs macros, scaling, aggregation).
 *
 * The bug this suite exists for: calories and the three macros are four independent numbers, so an
 * estimate could be stored that contradicted itself (1000 kcal against 140 g protein + 72 g fat, which
 * is 1208 kcal), and every total downstream then added up contradictions faithfully. These tests pin the
 * general rules — not one food — end to end: scaling, the energy check per source, meal and day
 * aggregation, and the AI tool.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { nutritionEntries } from "@/server/db/schema";
import * as n from "@/server/services/nutrition";
import { getTool } from "@/server/ai/registry";
import { runTool } from "@/server/ai/agent";
import { todayKey, addDaysKey } from "@/lib/dates";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

describe("nutrition arithmetic (pure)", () => {
  it("energy implied by macros uses Atwater factors", () => {
    expect(n.macroCalories({ protein: 140, carbs: 0, fat: 72 })).toBe(1208);
    expect(n.macroCalories({ protein: 0, carbs: 0, fat: 0 })).toBe(0);
    expect(n.macroCalories({ protein: 10.5, carbs: 20.25, fat: 3.5 })).toBe(154.5);
  });

  it("the consistency check tolerates rounding but not a real contradiction", () => {
    expect(n.consistencyOf({ calories: 1208, protein: 140, carbs: 0, fat: 72 }).ok).toBe(true);
    expect(n.consistencyOf({ calories: 1190, protein: 140, carbs: 0, fat: 72 }).ok).toBe(true); // within 10%
    const bad = n.consistencyOf({ calories: 1000, protein: 140, carbs: 0, fat: 72 });
    expect(bad.ok).toBe(false);
    expect(bad.macroCalories).toBe(1208);
    expect(bad.delta).toBe(-208);
    // Small foods get an absolute floor instead of a useless 10% of a small number.
    expect(n.consistencyOf({ calories: 20, protein: 0, carbs: 0, fat: 0 }).ok).toBe(true);
    expect(n.consistencyOf({ calories: 200, protein: 0, carbs: 0, fat: 0 }).ok).toBe(false);
  });

  it("scaling is the same arithmetic for grams and for servings", () => {
    expect(n.scaleFactor({ basis: "total", quantity: 400, unit: "g" })).toBe(1);
    expect(n.scaleFactor({ basis: "100g", quantity: 100, unit: "g" })).toBe(1);
    expect(n.scaleFactor({ basis: "100g", quantity: 200, unit: "g" })).toBe(2);
    expect(n.scaleFactor({ basis: "100g", quantity: 400, unit: "g" })).toBe(4);
    expect(n.scaleFactor({ basis: "100g", quantity: 250, unit: "ml" })).toBe(2.5);
    expect(n.scaleFactor({ basis: "serving", quantity: 1, unit: "serving" })).toBe(1);
    expect(n.scaleFactor({ basis: "serving", quantity: 2, unit: "serving" })).toBe(2);
    expect(n.scaleFactor({ basis: "serving", quantity: 1.5, unit: "unit" })).toBe(1.5);
    // Grams against a food whose serving weight is known, and the reverse.
    expect(n.scaleFactor({ basis: "serving", quantity: 300, unit: "g", servingGrams: 150 })).toBe(2);
    expect(n.scaleFactor({ basis: "100g", quantity: 2, unit: "serving", servingGrams: 150 })).toBe(3);
    // Impossible conversions are refused instead of guessed.
    expect(() => n.scaleFactor({ basis: "100g", quantity: 1, unit: "serving" })).toThrow();
    expect(() => n.scaleFactor({ basis: "serving", quantity: 200, unit: "g" })).toThrow();
  });

  it("normalising scales first and only then reconciles, and only for estimates", () => {
    // Per-100 g values for a steak, eaten as 400 g: the server multiplies, the model does not.
    const per100 = { calories: 250, protein: 26, carbs: 0, fat: 16 };
    const scaled = n.normalizeEntry({ ...per100, quantity: 400, unit: "g", basis: "100g", source: "estimated" });
    expect(scaled).toMatchObject({ calories: 1000, protein: 104, carbs: 0, fat: 64 });
    expect(scaled.adjustment).toBeUndefined(); // 104×4 + 64×9 = 992, within tolerance of 1000

    // The reported bug: an estimate whose energy contradicts its own macros is recomputed.
    const contradictory = n.normalizeEntry({ calories: 1000, protein: 140, carbs: 0, fat: 72, quantity: 400, unit: "g", basis: "total", source: "estimated" });
    expect(contradictory.calories).toBe(1208);
    expect(contradictory.adjustment).toMatchObject({ field: "calories", from: 1000, to: 1208 });

    // Exact and database values are never rewritten: real labels do deviate.
    const declared = n.normalizeEntry({ calories: 1000, protein: 140, carbs: 0, fat: 72, quantity: 1, unit: "serving", basis: "total", source: "user" });
    expect(declared.calories).toBe(1000);
    expect(declared.adjustment).toBeUndefined();
    const database = n.normalizeEntry({ calories: 1000, protein: 140, carbs: 0, fat: 72, quantity: 1, unit: "serving", basis: "total", source: "import" });
    expect(database.calories).toBe(1000);

    // Zero-carb and decimal quantities survive the round trip.
    const zeroCarb = n.normalizeEntry({ calories: 0, protein: 0, carbs: 0, fat: 0, quantity: 1, unit: "serving", basis: "total", source: "estimated" });
    expect(zeroCarb).toMatchObject({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    const half = n.normalizeEntry({ calories: 100, protein: 5, carbs: 10, fat: 4, quantity: 1.5, unit: "serving", basis: "serving", source: "estimated" });
    expect(half).toMatchObject({ calories: 150, protein: 7.5, carbs: 15, fat: 6 });
  });

  it("totals add the entries once, with a single rounding at the end", () => {
    const t = n.totalsOf([
      { calories: 100.004, protein: 10.001, carbs: 5.002, fat: 2.003 },
      { calories: 200.004, protein: 20.001, carbs: 5.002, fat: 3.003 },
    ]);
    expect(t).toEqual({ calories: 300.01, protein: 30, carbs: 10, fat: 5.01 });
    expect(n.totalsOf([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

d("nutrition pipeline (real database)", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  const today = () => todayKey(TZ);
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("what is stored is what was normalised: scaling and reconciliation happen before the insert", async () => {
    const meal = await n.logMeal(user.id, n.mealSchema.parse({
      date: today(), type: "lunch",
      items: [
        { description: "Steak", quantity: 400, unit: "g", basis: "100g", calories: 250, protein: 26, carbs: 0, fat: 16, source: "estimated", confidence: 60 },
        { description: "Contradictory estimate", quantity: 1, unit: "serving", calories: 1000, protein: 140, carbs: 0, fat: 72, source: "estimated", confidence: 55 },
      ],
      source: "ai",
    }), TZ);
    const stored = await db.select().from(nutritionEntries).where(eq(nutritionEntries.mealId, meal.id));
    const steak = stored.find((s) => s.description === "Steak")!;
    expect(steak).toMatchObject({ calories: 1000, protein: 104, carbs: 0, fat: 64, quantity: 400, unit: "g" });
    const fixed = stored.find((s) => s.description === "Contradictory estimate")!;
    expect(fixed.calories).toBe(1208);
    expect(meal.adjustments).toHaveLength(1);
    expect(meal.adjustments[0]).toMatchObject({ from: 1000, to: 1208 });
    for (const row of stored) expect(n.consistencyOf(row).ok).toBe(true);
  });

  it("a saved food is used as database data and scales by servings and by grams", async () => {
    const food = await n.createFood(user.id, n.foodSchema.parse({ name: "Chips ración", servingGrams: 150, calories: 480, protein: 6, carbs: 60, fat: 24, source: "user" }));
    const oneServing = n.normalizeEntry({ calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat, quantity: 1, unit: "serving", basis: "serving", source: "import", servingGrams: food.servingGrams });
    expect(oneServing).toMatchObject({ calories: 480, protein: 6, carbs: 60, fat: 24 });
    const twoServings = n.normalizeEntry({ calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat, quantity: 2, unit: "serving", basis: "serving", source: "import", servingGrams: food.servingGrams });
    expect(twoServings).toMatchObject({ calories: 960, protein: 12, carbs: 120, fat: 48 });
    const inGrams = n.normalizeEntry({ calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat, quantity: 300, unit: "g", basis: "serving", source: "import", servingGrams: food.servingGrams });
    expect(inGrams.calories).toBe(960);
    expect(await n.resolveFood(user.id, { name: "chips RACIÓN" })).toMatchObject({ id: food.id });
    expect(await n.resolveFood(user.id, { name: "nothing like this" })).toBeNull();
  });

  it("meal and day aggregation use the same numbers, and the day reports its own consistency", async () => {
    const date = addDaysKey(today(), -1);
    await n.logMeal(user.id, n.mealSchema.parse({ date, type: "breakfast", items: [{ description: "Coffee", quantity: 1, unit: "serving", calories: 2, protein: 0, carbs: 0, fat: 0, source: "estimated", confidence: 90 }], source: "ai" }), TZ);
    await n.logMeal(user.id, n.mealSchema.parse({
      date, type: "dinner",
      items: [
        { description: "Eggs with tomato", quantity: 1, unit: "serving", calories: 320, protein: 22, carbs: 8, fat: 22, source: "estimated", confidence: 65 },
        { description: "Bread", quantity: 80, unit: "g", basis: "100g", calories: 260, protein: 9, carbs: 49, fat: 3, source: "estimated", confidence: 70 },
      ],
      source: "ai",
    }), TZ);
    const day = await n.dailyNutrition(user.id, date);
    const itemSum = n.totalsOf(day.meals.flatMap((m) => m.items));
    expect(day.totals).toEqual(itemSum);
    for (const m of day.meals) expect(m.totals).toEqual(n.totalsOf(m.items));
    expect(day.totals.calories).toBe(round2(2 + 320 + 208));
    expect(day.consistency.ok).toBe(true);
    expect(day.consistency.entriesOff).toBe(0);
    expect(day.estimatedItems).toBe(3);

    // The range view must tell the same story as the day view.
    const summary = await n.nutritionSummary(user.id, { from: date, to: date });
    expect(summary.daily[0]).toMatchObject({ date, calories: day.totals.calories, protein: day.totals.protein, carbs: day.totals.carbs, fat: day.totals.fat });
    expect(summary.daily[0].consistency.macroCalories).toBe(day.consistency.macroCalories);
  });

  it("legacy rows that contradict themselves are flagged on read, never silently corrected", async () => {
    const date = addDaysKey(today(), -2);
    const meal = await n.logMeal(user.id, n.mealSchema.parse({ date, type: "lunch", items: [{ description: "Placeholder", quantity: 1, unit: "serving", calories: 10, protein: 0, carbs: 0, fat: 0, source: "user" }], source: "user" }), TZ);
    // Written straight to the table the way the old pipeline could: energy and macros disagree.
    await db.insert(nutritionEntries).values({ userId: user.id, mealId: meal.id, description: "Legacy steak", quantity: 400, unit: "g", calories: 1000, protein: 140, carbs: 0, fat: 72, source: "estimated", confidence: 55 });
    const day = await n.dailyNutrition(user.id, date);
    const legacy = day.meals[0].items.find((i) => i.description === "Legacy steak")!;
    expect(legacy.consistency.ok).toBe(false);
    expect(legacy.consistency.macroCalories).toBe(1208);
    expect(legacy.calories).toBe(1000); // untouched: history is not rewritten behind the user's back
    expect(day.consistency.entriesOff).toBe(1);
    expect(day.consistency.ok).toBe(false);
  });

  it("the AI tool scales, labels and reconciles: 'a 400 g steak with a portion of chips'", async () => {
    const date = addDaysKey(today(), -3);
    const tool = getTool("log_meal")!;
    const r = await runTool(tool, {
      date, type: "dinner", name: "Steak and chips",
      items: [
        // Per-100 g figures plus a quantity: the model does no arithmetic.
        { description: "Entrecot a la brasa", quantity: 400, unit: "g", basis: "100g", calories: 250, protein: 26, carbs: 0, fat: 16, source: "estimated", confidence: 60 },
        // A saved food: database values, not an estimate.
        { description: "Ración de chips", food: "Chips ración", quantity: 1, unit: "serving", source: "estimated" },
      ],
    }, { user, conversationId: null, confirmed: false });
    expect(r.status).toBe("success");
    const meal = r.result as { items: (typeof nutritionEntries.$inferSelect)[]; adjustments: unknown[]; note: string };
    const steak = meal.items.find((i) => i.description === "Entrecot a la brasa")!;
    expect(steak).toMatchObject({ calories: 1000, protein: 104, carbs: 0, fat: 64, source: "estimated" });
    expect(n.consistencyOf(steak).ok).toBe(true);
    const chips = meal.items.find((i) => i.description === "Ración de chips")!;
    expect(chips).toMatchObject({ calories: 480, protein: 6, carbs: 60, fat: 24, source: "import" });
    expect(chips.foodId).toBeTruthy();
    const day = await n.dailyNutrition(user.id, date);
    expect(day.totals.calories).toBe(1480);
    expect(day.consistency.ok).toBe(true);
    expect(day.exactItems).toBe(1); // the chips came from the food database
    expect(day.estimatedItems).toBe(1);
  });

  it("the AI tool refuses to invent numbers it was not given", async () => {
    const tool = getTool("log_meal")!;
    const r = await runTool(tool, { date: addDaysKey(today(), -4), type: "snack", items: [{ description: "Something", food: "not a saved food", quantity: 1, unit: "serving", source: "estimated" }] }, { user, conversationId: null, confirmed: false });
    expect(r.status).toBe("failed");
    expect(r.error).toContain("No calories given");
  });

  it("a contradictory estimate through the AI tool is corrected and reported, not stored as given", async () => {
    const date = addDaysKey(today(), -5);
    const r = await runTool(getTool("log_meal")!, {
      date, type: "dinner",
      items: [{ description: "Bad estimate", quantity: 1, unit: "serving", calories: 1000, protein: 140, carbs: 0, fat: 72, source: "estimated", confidence: 55 }],
    }, { user, conversationId: null, confirmed: false });
    const meal = r.result as { items: { calories: number }[]; adjustments: { from: number; to: number }[]; note: string };
    expect(meal.items[0].calories).toBe(1208);
    expect(meal.adjustments[0]).toMatchObject({ from: 1000, to: 1208 });
    expect(meal.note).toContain("recomputed from the macros");
    const day = await n.dailyNutrition(user.id, date);
    expect(day.consistency.ok).toBe(true);
  });
});

function round2(v: number) { return Math.round(v * 100) / 100; }
