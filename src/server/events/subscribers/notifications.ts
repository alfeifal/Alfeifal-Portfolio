import { subscribe } from "../bus";
import { notificationSettings, notify } from "@/server/services/notifications";

/**
 * Notifications subscriber. Deliberately narrow — two transitions only, both deduplicated per goal and
 * period so an event can never produce a stream of messages:
 *   1. a linked goal reaches its target (progress crosses 100 %);
 *   2. a linked goal that was *at risk* (see goalPace) is back on track after an activity.
 * Nothing is sent for ordinary progress, for every workout/expense/task, or when the user disabled goal
 * notifications. "Goal at risk" itself is not pushed from here (it would fire on a quiet day, not on an
 * action); it is left for the daily generator in a later phase.
 */
subscribe({
  name: "notifications",
  types: ["goal.progress_changed"],
  run: async (userId, event) => {
    if (event.type !== "goal.progress_changed") return null;
    const settings = await notificationSettings(userId);
    if (!settings.goals) return { skipped: "goals notifications disabled" };
    const { before, after } = event;
    const value = after.metricCurrent != null && event.target != null ? ` (${after.metricCurrent}/${event.target} ${event.unit ?? ""})`.replace(/\s\)$/, ")") : "";
    if (after.progress >= 100 && before.progress < 100) {
      const n = await notify(userId, { kind: "goal", title: `Goal reached: ${event.name}${value}`, href: `/goals/${event.goalId}`, dedupeKey: `goal:reached:${event.goalId}:${event.periodKey}` });
      return { notified: n ? "reached" : "reached (deduped)" };
    }
    if (before.atRisk && !after.atRisk && after.progress < 100) {
      const n = await notify(userId, { kind: "goal", title: `Back on track: ${event.name}${value}`, href: `/goals/${event.goalId}`, dedupeKey: `goal:ontrack:${event.goalId}:${event.periodKey}` });
      return { notified: n ? "on_track" : "on_track (deduped)" };
    }
    return null;
  },
});
