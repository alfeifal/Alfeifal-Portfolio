import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import {
  accounts, categories, exercises, foods, goals, investmentAccounts, investmentAssets, meals,
  milestones, plans, projects, strategies, subjects, tasks, tradingAccounts, trainingDays,
  trainingPlans, watchlists, workoutSessions,
} from "@/server/db/schema";
import { notFound } from "@/server/http";

/**
 * Ownership checks for foreign keys that arrive from outside.
 *
 * Every user-scoped row is read and written with `user_id = :currentUser`, so nobody can read or
 * delete a row that is not theirs. What that does not cover is a *reference*: `createTask` used to
 * take whatever `projectId` the caller sent and store it, which let one account attach a row to
 * another account's project. Nothing leaked directly, but the target's project counters moved — a
 * write across the boundary, and the exact thing the client must never be trusted with.
 *
 * So: any id that comes from a request body, a query string or an AI tool argument passes through
 * here first. A reference to somebody else's row is reported as `not found`, the same answer as an
 * id that never existed, so this can never be used to probe what other accounts own.
 */
const OWNED = {
  account: { table: accounts, label: "Account" },
  category: { table: categories, label: "Category" },
  exercise: { table: exercises, label: "Exercise" },
  food: { table: foods, label: "Food" },
  goal: { table: goals, label: "Goal" },
  investmentAccount: { table: investmentAccounts, label: "Investment account" },
  investmentAsset: { table: investmentAssets, label: "Asset" },
  meal: { table: meals, label: "Meal" },
  milestone: { table: milestones, label: "Milestone" },
  plan: { table: plans, label: "Plan" },
  project: { table: projects, label: "Project" },
  strategy: { table: strategies, label: "Strategy" },
  subject: { table: subjects, label: "Subject" },
  task: { table: tasks, label: "Task" },
  tradingAccount: { table: tradingAccounts, label: "Trading account" },
  trainingDay: { table: trainingDays, label: "Training day" },
  trainingPlan: { table: trainingPlans, label: "Training plan" },
  watchlist: { table: watchlists, label: "Watchlist" },
  workoutSession: { table: workoutSessions, label: "Workout session" },
} as const;

export type OwnedKind = keyof typeof OWNED;

/**
 * Throws `not found` unless every id given belongs to `userId`.
 *
 * `null` and `undefined` are accepted and skipped — "no reference" is a valid value for most of
 * these columns, and forcing callers to strip them would just move the mistake somewhere else.
 */
export async function assertOwned(userId: string, refs: Partial<Record<OwnedKind, string | null | undefined>>) {
  const checks = (Object.entries(refs) as [OwnedKind, string | null | undefined][]).filter(([, id]) => typeof id === "string" && id.length > 0);
  if (!checks.length) return;
  await Promise.all(checks.map(async ([kind, id]) => {
    const { table, label } = OWNED[kind];
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id as string), eq(table.userId, userId)))
      .limit(1);
    if (!rows.length) throw notFound(label);
  }));
}

/** Same check for a list of ids of one kind, in a single query. */
export async function assertAllOwned(userId: string, kind: OwnedKind, ids: readonly string[]) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return;
  const { table, label } = OWNED[kind];
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(inArray(table.id, wanted), eq(table.userId, userId)));
  if (rows.length !== wanted.length) throw notFound(label);
}

/** The kinds this module knows how to check. Exported so a test can assert none was forgotten. */
export const ownedKinds = Object.keys(OWNED) as OwnedKind[];
