import { crud, query } from "@/server/crud";
import * as g from "@/server/services/goals";
export const goals = crud({
  name: "goals", createSchema: g.goalCreateSchema, updateSchema: g.goalUpdateSchema,
  list: (u, req) => g.listGoals(u.id, query(req).status, u.timezone), get: (u, id) => g.getGoal(u.id, id, u.timezone), create: (u, i) => g.createGoal(u.id, i, u.timezone), update: (u, id, i) => g.updateGoal(u.id, id, i, u.timezone), remove: (u, id) => g.deleteGoal(u.id, id),
});
