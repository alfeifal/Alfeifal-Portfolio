import { db } from "@/server/db";
import { accounts, categories, subjects, tradingAccounts, watchlists } from "@/server/db/schema";
import { seedRoutine } from "./training";

/**
 * Seeds the minimum a fresh account needs to be useful immediately. Everything here is
 * structural (categories, a cash account, the attached training routine, the German subject).
 * No fake activity data is ever inserted.
 */
export async function bootstrapUserData(userId: string) {
  /*
   * One transaction, because a half-built account cannot be repaired from the UI.
   *
   * These were five sequential inserts, and a failure at any of them left whatever came before it
   * behind. Reproduced: calling this twice for one account throws on the categories insert — which
   * migration 0008 made possible, by making a category name unique per account and kind — and leaves
   * a second "Main account" row and nothing else. Partial structural data is worse than none: the
   * account looks set up and silently lacks a watchlist, or a paper trading account, with no button
   * anywhere to finish the job.
   *
   * `seedRoutine` keeps its own transaction and its own early return, so it stays outside this one:
   * it is already idempotent, and nesting would make its 100-plus inserts part of this commit for no
   * benefit.
   */
  await db.transaction(async (tx) => {
    await tx.insert(accounts).values({ userId, name: "Main account", type: "checking", currency: "EUR", isDefault: true });
    const expense = ["Food", "Groceries", "Transport", "Housing", "Utilities", "Health", "Gym", "Education", "German", "Subscriptions", "Entertainment", "Clothing", "Travel", "Gifts", "Other"];
    const income = ["Salary", "Freelance", "Investments", "Gifts", "Other income"];
    await tx.insert(categories).values([
      ...expense.map((name) => ({ userId, name, kind: "expense" as const })),
      ...income.map((name) => ({ userId, name, kind: "income" as const })),
    ]);
    await tx.insert(subjects).values([{ userId, name: "German", kind: "language", slug: "german", color: "#2F4BD6", weeklyGoalMinutes: 150 }]);
    await tx.insert(tradingAccounts).values([
      { userId, name: "Paper account", mode: "paper", currency: "EUR", startingBalance: 10000 },
    ]);
    await tx.insert(watchlists).values({ userId, name: "Watchlist", isDefault: true });
  });
  await seedRoutine(userId);
}
