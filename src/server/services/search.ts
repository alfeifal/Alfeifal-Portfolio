import { and, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/server/db";
import {
  academyLessons, accounts, aiMemory, assignments, budgets, categories, conversations, events, exams,
  exercises, foods, goals, investmentAccounts, investmentAssets, investmentTransactions, journalEntries,
  marketNews, meals, messages, milestones, notifications, nutritionEntries, planItems, priceAlerts,
  projects, recurringTransactions, reviews, savingsGoals, strategies, studySessions, subjects, tasks, trades,
  tradingAccounts, trainingDays, trainingPlans, transactions, watchlistItems, workoutSessions,
} from "@/server/db/schema";
import { UNITS, CONCEPTS, VOCAB } from "@/modules/german/content";

/**
 * Global search (spec §32).
 *
 * ## Why ILIKE and not Postgres full-text search
 *
 * FTS matches whole lexemes, so "entrec" would not find "entrecot" and "Velso" would not find
 * "Velsoma" — and partial matching is the main thing a personal search has to do. It would also need a
 * tsvector column, a GIN index and a migration on ~30 tables. This is one person's data (hundreds to a
 * few thousand rows per table), so a bounded ILIKE scan per entity is both faster to ship and better
 * behaved for the queries the user actually types. No external engine is involved for the same reason:
 * nothing here is large enough to justify one.
 *
 * ## Shape of the work
 *
 * One small query per entity, all issued in parallel, each with its own LIMIT and each filtered by
 * `userId` in SQL. Nothing is "fetch the table and filter in JS": the database never returns more than
 * `perEntity` rows per entity, and only the columns the result needs. Ranking happens in JS over those
 * few hundred rows, which is where it belongs — it depends on where the match landed, not on the row.
 */

/** Hard caps. A query longer than this is rejected by the API rather than silently truncated. */
export const MAX_QUERY_LENGTH = 100;
export const MAX_TERMS = 6;
export const DEFAULT_LIMIT = 40;
export const MAX_LIMIT = 100;
export const DEFAULT_PER_ENTITY = 6;

export interface SearchHit {
  /** Entity kind, e.g. "task", "transaction", "memory". Drives the icon and the label. */
  type: string;
  /** Tool-registry module, e.g. "tasks", "finance", "ai". Groups results in the UI. */
  module: string;
  /** Internal reference. Used to navigate and, for the assistant, to call the module's own tools. */
  id: string;
  title: string;
  snippet?: string | null;
  date?: string | null;
  href: string;
  /** Only for AI memory: its semantic key, which is how the assistant addresses it. */
  key?: string | null;
  score: number;
}

export interface SearchResult {
  query: string;
  terms: string[];
  hits: SearchHit[];
  /** True when a per-entity or global cap cut the list short. */
  truncated: boolean;
  total: number;
}

const ACCENTED = "áàäâãÁÀÄÂÃéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ";
const PLAIN____ = "aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUnNcC";

/** Strips accents the same way the SQL side does, so both ends agree on what "café" matches. */
export function fold(s: string) {
  let out = "";
  for (const ch of s) {
    const i = ACCENTED.indexOf(ch);
    out += i >= 0 ? PLAIN____[i] : ch;
  }
  return out.toLowerCase();
}

/**
 * Splits the query into terms. Every term must match (AND), which is what makes "entrenamiento pecho"
 * narrow the results instead of widening them.
 */
export function parseTerms(q: string): string[] {
  return [...new Set(fold(q).split(/[\s,;]+/).map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, MAX_TERMS);
}

type Col = PgColumn;

/**
 * `translate(lower(col), accented, plain) like '%term%'` — accent- and case-insensitive substring
 * matching with no extension to install and nothing to migrate, which matters because production is
 * Neon. A `%` scan cannot use a btree index anyway, so no index is being given up here.
 */
function matchAll(terms: string[], cols: Col[]): SQL {
  const haystack = sql.join(cols.map((c) => sql`coalesce(${c}::text, '')`), sql` || ' ' || `);
  const folded = sql`translate(lower(${haystack}), ${ACCENTED}, ${PLAIN____})`;
  return and(...terms.map((t) => sql`${folded} like ${"%" + likeEscape(t) + "%"} escape '\\'`))!;
}

/**
 * `%` and `_` are LIKE wildcards. They are perfectly ordinary characters in a search box — "100%",
 * "snake_case" — so they are escaped and matched literally. (Values are bound parameters either way,
 * so this is about getting the right answer, not about injection.)
 */
export function likeEscape(term: string) {
  return term.replace(/[\\%_]/g, (c) => "\\" + c);
}

/** Scores a hit: where the terms landed matters far more than which table the row came from. */
function score(terms: string[], title: string, body?: string | null) {
  const t = fold(title);
  const b = fold(body ?? "");
  let s = 0;
  for (const term of terms) {
    if (t === term) s += 100;
    else if (t.startsWith(term)) s += 60;
    else if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)) s += 45;
    else if (t.includes(term)) s += 30;
    else if (b.includes(term)) s += 10;
  }
  // All terms in the title beats a match spread across the body.
  if (terms.every((term) => t.includes(term))) s += 25;
  return s;
}

/** Trims a body field to a readable line around the first match. */
function snippet(text: string | null | undefined, terms: string[], len = 120): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= len) return clean;
  const folded = fold(clean);
  const at = terms.map((t) => folded.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 30);
  return (start > 0 ? "…" : "") + clean.slice(start, start + len).trim() + (start + len < clean.length ? "…" : "");
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const money = (amount: unknown, currency = "EUR") => `${Number(amount)} ${currency}`;

interface Ctx { terms: string[]; per: number; userId: string }

/**
 * One searcher per entity. Each is responsible for its own SELECT list (never `select *`), its own
 * LIMIT, and for producing a navigable href. Adding an entity means adding one entry here.
 */
const SEARCHERS: ((c: Ctx) => Promise<SearchHit[]>)[] = [
  // ---------------------------------------------------------------- planning
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status, dueDate: tasks.dueDate, category: tasks.category })
      .from(tasks).where(and(eq(tasks.userId, userId), matchAll(terms, [tasks.title, tasks.description, tasks.category])))
      .orderBy(desc(tasks.createdAt)).limit(per);
    return rows.map((r) => ({ type: "task", module: "tasks", id: r.id, title: r.title, snippet: snippet(r.description, terms) ?? r.status, date: r.dueDate, href: `/tasks?focus=${r.id}`, score: score(terms, r.title, r.description) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: events.id, title: events.title, description: events.description, location: events.location, kind: events.kind, startAt: events.startAt })
      .from(events).where(and(eq(events.userId, userId), matchAll(terms, [events.title, events.description, events.location])))
      .orderBy(desc(events.startAt)).limit(per);
    return rows.map((r) => ({ type: "event", module: "calendar", id: r.id, title: r.title, snippet: snippet(r.description ?? r.location, terms) ?? r.kind, date: iso(r.startAt), href: `/calendar?date=${iso(r.startAt)}`, score: score(terms, r.title, `${r.description ?? ""} ${r.location ?? ""}`) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: journalEntries.id, title: journalEntries.title, content: journalEntries.content, kind: journalEntries.kind, date: journalEntries.date })
      .from(journalEntries).where(and(eq(journalEntries.userId, userId), matchAll(terms, [journalEntries.title, journalEntries.content])))
      .orderBy(desc(journalEntries.date)).limit(per);
    return rows.map((r) => ({ type: "journal", module: "journal", id: r.id, title: r.title ?? r.content.slice(0, 60), snippet: snippet(r.content, terms), date: r.date, href: `/journal?focus=${r.id}`, score: score(terms, r.title ?? "", r.content) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: goals.id, name: goals.name, description: goals.description, status: goals.status, progress: goals.progress, category: goals.category })
      .from(goals).where(and(eq(goals.userId, userId), matchAll(terms, [goals.name, goals.description, goals.category])))
      .limit(per);
    return rows.map((r) => ({ type: "goal", module: "goals", id: r.id, title: r.name, snippet: snippet(r.description, terms) ?? `${r.progress}% · ${r.status}`, date: null, href: `/goals/${r.id}`, score: score(terms, r.name, r.description) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: projects.id, name: projects.name, description: projects.description, notes: projects.notes, status: projects.status })
      .from(projects).where(and(eq(projects.userId, userId), matchAll(terms, [projects.name, projects.description, projects.notes, projects.kind])))
      .limit(per);
    return rows.map((r) => ({ type: "project", module: "projects", id: r.id, title: r.name, snippet: snippet(r.description ?? r.notes, terms) ?? r.status, date: null, href: `/projects/${r.id}`, score: score(terms, r.name, `${r.description ?? ""} ${r.notes ?? ""}`) }));
  },
  /** Milestones belong to a goal or a project; the href follows whichever owns it. */
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: milestones.id, title: milestones.title, dueDate: milestones.dueDate, completedAt: milestones.completedAt, goalId: milestones.goalId, projectId: milestones.projectId })
      .from(milestones).where(and(eq(milestones.userId, userId), matchAll(terms, [milestones.title])))
      .limit(per);
    return rows.map((r) => ({ type: "milestone", module: r.projectId ? "projects" : "goals", id: r.id, title: r.title, snippet: r.completedAt ? "completed" : "pending", date: r.dueDate, href: r.projectId ? `/projects/${r.projectId}` : r.goalId ? `/goals/${r.goalId}` : "/goals", score: score(terms, r.title) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: planItems.id, title: planItems.title, notes: planItems.notes, date: planItems.date, status: planItems.status, kind: planItems.kind })
      .from(planItems).where(and(eq(planItems.userId, userId), matchAll(terms, [planItems.title, planItems.notes])))
      .orderBy(desc(planItems.date)).limit(per);
    return rows.map((r) => ({ type: "plan_item", module: "planner", id: r.id, title: r.title, snippet: snippet(r.notes, terms) ?? `${r.kind} · ${r.status}`, date: r.date, href: "/planner", score: score(terms, r.title, r.notes) }));
  },

  // ---------------------------------------------------------------- finance
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: transactions.id, description: transactions.description, merchant: transactions.merchant, notes: transactions.notes, amount: transactions.amount, currency: transactions.currency, type: transactions.type, date: transactions.date })
      .from(transactions).where(and(eq(transactions.userId, userId), matchAll(terms, [transactions.description, transactions.merchant, transactions.notes, transactions.tags])))
      .orderBy(desc(transactions.date)).limit(per);
    return rows.map((r) => ({ type: "transaction", module: "finance", id: r.id, title: r.description || r.merchant || r.type, snippet: `${r.type} · ${money(r.amount, r.currency)}${r.merchant ? " · " + r.merchant : ""}`, date: r.date, href: `/finance?focus=${r.id}&month=${r.date.slice(0, 7)}`, score: score(terms, r.description || r.merchant || "", r.notes) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: accounts.id, name: accounts.name, type: accounts.type, institution: accounts.institution, currency: accounts.currency })
      .from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.archived, false), matchAll(terms, [accounts.name, accounts.institution, accounts.type])))
      .limit(per);
    return rows.map((r) => ({ type: "account", module: "finance", id: r.id, title: r.name, snippet: `${r.type}${r.institution ? " · " + r.institution : ""} · ${r.currency}`, date: null, href: "/finance?tab=accounts", score: score(terms, r.name, r.institution) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: categories.id, name: categories.name, kind: categories.kind })
      .from(categories).where(and(eq(categories.userId, userId), eq(categories.archived, false), matchAll(terms, [categories.name])))
      .limit(per);
    return rows.map((r) => ({ type: "category", module: "finance", id: r.id, title: r.name, snippet: `${r.kind} category`, date: null, href: "/finance?tab=transactions", score: score(terms, r.name) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: recurringTransactions.id, description: recurringTransactions.description, amount: recurringTransactions.amount, type: recurringTransactions.type, frequency: recurringTransactions.frequency, nextDate: recurringTransactions.nextDate })
      .from(recurringTransactions).where(and(eq(recurringTransactions.userId, userId), matchAll(terms, [recurringTransactions.description, recurringTransactions.frequency])))
      .limit(per);
    return rows.map((r) => ({ type: "recurring", module: "finance", id: r.id, title: r.description, snippet: `${r.type} · ${r.frequency} · ${Number(r.amount)}`, date: r.nextDate, href: "/finance?tab=recurring", score: score(terms, r.description) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: savingsGoals.id, name: savingsGoals.name, targetAmount: savingsGoals.targetAmount, currentAmount: savingsGoals.currentAmount, deadline: savingsGoals.deadline })
      .from(savingsGoals).where(and(eq(savingsGoals.userId, userId), matchAll(terms, [savingsGoals.name])))
      .limit(per);
    return rows.map((r) => ({ type: "savings_goal", module: "finance", id: r.id, title: r.name, snippet: `${Number(r.currentAmount)} of ${Number(r.targetAmount)}`, date: r.deadline, href: "/finance?tab=savings", score: score(terms, r.name) }));
  },
  /** A budget has no text of its own; it is found through the category it caps. */
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: budgets.id, amount: budgets.amount, period: budgets.period, categoryName: categories.name })
      .from(budgets).leftJoin(categories, eq(categories.id, budgets.categoryId))
      .where(and(eq(budgets.userId, userId), matchAll(terms, [categories.name, budgets.period])))
      .limit(per);
    return rows.map((r) => ({ type: "budget", module: "finance", id: r.id, title: `Budget · ${r.categoryName ?? "all categories"}`, snippet: `${Number(r.amount)} per ${r.period}`, date: null, href: "/finance?tab=budgets", score: score(terms, r.categoryName ?? "") }));
  },

  // ---------------------------------------------------------------- nutrition
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: foods.id, name: foods.name, brand: foods.brand, calories: foods.calories, protein: foods.protein })
      .from(foods).where(and(eq(foods.userId, userId), matchAll(terms, [foods.name, foods.brand])))
      .limit(per);
    return rows.map((r) => ({ type: "food", module: "nutrition", id: r.id, title: r.name, snippet: `${r.brand ? r.brand + " · " : ""}${Number(r.calories)} kcal · ${Number(r.protein)} g protein`, date: null, href: "/nutrition?tab=foods", score: score(terms, r.name, r.brand) }));
  },
  /** Entries carry the description the user actually typed ("entrecot"), so they are the useful hit. */
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: nutritionEntries.id, description: nutritionEntries.description, calories: nutritionEntries.calories, quantity: nutritionEntries.quantity, unit: nutritionEntries.unit, date: meals.date, mealType: meals.type })
      .from(nutritionEntries).innerJoin(meals, eq(meals.id, nutritionEntries.mealId))
      .where(and(eq(nutritionEntries.userId, userId), matchAll(terms, [nutritionEntries.description])))
      .orderBy(desc(meals.date)).limit(per);
    return rows.map((r) => ({ type: "nutrition_entry", module: "nutrition", id: r.id, title: r.description, snippet: `${r.mealType} · ${Number(r.quantity)} ${r.unit} · ${Number(r.calories)} kcal`, date: r.date, href: `/nutrition?date=${r.date}`, score: score(terms, r.description) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: meals.id, name: meals.name, notes: meals.notes, type: meals.type, date: meals.date })
      .from(meals).where(and(eq(meals.userId, userId), matchAll(terms, [meals.name, meals.notes, meals.type])))
      .orderBy(desc(meals.date)).limit(per);
    return rows.map((r) => ({ type: "meal", module: "nutrition", id: r.id, title: r.name ?? r.type, snippet: snippet(r.notes, terms) ?? r.type, date: r.date, href: `/nutrition?date=${r.date}`, score: score(terms, r.name ?? r.type, r.notes) }));
  },

  // ---------------------------------------------------------------- training
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: workoutSessions.id, dayName: workoutSessions.dayName, notes: workoutSessions.notes, date: workoutSessions.date })
      .from(workoutSessions).where(and(eq(workoutSessions.userId, userId), matchAll(terms, [workoutSessions.dayName, workoutSessions.notes])))
      .orderBy(desc(workoutSessions.date)).limit(per);
    return rows.map((r) => ({ type: "workout", module: "training", id: r.id, title: r.dayName ?? "Workout", snippet: snippet(r.notes, terms), date: r.date, href: `/training/sessions/${r.id}`, score: score(terms, r.dayName ?? "", r.notes) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: exercises.id, name: exercises.name, target: exercises.anatomicalTarget, muscleGroup: exercises.muscleGroup, equipment: exercises.equipment })
      .from(exercises).where(and(eq(exercises.userId, userId), matchAll(terms, [exercises.name, exercises.anatomicalTarget, exercises.muscleGroup, exercises.equipment, exercises.notes])))
      .limit(per);
    return rows.map((r) => ({ type: "exercise", module: "training", id: r.id, title: r.name, snippet: [r.muscleGroup, r.target, r.equipment].filter(Boolean).join(" · ") || null, date: null, href: `/training/exercises/${r.id}`, score: score(terms, r.name, `${r.target ?? ""} ${r.muscleGroup ?? ""}`) }));
  },
  /** A routine day ("Push", "Pull") is how the user thinks about "entrenamiento de pecho". */
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: trainingDays.id, name: trainingDays.name, notes: trainingDays.notes, dayIndex: trainingDays.dayIndex, isRest: trainingDays.isRest, planName: trainingPlans.name })
      .from(trainingDays).innerJoin(trainingPlans, eq(trainingPlans.id, trainingDays.planId))
      .where(and(eq(trainingDays.userId, userId), matchAll(terms, [trainingDays.name, trainingDays.notes])))
      .limit(per);
    return rows.map((r) => ({ type: "training_day", module: "training", id: r.id, title: r.name, snippet: `${r.planName} · day ${r.dayIndex + 1}${r.isRest ? " · rest" : ""}`, date: null, href: "/training/routine", score: score(terms, r.name, r.notes) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: trainingPlans.id, name: trainingPlans.name, description: trainingPlans.description, active: trainingPlans.active, startDate: trainingPlans.startDate })
      .from(trainingPlans).where(and(eq(trainingPlans.userId, userId), matchAll(terms, [trainingPlans.name, trainingPlans.description])))
      .limit(per);
    return rows.map((r) => ({ type: "training_plan", module: "training", id: r.id, title: r.name, snippet: snippet(r.description, terms) ?? (r.active ? "active plan" : "inactive"), date: r.startDate, href: "/training/routine", score: score(terms, r.name, r.description) }));
  },

  // ---------------------------------------------------------------- studies
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: subjects.id, name: subjects.name, description: subjects.description, kind: subjects.kind })
      .from(subjects).where(and(eq(subjects.userId, userId), eq(subjects.archived, false), matchAll(terms, [subjects.name, subjects.description, subjects.kind])))
      .limit(per);
    return rows.map((r) => ({ type: "subject", module: "studies", id: r.id, title: r.name, snippet: snippet(r.description, terms) ?? r.kind, date: null, href: "/studies?tab=subjects", score: score(terms, r.name, r.description) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: studySessions.id, topic: studySessions.topic, notes: studySessions.notes, minutes: studySessions.durationMinutes, date: studySessions.date, subject: subjects.name })
      .from(studySessions).leftJoin(subjects, eq(subjects.id, studySessions.subjectId))
      .where(and(eq(studySessions.userId, userId), matchAll(terms, [studySessions.topic, studySessions.notes, subjects.name])))
      .orderBy(desc(studySessions.date)).limit(per);
    return rows.map((r) => ({ type: "study_session", module: "studies", id: r.id, title: r.topic ?? `${r.subject ?? "Study"} session`, snippet: `${r.subject ? r.subject + " · " : ""}${r.minutes} min`, date: r.date, href: "/studies?tab=sessions", score: score(terms, r.topic ?? r.subject ?? "", r.notes) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: assignments.id, title: assignments.title, description: assignments.description, dueDate: assignments.dueDate, completedAt: assignments.completedAt, subject: subjects.name })
      .from(assignments).leftJoin(subjects, eq(subjects.id, assignments.subjectId))
      .where(and(eq(assignments.userId, userId), matchAll(terms, [assignments.title, assignments.description, subjects.name])))
      .limit(per);
    return rows.map((r) => ({ type: "assignment", module: "studies", id: r.id, title: r.title, snippet: `${r.subject ?? "—"}${r.completedAt ? " · done" : ""}`, date: r.dueDate, href: "/studies?tab=deadlines", score: score(terms, r.title, r.description) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: exams.id, title: exams.title, notes: exams.notes, location: exams.location, date: exams.date, result: exams.result, subject: subjects.name })
      .from(exams).leftJoin(subjects, eq(subjects.id, exams.subjectId))
      .where(and(eq(exams.userId, userId), matchAll(terms, [exams.title, exams.notes, exams.location, subjects.name])))
      .limit(per);
    return rows.map((r) => ({ type: "exam", module: "studies", id: r.id, title: r.title, snippet: [r.subject, r.location, r.result].filter(Boolean).join(" · ") || null, date: r.date, href: "/studies?tab=deadlines", score: score(terms, r.title, `${r.notes ?? ""} ${r.subject ?? ""}`) }));
  },

  // ---------------------------------------------------------------- investing (kept apart from finance)
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: investmentAccounts.id, name: investmentAccounts.name, broker: investmentAccounts.broker, currency: investmentAccounts.currency })
      .from(investmentAccounts).where(and(eq(investmentAccounts.userId, userId), matchAll(terms, [investmentAccounts.name, investmentAccounts.broker])))
      .limit(per);
    return rows.map((r) => ({ type: "investment_account", module: "investing", id: r.id, title: r.name, snippet: [r.broker, r.currency].filter(Boolean).join(" · ") || null, date: null, href: "/investing", score: score(terms, r.name, r.broker) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: investmentAssets.id, symbol: investmentAssets.symbol, name: investmentAssets.name, assetClass: investmentAssets.assetClass })
      .from(investmentAssets).where(and(eq(investmentAssets.userId, userId), matchAll(terms, [investmentAssets.symbol, investmentAssets.name])))
      .limit(per);
    return rows.map((r) => ({ type: "asset", module: "investing", id: r.id, title: `${r.symbol}${r.name ? " · " + r.name : ""}`, snippet: r.assetClass, date: null, href: "/investing?tab=assets", score: score(terms, `${r.symbol} ${r.name ?? ""}`) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: investmentTransactions.id, notes: investmentTransactions.notes, type: investmentTransactions.type, date: investmentTransactions.date, amount: investmentTransactions.amount, symbol: investmentAssets.symbol })
      .from(investmentTransactions).leftJoin(investmentAssets, eq(investmentAssets.id, investmentTransactions.assetId))
      .where(and(eq(investmentTransactions.userId, userId), matchAll(terms, [investmentTransactions.notes, investmentAssets.symbol, investmentTransactions.type])))
      .orderBy(desc(investmentTransactions.date)).limit(per);
    return rows.map((r) => ({ type: "investment_transaction", module: "investing", id: r.id, title: `${r.type}${r.symbol ? " " + r.symbol : ""}`, snippet: snippet(r.notes, terms) ?? money(r.amount), date: r.date, href: "/investing?tab=transactions", score: score(terms, `${r.type} ${r.symbol ?? ""}`, r.notes) }));
  },

  // ---------------------------------------------------------------- trading (REAL and PAPER stay labelled)
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: trades.id, symbol: trades.symbol, setup: trades.setup, notes: trades.notes, entryReason: trades.entryReason, direction: trades.direction, mode: trades.mode, status: trades.status, openedAt: trades.openedAt })
      .from(trades).where(and(eq(trades.userId, userId), matchAll(terms, [trades.symbol, trades.setup, trades.notes, trades.entryReason, trades.exitReason, trades.tags])))
      .orderBy(desc(trades.createdAt)).limit(per);
    return rows.map((r) => ({ type: "trade", module: "trading", id: r.id, title: `${r.symbol} ${r.direction}`, snippet: `${r.mode.toUpperCase()} · ${r.status}${r.setup ? " · " + r.setup : ""}`, date: iso(r.openedAt), href: `/trading/journal/${r.id}`, score: score(terms, r.symbol, `${r.setup ?? ""} ${r.notes ?? ""}`) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: strategies.id, name: strategies.name, description: strategies.description, timeframes: strategies.timeframes })
      .from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.archived, false), matchAll(terms, [strategies.name, strategies.description, strategies.rules, strategies.timeframes])))
      .limit(per);
    return rows.map((r) => ({ type: "strategy", module: "trading", id: r.id, title: r.name, snippet: snippet(r.description, terms) ?? r.timeframes, date: null, href: "/trading?tab=analytics", score: score(terms, r.name, r.description) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: tradingAccounts.id, name: tradingAccounts.name, mode: tradingAccounts.mode, broker: tradingAccounts.broker })
      .from(tradingAccounts).where(and(eq(tradingAccounts.userId, userId), matchAll(terms, [tradingAccounts.name, tradingAccounts.broker, tradingAccounts.mode])))
      .limit(per);
    return rows.map((r) => ({ type: "trading_account", module: "trading", id: r.id, title: r.name, snippet: `${r.mode.toUpperCase()}${r.broker ? " · " + r.broker : ""}`, date: null, href: "/trading", score: score(terms, r.name, r.broker) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: watchlistItems.id, symbol: watchlistItems.symbol, name: watchlistItems.name, notes: watchlistItems.notes, assetClass: watchlistItems.assetClass })
      .from(watchlistItems).where(and(eq(watchlistItems.userId, userId), matchAll(terms, [watchlistItems.symbol, watchlistItems.name, watchlistItems.notes])))
      .limit(per);
    return rows.map((r) => ({ type: "watchlist_item", module: "trading", id: r.id, title: r.symbol, snippet: snippet(r.notes, terms) ?? ([r.name, r.assetClass].filter(Boolean).join(" · ") || null), date: null, href: "/trading?tab=watchlist", score: score(terms, r.symbol, `${r.name ?? ""} ${r.notes ?? ""}`) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: priceAlerts.id, symbol: priceAlerts.symbol, condition: priceAlerts.condition, price: priceAlerts.price, note: priceAlerts.note, active: priceAlerts.active })
      .from(priceAlerts).where(and(eq(priceAlerts.userId, userId), matchAll(terms, [priceAlerts.symbol, priceAlerts.note])))
      .limit(per);
    return rows.map((r) => ({ type: "price_alert", module: "trading", id: r.id, title: `${r.symbol} ${r.condition} ${Number(r.price)}`, snippet: snippet(r.note, terms) ?? (r.active ? "active" : "triggered"), date: null, href: "/trading?tab=watchlist", score: score(terms, r.symbol, r.note) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: academyLessons.id, title: academyLessons.title, topic: academyLessons.topic, content: academyLessons.content })
      .from(academyLessons).where(and(eq(academyLessons.userId, userId), matchAll(terms, [academyLessons.title, academyLessons.topic, academyLessons.content])))
      .limit(per);
    return rows.map((r) => ({ type: "lesson", module: "academy", id: r.id, title: r.title, snippet: snippet(r.content, terms) ?? r.topic, date: null, href: `/trading/academy?lesson=${r.id}`, score: score(terms, r.title, `${r.topic} ${r.content}`) }));
  },

  // ---------------------------------------------------------------- AI
  /**
   * Memory carries both handles: `id` (UUID) and `key` (the slug the assistant addresses it by). This
   * is what lets the model go search → get_memory/update_memory without ever guessing a UUID.
   */
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: aiMemory.id, key: aiMemory.key, kind: aiMemory.kind, content: aiMemory.content, importance: aiMemory.importance })
      .from(aiMemory)
      .where(and(eq(aiMemory.userId, userId), sql`(${aiMemory.expiresAt} is null or ${aiMemory.expiresAt} > now())`, matchAll(terms, [aiMemory.content, aiMemory.key, aiMemory.kind])))
      .orderBy(desc(aiMemory.importance)).limit(per);
    return rows.map((r) => ({ type: "memory", module: "ai", id: r.id, key: r.key, title: r.key ?? r.kind, snippet: snippet(r.content, terms), date: null, href: "/settings?tab=memory", score: score(terms, r.key ?? r.kind, r.content) }));
  },
  /**
   * Conversations, only while they are inside their 24 h window — an expired transcript is gone from
   * the product and must not come back through search. Only the title and one matching line travel;
   * the transcript itself is never bulk-returned.
   */
  async ({ terms, per, userId }) => {
    const convs = await db.select({ id: conversations.id, title: conversations.title, kind: conversations.kind, updatedAt: conversations.updatedAt })
      .from(conversations)
      .where(and(eq(conversations.userId, userId), gt(conversations.expiresAt, new Date()), matchAll(terms, [conversations.title])))
      .orderBy(desc(conversations.updatedAt)).limit(per);
    return convs.map((r) => ({ type: "conversation", module: "ai", id: r.id, title: r.title || "Conversation", snippet: r.kind, date: iso(r.updatedAt), href: `/assistant?conversation=${r.id}`, score: score(terms, r.title || "") }));
  },
  /** Messages are searched inside living conversations only, and return a snippet, never the thread. */
  async ({ terms, per, userId }) => {
    const live = await db.select({ id: conversations.id, title: conversations.title })
      .from(conversations).where(and(eq(conversations.userId, userId), gt(conversations.expiresAt, new Date()))).limit(100);
    if (!live.length) return [];
    const byId = new Map(live.map((c) => [c.id, c.title]));
    const rows = await db.select({ id: messages.id, conversationId: messages.conversationId, text: messages.text, role: messages.role, createdAt: messages.createdAt })
      .from(messages)
      .where(and(inArray(messages.conversationId, [...byId.keys()]), sql`${messages.text} <> ''`, matchAll(terms, [messages.text])))
      .orderBy(desc(messages.createdAt)).limit(per);
    return rows.map((r) => ({ type: "message", module: "ai", id: r.conversationId, title: byId.get(r.conversationId) || "Conversation", snippet: snippet(r.text, terms), date: iso(r.createdAt), href: `/assistant?conversation=${r.conversationId}`, score: score(terms, byId.get(r.conversationId) ?? "", r.text) }));
  },
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: notifications.id, title: notifications.title, body: notifications.body, href: notifications.href, kind: notifications.kind, createdAt: notifications.createdAt })
      .from(notifications).where(and(eq(notifications.userId, userId), matchAll(terms, [notifications.title, notifications.body])))
      .orderBy(desc(notifications.createdAt)).limit(per);
    return rows.map((r) => ({ type: "notification", module: "notifications", id: r.id, title: r.title, snippet: snippet(r.body, terms) ?? r.kind, date: iso(r.createdAt), href: r.href ?? "/notifications", score: score(terms, r.title, r.body) }));
  },

  /**
   * Reviews. The searchable content is the user's own notes and the derived observations — the facts
   * are numbers, which nobody searches by text. AI insights are searched too, but the snippet says so
   * only through the hit landing in a review, which is always labelled in the UI.
   */
  async ({ terms, per, userId }) => {
    const rows = await db.select({ id: reviews.id, type: reviews.type, periodStart: reviews.periodStart, periodEnd: reviews.periodEnd, userNotes: reviews.userNotes, observations: reviews.observations, status: reviews.status })
      .from(reviews)
      .where(and(eq(reviews.userId, userId), matchAll(terms, [reviews.userNotes, reviews.observations, reviews.aiInsights, reviews.type])))
      .orderBy(desc(reviews.periodEnd)).limit(per);
    return rows.map((r) => {
      const label = r.type === "monthly" ? r.periodStart.slice(0, 7) : `${r.periodStart} → ${r.periodEnd}`;
      const obs = Array.isArray(r.observations) ? (r.observations as { text?: string }[]).map((o) => o.text ?? "").join(" · ") : "";
      return { type: "review", module: "reviews", id: r.id, title: `${r.type === "monthly" ? "Monthly" : "Weekly"} review · ${label}`, snippet: snippet(r.userNotes ?? obs, terms), date: r.periodEnd, href: `/reviews?review=${r.id}`, score: score(terms, label, `${r.userNotes ?? ""} ${obs}`) };
    });
  },

  // ---------------------------------------------------------------- market news (shared, not user data)
  async ({ terms, per }) => {
    const rows = await db.select({ id: marketNews.id, headline: marketNews.headline, source: marketNews.source, url: marketNews.url, summary: marketNews.summary, publishedAt: marketNews.publishedAt })
      .from(marketNews).where(matchAll(terms, [marketNews.headline, marketNews.summary]))
      .orderBy(desc(marketNews.publishedAt)).limit(Math.min(per, 4));
    return rows.map((r) => ({ type: "news", module: "market", id: r.id, title: r.headline, snippet: snippet(r.summary, terms) ?? r.source, date: iso(r.publishedAt), href: r.url, score: score(terms, r.headline, r.summary) }));
  },
];

/** German course content lives in code, not in the database, so it is matched in memory — it is a fixed, small corpus. */
function germanHits(terms: string[], per: number): SearchHit[] {
  const hit = (text: string) => terms.every((t) => fold(text).includes(t));
  const out: SearchHit[] = [];
  for (const u of UNITS) {
    if (out.length >= per) break;
    if (hit(`${u.title} ${u.titleDe ?? ""}`)) out.push({ type: "german_unit", module: "german", id: u.id, title: `U${u.number} ${u.title}`, snippet: u.cefr, date: null, href: `/german/curso/${u.id}`, score: score(terms, u.title) });
  }
  let n = 0;
  for (const c of CONCEPTS) {
    if (n >= per) break;
    if (hit(`${c.name} ${c.nameEs}`)) { out.push({ type: "german_concept", module: "german", id: c.id, title: c.name, snippet: c.nameEs, date: null, href: `/german/gramatica/${c.id}`, score: score(terms, c.name, c.nameEs) }); n++; }
  }
  n = 0;
  for (const v of VOCAB) {
    if (n >= per) break;
    if (hit(`${v.de} ${v.es}`)) { out.push({ type: "german_vocab", module: "german", id: v.id, title: `${v.article ? v.article + " " : ""}${v.de}`, snippet: v.es, date: null, href: "/german/vocabulario", score: score(terms, v.de, v.es) }); n++; }
  }
  return out;
}

/**
 * Searches everything the user owns. Always scoped to `userId` in SQL — there is no code path that
 * reaches another user's rows, and no caller can widen it: the only inputs are a string and two caps.
 */
export async function globalSearch(
  userId: string,
  q: string,
  opts: { limit?: number; perEntity?: number; modules?: string[] } = {},
): Promise<SearchResult> {
  const terms = parseTerms(q ?? "");
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const per = Math.min(Math.max(opts.perEntity ?? DEFAULT_PER_ENTITY, 1), 20);
  if (!terms.length) return { query: q ?? "", terms: [], hits: [], truncated: false, total: 0 };

  const ctx: Ctx = { terms, per, userId };
  // Every entity is queried at once; a failing searcher yields nothing instead of failing the search.
  const settled = await Promise.all(SEARCHERS.map((s) => s(ctx).catch(() => [] as SearchHit[])));
  let hits = [...settled.flat(), ...germanHits(terms, per)];
  if (opts.modules?.length) {
    const wanted = new Set(opts.modules);
    hits = hits.filter((h) => wanted.has(h.module));
  }
  hits.sort((a, b) => b.score - a.score || (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title));
  const total = hits.length;
  return { query: q, terms, hits: hits.slice(0, limit), truncated: total > limit, total };
}

/** The distinct modules search can return, for the UI's filter chips. */
export const SEARCH_MODULES = [
  "tasks", "calendar", "journal", "goals", "projects", "planner", "finance", "nutrition",
  "training", "studies", "investing", "trading", "academy", "ai", "reviews", "notifications", "market", "german",
] as const;
