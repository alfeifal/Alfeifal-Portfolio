import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { deleteUser } from "./users";

/** Full JSON export of everything the user owns (spec §40). Secrets (password hash, sessions) are excluded. */
export async function exportAll(userId: string) {
  const u = (await db.select().from(s.users).where(eq(s.users.id, userId)))[0];
  const own = <T extends { userId: unknown }>(table: { userId: unknown } & Parameters<typeof db.select>[0]) => table;
  void own;
  const byUser = async <T>(q: Promise<T[]>) => q;
  const data = {
    exportedAt: new Date().toISOString(),
    version: 1,
    profile: u ? { id: u.id, email: u.email, name: u.name, timezone: u.timezone, currency: u.currency, locale: u.locale, preferences: u.preferences, createdAt: u.createdAt } : null,
    goals: await byUser(db.select().from(s.goals).where(eq(s.goals.userId, userId))),
    milestones: await db.select().from(s.milestones).where(eq(s.milestones.userId, userId)),
    projects: await db.select().from(s.projects).where(eq(s.projects.userId, userId)),
    tasks: await db.select().from(s.tasks).where(eq(s.tasks.userId, userId)),
    events: await db.select().from(s.events).where(eq(s.events.userId, userId)),
    journal: await db.select().from(s.journalEntries).where(eq(s.journalEntries.userId, userId)),
    finance: {
      accounts: await db.select().from(s.accounts).where(eq(s.accounts.userId, userId)),
      categories: await db.select().from(s.categories).where(eq(s.categories.userId, userId)),
      transactions: await db.select().from(s.transactions).where(eq(s.transactions.userId, userId)),
      recurring: await db.select().from(s.recurringTransactions).where(eq(s.recurringTransactions.userId, userId)),
      budgets: await db.select().from(s.budgets).where(eq(s.budgets.userId, userId)),
      savingsGoals: await db.select().from(s.savingsGoals).where(eq(s.savingsGoals.userId, userId)),
    },
    investing: {
      accounts: await db.select().from(s.investmentAccounts).where(eq(s.investmentAccounts.userId, userId)),
      assets: await db.select().from(s.investmentAssets).where(eq(s.investmentAssets.userId, userId)),
      transactions: await db.select().from(s.investmentTransactions).where(eq(s.investmentTransactions.userId, userId)),
      snapshots: await db.select().from(s.portfolioSnapshots).where(eq(s.portfolioSnapshots.userId, userId)),
    },
    trading: {
      accounts: await db.select().from(s.tradingAccounts).where(eq(s.tradingAccounts.userId, userId)),
      strategies: await db.select().from(s.strategies).where(eq(s.strategies.userId, userId)),
      trades: await db.select().from(s.trades).where(eq(s.trades.userId, userId)),
      watchlists: await db.select().from(s.watchlists).where(eq(s.watchlists.userId, userId)),
      watchlistItems: await db.select().from(s.watchlistItems).where(eq(s.watchlistItems.userId, userId)),
      alerts: await db.select().from(s.priceAlerts).where(eq(s.priceAlerts.userId, userId)),
      economicEvents: await db.select().from(s.economicEvents).where(eq(s.economicEvents.userId, userId)),
      academyLessons: await db.select().from(s.academyLessons).where(eq(s.academyLessons.userId, userId)),
      academyProgress: await db.select().from(s.academyProgress).where(eq(s.academyProgress.userId, userId)),
    },
    training: {
      exercises: await db.select().from(s.exercises).where(eq(s.exercises.userId, userId)),
      plans: await db.select().from(s.trainingPlans).where(eq(s.trainingPlans.userId, userId)),
      days: await db.select().from(s.trainingDays).where(eq(s.trainingDays.userId, userId)),
      dayExercises: await db.select().from(s.trainingDayExercises).where(eq(s.trainingDayExercises.userId, userId)),
      sessions: await db.select().from(s.workoutSessions).where(eq(s.workoutSessions.userId, userId)),
      sets: await db.select().from(s.workoutSets).where(eq(s.workoutSets.userId, userId)),
      personalRecords: await db.select().from(s.personalRecords).where(eq(s.personalRecords.userId, userId)),
    },
    nutrition: {
      foods: await db.select().from(s.foods).where(eq(s.foods.userId, userId)),
      meals: await db.select().from(s.meals).where(eq(s.meals.userId, userId)),
      entries: await db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.userId, userId)),
    },
    studies: {
      subjects: await db.select().from(s.subjects).where(eq(s.subjects.userId, userId)),
      sessions: await db.select().from(s.studySessions).where(eq(s.studySessions.userId, userId)),
      assignments: await db.select().from(s.assignments).where(eq(s.assignments.userId, userId)),
      exams: await db.select().from(s.exams).where(eq(s.exams.userId, userId)),
    },
    german: {
      progress: (await db.select().from(s.germanProgress).where(eq(s.germanProgress.userId, userId)))[0]?.state ?? null,
      events: await db.select().from(s.germanEvents).where(eq(s.germanEvents.userId, userId)),
    },
    ai: {
      memory: await db.select().from(s.aiMemory).where(eq(s.aiMemory.userId, userId)),
      actionLogs: await db.select().from(s.aiActionLogs).where(eq(s.aiActionLogs.userId, userId)),
      conversations: await db.select().from(s.conversations).where(eq(s.conversations.userId, userId)),
      reports: await db.select().from(s.aiReports).where(eq(s.aiReports.userId, userId)),
    },
    notifications: await db.select().from(s.notifications).where(eq(s.notifications.userId, userId)),
    auditLogs: await db.select().from(s.auditLogs).where(eq(s.auditLogs.userId, userId)),
  };
  await audit({ userId, actor: "user", action: "data.export" });
  return data;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const sVal = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(sVal) ? `"${sVal.replace(/"/g, '""')}"` : sVal;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export async function csvFor(userId: string, dataset: string): Promise<string> {
  switch (dataset) {
    case "transactions": return toCsv(await db.select().from(s.transactions).where(eq(s.transactions.userId, userId)));
    case "tasks": return toCsv(await db.select().from(s.tasks).where(eq(s.tasks.userId, userId)));
    case "events": return toCsv(await db.select().from(s.events).where(eq(s.events.userId, userId)));
    case "trades": return toCsv(await db.select().from(s.trades).where(eq(s.trades.userId, userId)));
    case "workout_sets": return toCsv(await db.select().from(s.workoutSets).where(eq(s.workoutSets.userId, userId)));
    case "workout_sessions": return toCsv(await db.select().from(s.workoutSessions).where(eq(s.workoutSessions.userId, userId)));
    case "study_sessions": return toCsv(await db.select().from(s.studySessions).where(eq(s.studySessions.userId, userId)));
    case "journal": return toCsv(await db.select().from(s.journalEntries).where(eq(s.journalEntries.userId, userId)));
    case "nutrition": return toCsv(await db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.userId, userId)));
    case "investment_transactions": return toCsv(await db.select().from(s.investmentTransactions).where(eq(s.investmentTransactions.userId, userId)));
    default: throw new Error("Unknown dataset");
  }
}
export const CSV_DATASETS = ["transactions", "tasks", "events", "trades", "workout_sets", "workout_sessions", "study_sessions", "journal", "nutrition", "investment_transactions"];

/** Irreversible: deletes the account and every row that cascades from it. */
export async function deleteAccountAndData(userId: string) {
  await audit({ userId: null, actor: "user", action: "account.delete", metadata: { userId } });
  await deleteUser(userId);
}
