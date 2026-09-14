import { subscribe } from "../bus";
import type { DomainEvent } from "../types";
import { recomputeLinkedGoals } from "@/server/services/goals";
import type { MetricSource } from "@/server/services/goal-metrics";

/**
 * Goals subscriber: maps each domain event to the metric sources it can affect and recomputes the user's
 * active linked goals of those sources from the source of truth. Idempotent by construction — there is no
 * counter to increment, only a query to re-run — so a duplicated or replayed event is harmless.
 */
const AFFECTS: Partial<Record<DomainEvent["type"], MetricSource[]>> = {
  "task.completed": ["tasks"],
  "task.changed": ["tasks"],
  "workout.finished": ["training"],
  "workout.changed": ["training"],
  "study.logged": ["study", "german"],
  "study.changed": ["study", "german"],
  "expense.added": ["finance"],
  "income.added": ["finance"],
  "transaction.changed": ["finance"],
  "german.unit_completed": ["german"],
  "german.state_saved": ["german"],
};

subscribe({
  name: "goals",
  types: Object.keys(AFFECTS) as DomainEvent["type"][],
  run: async (userId, event, ctx) => {
    const sources = AFFECTS[event.type];
    if (!sources) return { changed: 0 };
    const r = await recomputeLinkedGoals(userId, { sources, cause: event.type, tz: ctx.tz, depth: ctx.depth });
    return { changed: r.changed.length, goals: r.changed.map((c) => ({ id: c.goal.id, before: c.before, after: c.after })) };
  },
});
