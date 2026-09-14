import { z } from "zod";
import { crud, query } from "@/server/crud";
import * as n from "@/server/services/nutrition";
export const foods = crud({ name: "nutrition.foods", createSchema: n.foodSchema, updateSchema: z.object({}), list: (u, req) => n.listFoods(u.id, query(req).q), create: (u, i) => n.createFood(u.id, i), remove: (u, id) => n.deleteFood(u.id, id) });
export const meals = crud({ name: "nutrition.meals", createSchema: n.mealSchema, updateSchema: z.object({}), list: (u, req) => n.dailyNutrition(u.id, query(req).date ?? new Date().toISOString().slice(0, 10)), create: (u, i) => n.logMeal(u.id, i, u.timezone), remove: (u, id) => n.deleteMeal(u.id, id) });
