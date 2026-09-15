import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { aiReports } from "@/server/db/schema";
import type { SessionUser } from "@/server/auth/session";
import { chat, complete } from "./agent";
import { listTasks } from "@/server/services/tasks";
import { listEvents } from "@/server/services/calendar";
import { listGoals } from "@/server/services/goals";
import { listProjects } from "@/server/services/projects";
import { financialSummary } from "@/server/services/finance";
import { workoutHistory, workoutForDate } from "@/server/services/training";
import { studyProgress, listExams, listAssignments } from "@/server/services/studies";
import { germanSummary } from "@/server/services/german";
import { tradingStatistics, listTrades, listWatchlists } from "@/server/services/trading";
import { listJournal } from "@/server/services/journal";
import { dailyNutrition } from "@/server/services/nutrition";
import { getQuotes, listEconomicEvents, listNews, refreshNews } from "@/server/services/market";
import { addDaysKey, isoWeekKey, todayKey } from "@/lib/dates";
import type { AssetClass } from "@/server/market";

async function saveReport(userId: string, kind: string, periodKey: string, content: string, data: unknown) {
  const [r] = await db.insert(aiReports).values({ userId, kind, periodKey, content, data }).returning();
  return r;
}
export async function latestReport(userId: string, kind: string, periodKey?: string) {
  const conds = [eq(aiReports.userId, userId), eq(aiReports.kind, kind)];
  if (periodKey) conds.push(eq(aiReports.periodKey, periodKey));
  const [r] = await db.select().from(aiReports).where(and(...conds)).orderBy(desc(aiReports.createdAt)).limit(1);
  return r ?? null;
}
export async function listReports(userId: string, kind: string, limit = 20) {
  return db.select().from(aiReports).where(and(eq(aiReports.userId, userId), eq(aiReports.kind, kind))).orderBy(desc(aiReports.createdAt)).limit(limit);
}

const BASE = "You write for the owner of a private Personal OS. Be concrete, specific and short. Use the data given; every number must come from it. Mark anything not in the data as unknown. Use markdown with short sections and bullets. Write in the same language the user mostly uses in their data (Spanish if unsure).";

/** Daily review (spec §28): what was done/missed today, then focus for tomorrow. */
export async function dailyReview(user: SessionUser, date?: string) {
  const tz = user.timezone;
  const day = date ?? todayKey(tz);
  const [doneTasks, openToday, events, workout, finance, study, german, journal, nutrition, sessions] = await Promise.all([
    listTasks(user.id, { view: "completed", tz, limit: 50 }).then((t) => t.filter((x) => x.completedAt && x.completedAt.toISOString().slice(0, 10) === day)),
    listTasks(user.id, { view: "today", tz }),
    listEvents(user.id, { from: new Date(day + "T00:00:00"), to: new Date(day + "T23:59:59") }),
    workoutForDate(user.id, day),
    financialSummary(user.id, { from: day, to: day }),
    studyProgress(user.id, { from: day, to: day }),
    germanSummary(user.id, { from: day, to: day }),
    listJournal(user.id, { from: day, to: day }),
    dailyNutrition(user.id, day),
    workoutHistory(user.id, { from: day, to: day }),
  ]);
  const data = { date: day, doneTasks: doneTasks.map((t) => t.title), openOrOverdue: openToday.map((t) => ({ title: t.title, due: t.dueDate, priority: t.priority })), events: events.map((e) => ({ title: e.title, kind: e.kind })), training: { plannedDay: workout?.day?.name ?? null, isRest: workout?.day?.isRest ?? null, sessions: sessions.map((s) => ({ day: s.dayName, sets: s.sets, volume: s.volume, status: s.status, isWorkout: s.isWorkout })) }, finance: { expenses: finance.expenses, income: finance.income, top: finance.byCategory.slice(0, 5) }, study: { minutes: study.totalMinutes, bySubject: study.bySubject }, german: { minutes: german.totalMinutes, streak: german.streak }, nutrition: { totals: nutrition.totals, goals: nutrition.goals, estimatedItems: nutrition.estimatedItems }, journal: journal.map((j) => ({ kind: j.kind, mood: j.mood, text: j.content.slice(0, 300) })) };
  const content = await complete({ system: BASE, prompt: `Write the DAILY REVIEW for ${day}. Sections: "Done", "Missed / still open", "Training", "Studies & German", "Finance", "Nutrition", then "Focus for tomorrow" with max 3 concrete items prioritised by deadlines and importance.\n\nDATA:\n${JSON.stringify(data)}` });
  return saveReport(user.id, "daily_review", day, content, data);
}

/** Weekly review (spec §29). */
export async function weeklyReview(user: SessionUser, refDate?: string) {
  const tz = user.timezone;
  const to = refDate ?? todayKey(tz);
  const from = addDaysKey(to, -6);
  const [done, overdue, finance, sessions, study, german, projects, goals, tradingPaper, tradingReal, exams, assignments, upcoming] = await Promise.all([
    listTasks(user.id, { view: "completed", tz, limit: 200 }).then((t) => t.filter((x) => x.completedAt && x.completedAt.toISOString().slice(0, 10) >= from)),
    listTasks(user.id, { view: "overdue", tz }),
    financialSummary(user.id, { from, to }),
    workoutHistory(user.id, { from, to }),
    studyProgress(user.id, { from, to }),
    germanSummary(user.id, { from, to }),
    listProjects(user.id, "active"),
    listGoals(user.id, "active", user.timezone),
    tradingStatistics(user.id, "paper", { from, to }),
    tradingStatistics(user.id, "real", { from, to }),
    listExams(user.id, true, tz),
    listAssignments(user.id, true),
    listEvents(user.id, { from: new Date(addDaysKey(to, 1) + "T00:00:00"), to: new Date(addDaysKey(to, 7) + "T23:59:59") }),
  ]);
  const data = { from, to, completedTasks: done.length, completedTitles: done.slice(0, 30).map((t) => t.title), overdue: overdue.map((t) => ({ title: t.title, due: t.dueDate })), finance: { income: finance.income, expenses: finance.expenses, net: finance.net, savingsRate: finance.savingsRate, top: finance.byCategory.slice(0, 6), budgets: finance.budgets }, training: { workouts: sessions.filter((s) => s.isWorkout).length, emptySessions: sessions.filter((s) => !s.isWorkout).length, volume: sessions.reduce((a, s) => a + s.volume, 0), days: sessions.filter((s) => s.isWorkout).map((s) => ({ date: s.date, day: s.dayName, sets: s.sets, status: s.status })) }, study, german: { minutes: german.totalMinutes, byKind: german.byKind, streak: german.streak, unitsPassed: german.unitsPassed }, projects: projects.map((p) => ({ name: p.name, status: p.status, progress: p.computedProgress, open: p.openTasks, deadline: p.deadline })), goals: goals.map((g) => ({ name: g.name, progress: g.progress, deadline: g.deadline })), trading: { paper: { trades: tradingPaper.trades, pnl: tradingPaper.totalPnl, winRate: tradingPaper.winRate }, real: { trades: tradingReal.trades, pnl: tradingReal.totalPnl, winRate: tradingReal.winRate } }, upcoming: { exams: exams.slice(0, 5), assignments: assignments.slice(0, 5), events: upcoming.slice(0, 15).map((e) => ({ title: e.title, at: e.startAt })) } };
  const content = await complete({ system: BASE, prompt: `Write the WEEKLY REVIEW for ${from} → ${to}. Sections: Major accomplishments; Missed tasks; Finance; Training; Studies; German; Projects; Goals; Trading (keep paper and real separate); Upcoming (next 7 days). End with "Trends & risks" (patterns you can actually see in the data) and "Suggested focus for next week" (max 4 items).\n\nDATA:\n${JSON.stringify(data)}`, maxTokens: 2500 });
  return saveReport(user.id, "weekly_review", isoWeekKey(new Date(to)), content, data);
}

/** Daily Market Brief (spec §15): only real news/quotes; interpretation is labelled as AI. */
export async function marketBrief(user: SessionUser) {
  const tz = user.timezone;
  const day = todayKey(tz);
  await refreshNews().catch(() => 0);
  const [news, watchlists, events, openTrades] = await Promise.all([listNews({ sinceHours: 36, limit: 60 }), listWatchlists(user.id), listEconomicEvents(user.id, { from: new Date(), to: new Date(Date.now() + 3 * 86400e3) }), listTrades(user.id, { status: "open", limit: 30 })]);
  const symbols = [...new Set([...watchlists.flatMap((w) => w.items.map((i) => ({ symbol: i.symbol, assetClass: i.assetClass as AssetClass }))), ...openTrades.map((t) => ({ symbol: t.symbol, assetClass: t.assetClass as AssetClass }))].map((s) => JSON.stringify(s)))].map((s) => JSON.parse(s) as { symbol: string; assetClass: AssetClass }).slice(0, 20);
  const quotes = symbols.length ? await getQuotes(symbols).catch(() => ({ quotes: [], missing: symbols.map((s) => s.symbol) })) : { quotes: [], missing: [] };
  const wlNews = symbols.length ? await listNews({ symbols: symbols.map((s) => s.symbol), sinceHours: 72, limit: 20 }) : [];
  const data = { date: day, news: news.map((n) => ({ headline: n.headline, source: n.source, at: n.publishedAt, category: n.category, url: n.url })), watchlist: symbols.map((s) => s.symbol), quotes: quotes.quotes.map((q) => ({ symbol: q.symbol, price: q.price, changePct: q.changePct, provider: q.provider, freshness: q.freshness, asOf: q.asOf })), missingQuotes: quotes.missing, watchlistNews: wlNews.map((n) => ({ headline: n.headline, source: n.source, at: n.publishedAt })), economicEvents: events.map((e) => ({ title: e.title, at: e.at, importance: e.importance })), openPositions: openTrades.map((t) => ({ symbol: t.symbol, mode: t.mode, direction: t.direction })) };
  const content = await complete({
    system: BASE + " This is a DAILY MARKET BRIEF. Rules: use ONLY the headlines and quotes provided (cite source and time for each claim). Clearly separate 'What happened (verified headlines)', 'Why it matters (AI interpretation)' and 'What to watch'. Cover: global overview, US, Europe, macro, central banks, earnings, commodities, crypto, the user's watchlist and today's events — say 'no data' for a section without items. Never give BUY/SELL recommendations, never guarantee returns, never invent prices or news.",
    prompt: `DATA:\n${JSON.stringify(data)}`,
    maxTokens: 2500,
  });
  return saveReport(user.id, "market_brief", day, content, data);
}

/**
 * Personal Planner (spec §45, phase 3.2b): reasons over calendar/tasks/goals/projects/training/studies
 * and saves the result as a DRAFT with `propose_plan`. It cannot create anything real — planner mode is
 * restricted to read tools plus propose_plan — so applying a plan stays an explicit action of the user.
 */
const PLANNER_TOOLS = ["get_snapshot", "get_plan", "propose_plan", "get_calendar", "get_tasks", "get_goals", "get_projects", "get_today_workout", "get_training_plan", "get_study_schedule", "get_german_progress", "get_financial_summary"];
export async function plan(user: SessionUser, opts: { horizon: "today" | "week"; instructions?: string; conversationId?: string | null }) {
  const horizon = opts.horizon === "week" ? "week" : "day";
  const extra = `PLANNER MODE (${opts.horizon}). First gather the real data: get_snapshot, get_calendar (includeFreeSlots=true), get_tasks (today + upcoming + overdue), get_goals, get_projects, get_today_workout, get_study_schedule and get_german_progress. Then produce a prioritised plan based on deadlines, importance and free time — never invent arbitrary tasks, never schedule training on a rest day of the cycle. Finally SAVE it by calling propose_plan with horizon "${horizon}" and one item per block. You cannot create tasks or events here and you must not claim the plan was applied: it is a draft waiting for the user to accept it in the Planner.`;
  return chat(user, { conversationId: opts.conversationId ?? null, kind: "planner", text: opts.instructions?.trim() ? opts.instructions : opts.horizon === "today" ? "What should I do today? Build my plan." : "Organize my week.", systemExtra: extra, maxRounds: 12, allowedTools: PLANNER_TOOLS });
}

/** Quick entry (spec §30): one sentence → the right record(s). */
export async function quickEntry(user: SessionUser, text: string) {
  return chat(user, { kind: "quick_entry", text, systemExtra: "QUICK ENTRY MODE: the user typed a single quick note. Decide which record(s) to create (expense, income, task, event, workout set, study session, meal, journal entry, goal progress...) and create them immediately with tools. Reply in one or two short lines confirming exactly what was saved (or that it failed / needs confirmation).", maxRounds: 4 });
}

/** Explain a news item (AI interpretation, stored separately from the verified headline). */
export async function explainNews(item: { headline: string; source: string; summary?: string | null; publishedAt: Date }) {
  const text = await complete({ system: "You explain a single financial news headline to a learning trader. Return JSON only: {\"summary\": \"1-2 sentence neutral summary\", \"whyItMatters\": \"2-3 sentences on relevance to markets/assets, labelled as interpretation\"}. Do not invent facts beyond the headline/description.", prompt: JSON.stringify(item), maxTokens: 400 });
  try { const j = JSON.parse(text.replace(/```json|```/g, "").trim()); return { aiSummary: String(j.summary ?? ""), aiWhyItMatters: String(j.whyItMatters ?? "") }; } catch { return { aiSummary: text.slice(0, 500), aiWhyItMatters: "" }; }
}
