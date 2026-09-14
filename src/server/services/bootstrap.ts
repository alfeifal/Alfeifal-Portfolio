import { db } from "@/server/db";
import { accounts, categories, subjects, tradingAccounts, watchlists } from "@/server/db/schema";
import { seedRoutine } from "./training";

/**
 * Seeds the minimum a fresh account needs to be useful immediately. Everything here is
 * structural (categories, a cash account, the attached training routine, the German subject).
 * No fake activity data is ever inserted.
 */
export async function bootstrapUserData(userId: string) {
  await db.insert(accounts).values({ userId, name: "Main account", type: "checking", currency: "EUR", isDefault: true });
  const expense = ["Food", "Groceries", "Transport", "Housing", "Utilities", "Health", "Gym", "Education", "German", "Subscriptions", "Entertainment", "Clothing", "Travel", "Gifts", "Other"];
  const income = ["Salary", "Freelance", "Investments", "Gifts", "Other income"];
  await db.insert(categories).values([
    ...expense.map((name) => ({ userId, name, kind: "expense" as const })),
    ...income.map((name) => ({ userId, name, kind: "income" as const })),
  ]);
  await db.insert(subjects).values([{ userId, name: "German", kind: "language", slug: "german", color: "#2F4BD6", weeklyGoalMinutes: 150 }]);
  await db.insert(tradingAccounts).values([
    { userId, name: "Paper account", mode: "paper", currency: "EUR", startingBalance: 10000 },
  ]);
  await db.insert(watchlists).values({ userId, name: "Watchlist", isDefault: true });
  await seedRoutine(userId);
}
