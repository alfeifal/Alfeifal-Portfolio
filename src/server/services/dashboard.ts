import type { SessionUser } from "@/server/auth/session";
import { listTasks, taskCounts } from "./tasks";
import { listEvents } from "./calendar";
import { weeklyTrainingStatus, workoutForDate, workoutHistory } from "./training";
import { financialSummary, listTransactions, listSavingsGoals, processRecurring } from "./finance";
import { listGoals } from "./goals";
import { listProjects } from "./projects";
import { portfolio } from "./investing";
import { listTrades, listWatchlists } from "./trading";
import { listNews, listEconomicEvents } from "./market";
import { studyProgress, listExams } from "./studies";
import { dailyNutrition } from "./nutrition";
import { germanSummary } from "./german";
import { unreadCount, generateNotifications } from "./notifications";
import { addDaysKey, todayKey } from "@/lib/dates";
import { monthRange } from "@/lib/dates";
import { format } from "date-fns";
import { getPreferences } from "./users";
import { plannerSnapshot } from "./planner";

export const DEFAULT_WIDGETS = ["today", "finance", "goals", "projects", "training", "studies", "investing", "trading", "news"] as const;
export type Widget = (typeof DEFAULT_WIDGETS)[number];

/** Everything the Home page needs, in one round trip. Configurable via preferences.dashboard.widgets. */
export async function dashboardData(user: SessionUser) {
  const tz = user.timezone;
  const today = todayKey(tz);
  const m = monthRange(new Date());
  const prefs = await getPreferences(user.id);
  const widgets = ((prefs.dashboard as { widgets?: Widget[] } | undefined)?.widgets ?? [...DEFAULT_WIDGETS]).filter((w) => DEFAULT_WIDGETS.includes(w));
  await Promise.all([processRecurring(user.id, tz).catch(() => 0), generateNotifications(user.id, tz).catch(() => 0)]);
  const has = (w: Widget) => widgets.includes(w);
  const [tasksToday, overdue, counts, events, plan, workout, recentWorkouts, week, finance, recentTx, savings, goals, projects, port, openTrades, watchlists, news, econ, study, exams, nutrition, german, unread] = await Promise.all([
    listTasks(user.id, { view: "today", tz, limit: 12 }),
    listTasks(user.id, { view: "overdue", tz, limit: 12 }),
    taskCounts(user.id, tz),
    listEvents(user.id, { from: new Date(today + "T00:00:00"), to: new Date(addDaysKey(today, 1) + "T23:59:59") }),
    has("today") ? plannerSnapshot(user.id, tz) : null,
    has("training") || has("today") ? workoutForDate(user.id, today) : null,
    has("training") ? workoutHistory(user.id, { limit: 5 }) : [],
    has("training") || has("today") ? weeklyTrainingStatus(user.id, tz) : null,
    has("finance") ? financialSummary(user.id, { from: format(m.start, "yyyy-MM-dd"), to: format(m.end, "yyyy-MM-dd") }) : null,
    has("finance") ? listTransactions(user.id, { limit: 6 }) : [],
    has("finance") ? listSavingsGoals(user.id) : [],
    has("goals") ? listGoals(user.id, "active", tz) : [],
    has("projects") ? listProjects(user.id, "active") : [],
    has("investing") ? portfolio(user.id).catch(() => null) : null,
    has("trading") ? listTrades(user.id, { status: "open", limit: 10 }) : [],
    has("trading") ? listWatchlists(user.id) : [],
    has("news") ? listNews({ limit: 8, sinceHours: 48 }) : [],
    has("trading") ? listEconomicEvents(user.id, { from: new Date(), to: new Date(Date.now() + 3 * 86400e3) }) : [],
    has("studies") ? studyProgress(user.id, { from: addDaysKey(today, -6), to: today }) : null,
    has("studies") ? listExams(user.id, true, tz) : [],
    has("today") ? dailyNutrition(user.id, today) : null,
    has("studies") ? germanSummary(user.id, { from: addDaysKey(today, -6), to: today }) : null,
    unreadCount(user.id),
  ]);
  return {
    today, widgets, unreadNotifications: unread,
    tasks: { today: tasksToday, overdue, counts },
    events,
    plan,
    training: { workout, recent: recentWorkouts, week },
    finance: finance ? { income: finance.income, expenses: finance.expenses, net: finance.net, savingsRate: finance.savingsRate, byCategory: finance.byCategory.slice(0, 5), budgets: finance.budgets, financeBalance: finance.financeBalance, accounts: finance.accounts, recent: recentTx, savings } : null,
    goals: goals.slice(0, 8),
    projects: projects.slice(0, 8),
    investing: port ? { totalValue: port.totalValue, totalCost: port.totalCost, unrealized: port.unrealized, cash: port.cash, positions: port.positions.slice(0, 6), unpriced: port.unpriced } : null,
    trading: { openTrades, watchlists, economicEvents: econ },
    news,
    studies: study ? { ...study, exams: exams.slice(0, 5), german } : null,
    nutrition: nutrition ? { totals: nutrition.totals, goals: nutrition.goals, meals: nutrition.meals.length, estimatedItems: nutrition.estimatedItems } : null,
  };
}
