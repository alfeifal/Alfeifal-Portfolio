import { allTools, getTool } from "./registry";
import "./tools";

/**
 * Which tools each mode is given.
 *
 * Phase 3.16 measured the tool block: 144 tools, ~102 kB, ~27.5k tokens — about 96% of everything the
 * model reads on a request. The obvious move is to route tools per message, and the measurement says
 * not to, for one reason that is a property of the API rather than of this code:
 *
 *   the request renders as tools → system → messages, and a change anywhere in that prefix invalidates
 *   the cache for everything after it.
 *
 * Tools sit at the very front. Changing them per message therefore re-writes the system prompt AND the
 * whole conversation history on every topic switch, at cache-write price. Measured over a ten-turn
 * conversation that switches domain each turn, per-message routing costs ~93k token-equivalents against
 * ~65k for simply sending all 144 cached — it is slower and dearer, not cheaper. (Working in
 * `.p316/cache-econ.ts` at the time; numbers in the phase report.)
 *
 * What does pay is scoping by MODE, because a mode's tool list is constant: each mode keeps its own
 * stable cached prefix, and nothing is ever recomputed mid-conversation. That is what this file is.
 *
 * The assistant deliberately keeps all 144. It is the one surface where the next sentence can be about
 * anything, and a tool that is absent is a capability the user silently no longer has.
 */

/** Names are resolved against the registry, so a typo fails a test instead of dropping a capability. */
export function resolve(names: readonly string[]): string[] {
  const missing = names.filter((n) => !getTool(n));
  if (missing.length) throw new Error(`tool-groups references tools that are not registered: ${missing.join(", ")}`);
  return [...names];
}

/** Every tool of a module, or only its read-only ones. */
export function moduleTools(module: string, opts: { readsOnly?: boolean } = {}): string[] {
  return allTools().filter((t) => t.module === module && (!opts.readsOnly || t.risk === "read")).map((t) => t.name);
}

/**
 * Fast Log's surface.
 *
 * Fast Log is one line of text that becomes one record. Its own instructions name what it is for —
 * "expense, income, task, event, workout set, study session, meal, journal entry, goal progress" — and
 * that list is exactly what is here, plus the few reads needed to resolve a name to an id without
 * guessing. It is deliberately NOT the assistant: no deletes, no account or plan administration, no
 * trading or investing (money that moves between books is never a one-liner), no analytics.
 *
 * Every tool here is low risk and runs immediately, which is what keeps Fast Log fast.
 */
export const FAST_LOG_TOOLS = [
  // money in and out — personal finance only
  "add_expense", "add_income",
  // the day
  "create_task", "complete_task", "create_event",
  // training
  "log_set", "log_sets", "log_workout", "get_today_workout",
  // food
  "log_meal", "create_food",
  // studying
  "log_study_session", "create_exam", "create_assignment", "complete_assignment",
  // writing it down
  "create_journal_entry",
  // progress on something already being tracked
  "update_goal_progress", "complete_milestone",
  // resolving "that goal" / "that project" to a real id, rather than inventing one
  "search_personal_os", "get_goals", "get_tasks",
  // durable facts the user states in passing
  "remember_memory",
] as const;

/**
 * Planner's surface: read everything that bears on a day, then save a draft.
 *
 * This list already existed inline in `reports.ts`; it lives here now so that every mode's surface is
 * in one place and one test can check them all. `propose_plan` is the only write, which is what makes
 * planner mode unable to create anything real — the user accepts a plan in the Planner, not here.
 */
export const PLANNER_TOOLS = [
  "get_snapshot", "get_plan", "propose_plan",
  "get_calendar", "get_tasks", "get_goals", "get_projects",
  "get_today_workout", "get_training_plan", "get_study_schedule", "get_german_progress", "get_financial_summary",
] as const;

/** The modes that restrict their tools, and the tools they restrict to. `assistant` is absent on purpose. */
export const MODE_TOOLS: Record<string, readonly string[]> = {
  quick_entry: FAST_LOG_TOOLS,
  planner: PLANNER_TOOLS,
};

/**
 * The tool names a mode may use, or `null` for "every registered tool".
 *
 * `mode` is never a string from the client: the routes accept a fixed enum and map it here, so no
 * message can widen its own surface or reach a tool its mode does not have.
 */
export function toolsForMode(mode: string): string[] | null {
  const names = MODE_TOOLS[mode];
  return names ? resolve(names) : null;
}
