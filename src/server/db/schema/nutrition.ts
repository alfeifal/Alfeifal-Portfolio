import { date, index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dataSourceEnum, id, timestamps, userRef } from "./_shared";

export const foods = pgTable(
  "foods",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    brand: text("brand"),
    /** Per 100 g (or per serving when servingGrams is null and unit is "serving"). */
    servingGrams: numeric("serving_grams", { precision: 8, scale: 2, mode: "number" }),
    calories: numeric("calories", { precision: 8, scale: 2, mode: "number" }).notNull(),
    protein: numeric("protein", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
    carbs: numeric("carbs", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
    fat: numeric("fat", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("foods_user_name_idx").on(t.userId, t.name)],
);

export const meals = pgTable(
  "meals",
  {
    id: id(),
    userId: userRef(),
    date: date("date").notNull(),
    /** breakfast | lunch | dinner | snack | pre_workout | post_workout */
    type: text("type").notNull().default("snack"),
    name: text("name"),
    notes: text("notes"),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("meals_user_date_idx").on(t.userId, t.date)],
);

/** One line inside a meal. Values are stored as consumed (already multiplied by quantity). */
export const nutritionEntries = pgTable(
  "nutrition_entries",
  {
    id: id(),
    userId: userRef(),
    mealId: uuid("meal_id").notNull().references(() => meals.id, { onDelete: "cascade" }),
    foodId: uuid("food_id").references(() => foods.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 8, scale: 2, mode: "number" }).notNull().default(1),
    unit: text("unit").notNull().default("serving"), // g | ml | serving | unit
    calories: numeric("calories", { precision: 8, scale: 2, mode: "number" }).notNull(),
    protein: numeric("protein", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
    carbs: numeric("carbs", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
    fat: numeric("fat", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
    /** user (exact) | estimated (AI) | import (database) — spec §18 */
    source: dataSourceEnum("source").notNull().default("user"),
    confidence: integer("confidence"), // 0-100 for estimates
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("nutrition_entries_meal_idx").on(t.mealId)],
);
