import { subscribe } from "../bus";
import { recomputeGoalProgress } from "@/server/services/goals";
import { recomputeProjectProgress } from "@/server/services/projects";

/**
 * Keeps the stored progress of a goal or project equal to the work it actually contains (phase 3.8).
 *
 * Task events already carry the goal and project the task belonged to, so the affected rows are known
 * without a scan. Recomputing is a query, not an increment, so a replayed or duplicated event cannot
 * double count — the same property that makes the linked-goals subscriber safe.
 *
 * A reopened, deleted or re-assigned task arrives as `task.changed` with the ids it had, which is what
 * lets progress fall back down instead of only ever rising.
 */
subscribe({
  name: "progress",
  types: ["task.completed", "task.changed"],
  run: async (userId, event, ctx) => {
    if (event.type !== "task.completed" && event.type !== "task.changed") return null;
    const touched: string[] = [];
    if (event.projectId) {
      await recomputeProjectProgress(userId, event.projectId, event.type);
      touched.push("project:" + event.projectId);
    }
    if (event.goalId) {
      // Manual goals only — `recomputeGoalProgress` leaves a linked goal to the goals subscriber.
      await recomputeGoalProgress(userId, event.goalId, event.type);
      touched.push("goal:" + event.goalId);
    }
    void ctx;
    return touched.length ? { recomputed: touched } : null;
  },
});
