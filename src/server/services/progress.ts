import { clamp } from "@/lib/utils";

/**
 * The single formula for "how far along is this?" (phase 3.8).
 *
 * Before this existed, a project's progress was computed in two places that disagreed: the Projects
 * page derived it from task counts, while Analytics averaged the stored `projects.progress` column,
 * which nothing ever updated. A project with one of two tasks done therefore read 50 % on its own page
 * and 0 % in Analytics and in the weekly Review.
 *
 * Now there is one function. The read path calls it, and `recompute*Progress` calls it and persists the
 * result, so every aggregate that reads the column — Analytics, Reviews, Search, Snapshot, notifications
 * — sees the same number the detail page shows.
 *
 * The rule is a precedence, not a blend, because mixing them invents a number nobody can explain:
 *   tasks      → if the thing has executable work, that is what "progress" means.
 *   milestones → otherwise, if it has checkpoints, the share of them completed.
 *   manual     → otherwise, whatever the user set by hand.
 */
export type ProgressBasis = "tasks" | "milestones" | "manual" | "none";

export interface ProgressCounts {
  /** Tasks still to do (todo / in_progress). Cancelled tasks are in neither count and are ignored. */
  openTasks: number;
  doneTasks: number;
  totalMilestones: number;
  doneMilestones: number;
}

export interface DerivedProgress {
  progress: number;
  basis: ProgressBasis;
  /** What the percentage was computed over, so the UI can say "3 of 4 tasks" instead of a bare 75 %. */
  done: number;
  total: number;
}

/**
 * Derives progress from what the entity actually has. `manual` is the fallback only — it is never
 * blended in, so a number on screen always has one explainable origin.
 */
export function deriveProgress(counts: ProgressCounts, manual = 0): DerivedProgress {
  const tasks = counts.openTasks + counts.doneTasks;
  if (tasks > 0) return { progress: pctOf(counts.doneTasks, tasks), basis: "tasks", done: counts.doneTasks, total: tasks };
  if (counts.totalMilestones > 0) return { progress: pctOf(counts.doneMilestones, counts.totalMilestones), basis: "milestones", done: counts.doneMilestones, total: counts.totalMilestones };
  return { progress: clamp(Math.round(manual), 0, 100), basis: manual > 0 ? "manual" : "none", done: 0, total: 0 };
}

/**
 * A percentage that cannot be NaN, Infinity, negative or above 100 — the denominator is checked and the
 * result is clamped, so a corrupted count can never put an impossible number on screen.
 */
export function pctOf(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return clamp(Math.round((Math.max(done, 0) / total) * 100), 0, 100);
}

/** SQL mirror of `deriveProgress`, for the aggregate queries that cannot load every row. */
export const PROGRESS_SQL = `
  case
    when (open_tasks + done_tasks) > 0 then round((done_tasks::numeric / (open_tasks + done_tasks)) * 100)
    when total_milestones > 0 then round((done_milestones::numeric / total_milestones) * 100)
    else manual
  end`;
