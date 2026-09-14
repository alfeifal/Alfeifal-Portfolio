import { crud, query } from "@/server/crud";
import * as g from "@/server/services/goals";
export const goals = crud({
  name: "goals", createSchema: g.goalCreateSchema, updateSchema: g.goalUpdateSchema,
  list: (u, req) => g.listGoals(u.id, query(req).status), get: (u, id) => g.getGoal(u.id, id), create: (u, i) => g.createGoal(u.id, i), update: (u, id, i) => g.updateGoal(u.id, id, i), remove: (u, id) => g.deleteGoal(u.id, id),
});
