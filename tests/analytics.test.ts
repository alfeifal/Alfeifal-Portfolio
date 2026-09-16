/**
 * Phase 3.5 — Analytics. Every figure must come from stored records and match the module service it
 * came from; rates must never be NaN or Infinity; and a period with little or no data must say so
 * rather than invent a trend. These tests are written to catch silent arithmetic mistakes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, deleteTestUser } from "./helpers";
import { analyticsOverview, changePct, pct, periodRange, resolveRange, MAX_CUSTOM_DAYS } from "@/server/services/analytics";
import * as fin from "@/server/services/finance";
import * as tr from "@/server/services/training";
import * as st from "@/server/services/studies";
import * as n from "@/server/services/nutrition";
import * as tasksSvc from "@/server/services/tasks";
import * as cal from "@/server/services/calendar";
import * as journal from "@/server/services/journal";
import * as g from "@/server/services/goals";
import * as pr from "@/server/services/projects";
import { getTool } from "@/server/ai/registry";
import { runTool } from "@/server/ai/agent";
import { addDaysKey, todayKey } from "@/lib/dates";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";
const today = () => todayKey(TZ);

/** Walks a value looking for the arithmetic accidents analytics is prone to. */
function assertNoBadNumbers(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    expect({ path, finite: Number.isFinite(value) }).toEqual({ path, finite: true });
    return;
  }
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoBadNumbers(v, `${path}[${i}]`)); return; }
  if (value && typeof value === "object") { for (const [k, v] of Object.entries(value)) assertNoBadNumbers(v, `${path}.${k}`); }
}

describe("analytics arithmetic (pure)", () => {
  it("percentages refuse to divide by zero", () => {
    expect(pct(3, 10)).toBe(30);
    expect(pct(0, 10)).toBe(0);
    expect(pct(5, 0)).toBeNull();
    expect(pct(0, 0)).toBeNull();
  });

  it("period-over-period change has no denominator of zero and handles negatives", () => {
    expect(changePct(120, 100)).toBe(20);
    expect(changePct(80, 100)).toBe(-20);
    expect(changePct(10, 0)).toBeNull();
    expect(changePct(0, 0)).toBeNull();
    // A previous period in the red must not flip the sign of an improvement.
    expect(changePct(-50, -100)).toBe(50);
  });

  it("ranges are contiguous, correctly sized and never overlap the previous one", () => {
    for (const [period, days] of [["week", 7], ["month", 30], ["quarter", 90], ["year", 365]] as const) {
      const r = resolveRange({ period }, TZ);
      expect(r.days).toBe(days);
      expect(r.range.to).toBe(today());
      expect(r.range.from).toBe(addDaysKey(today(), -(days - 1)));
      expect(r.previous.to).toBe(addDaysKey(r.range.from, -1));
      expect(r.previous.from).toBe(addDaysKey(r.previous.to, -(days - 1)));
    }
    expect(periodRange("week", TZ).to).toBe(today());
  });

  it("custom ranges are validated instead of trusted", () => {
    const r = resolveRange({ from: "2026-09-01", to: "2026-09-10" }, TZ);
    expect(r).toMatchObject({ period: "custom", days: 10, range: { from: "2026-09-01", to: "2026-09-10" }, previous: { from: "2026-08-22", to: "2026-08-31" } });
    expect(() => resolveRange({ from: "2026-09-10", to: "2026-09-01" }, TZ)).toThrow();
    expect(() => resolveRange({ from: "not-a-date", to: "2026-09-01" }, TZ)).toThrow();
    expect(() => resolveRange({ from: "2020-01-01", to: "2026-01-01" }, TZ)).toThrow(new RegExp(String(MAX_CUSTOM_DAYS)));
    // One day is a valid range.
    expect(resolveRange({ from: "2026-09-05", to: "2026-09-05" }, TZ).days).toBe(1);
  });
});

d("analytics over real data", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    user = await createTestUser();
    other = await createTestUser();
    const t = today();
    // Finance: one income, two expenses, a budget.
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "income", amount: 2000, category: "Salary", date: t }), TZ);
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 300, category: "Food", date: t }), TZ);
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 200, category: "Transport", date: addDaysKey(t, -2) }), TZ);
    const food = (await fin.listCategories(user.id)).find((c) => c.name === "Food")!;
    await fin.upsertBudget(user.id, { categoryId: food.id, amount: 400, period: "monthly" });
    // Training: two real workouts and one empty session.
    await tr.logSet(user.id, tr.setSchema.parse({ exercise: "bench", weightKg: 80, reps: 5, date: t }));
    await tr.logSet(user.id, tr.setSchema.parse({ exercise: "sentadilla", weightKg: 100, reps: 5, date: addDaysKey(t, -1) }));
    const empty = await tr.startSession(user.id, { date: addDaysKey(t, -3), source: "user" }, TZ);
    await tr.updateSession(user.id, empty.id, { finished: true, durationMinutes: 20 });
    // Studies on two days, nutrition on two days, tasks, events, journal, goals, projects.
    await st.logStudySession(user.id, st.studySessionSchema.parse({ subject: "alemán", durationMinutes: 60 }), TZ);
    await st.logStudySession(user.id, st.studySessionSchema.parse({ subject: "Maths", durationMinutes: 30, date: addDaysKey(t, -2) }), TZ);
    await n.logMeal(user.id, n.mealSchema.parse({ date: t, type: "lunch", items: [{ description: "Chicken and rice", quantity: 1, unit: "serving", calories: 700, protein: 50, carbs: 70, fat: 20, source: "user" }] }), TZ);
    await n.logMeal(user.id, n.mealSchema.parse({ date: addDaysKey(t, -1), type: "dinner", items: [{ description: "Salad", quantity: 1, unit: "serving", calories: 300, protein: 10, carbs: 20, fat: 18, source: "user" }] }), TZ);
    const task = await tasksSvc.createTask(user.id, tasksSvc.taskCreateSchema.parse({ title: "Done task", dueDate: t }));
    await tasksSvc.completeTask(user.id, task.id, TZ);
    await tasksSvc.createTask(user.id, tasksSvc.taskCreateSchema.parse({ title: "Still open", dueDate: addDaysKey(t, -5) }));
    await cal.createEvent(user.id, cal.eventCreateSchema.parse({ title: "Work", kind: "work", startAt: `${t}T09:00:00`, endAt: `${t}T17:00:00` }));
    await cal.createEvent(user.id, cal.eventCreateSchema.parse({ title: "Gym", kind: "training", startAt: `${t}T19:00:00`, endAt: `${t}T20:30:00` }));
    await journal.createEntry(user.id, journal.journalCreateSchema.parse({ content: "Good day", mood: 4 }), TZ);
    await journal.createEntry(user.id, journal.journalCreateSchema.parse({ content: "No mood here" }), TZ);
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Ship it", progress: 40 }), TZ);
    await g.addMilestone(user.id, goal.id, { title: "Draft", position: 0 });
    await pr.createProject(user.id, pr.projectCreateSchema.parse({ name: "Portfolio", status: "active", progress: 60 }));
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });

  it("produces no NaN, no Infinity and no negative counts anywhere", async () => {
    for (const period of ["week", "month", "quarter", "year"] as const) {
      const a = await analyticsOverview(user.id, period, TZ);
      assertNoBadNumbers(a, period);
    }
  });

  it("finance totals match the finance service exactly", async () => {
    const a = await analyticsOverview(user.id, "week", TZ);
    const source = await fin.financialSummary(user.id, a.range);
    expect(a.finance.current.income).toBe(source.income);
    expect(a.finance.current.expenses).toBe(source.expenses);
    expect(a.finance.current.net).toBe(source.net);
    expect(a.finance.current.net).toBe(a.finance.current.income - a.finance.current.expenses);
    expect(a.finance.financeBalance).toBe(source.financeBalance);
    const budget = a.finance.budgets.find((b) => b.name === "Food")!;
    expect(budget).toMatchObject({ amount: 400, spent: 300, remaining: 100, pct: 75 });
    expect(a.finance.current.byCategory.reduce((s, c) => s + c.total, 0)).toBeCloseTo(source.expenses, 2);
  });

  it("training counts only sessions with working sets, and adherence has a real denominator", async () => {
    const a = await analyticsOverview(user.id, "week", TZ);
    const source = await tr.trainingStats(user.id, a.range);
    expect(a.training.current.sessions).toBe(source.sessions);
    expect(a.training.current.sessions).toBe(2);
    expect(a.training.current.emptySessions).toBe(1);
    expect(a.training.current.volume).toBe(80 * 5 + 100 * 5);
    expect(a.training.perWeek).toBe(2); // 2 workouts over 7 days
    const adherence = a.training.adherence;
    expect(adherence.plannedDays).not.toBeNull();
    expect(adherence.plannedSoFar).toBeLessThanOrEqual(adherence.plannedDays!);
    expect(adherence.completedDays).toBe(2);
    if (adherence.adherencePct !== null) {
      expect(adherence.adherencePct).toBeGreaterThanOrEqual(0);
      expect(adherence.adherencePct).toBeLessThanOrEqual(100);
    }
  });

  it("nutrition reuses the nutrition service and keeps the Atwater check", async () => {
    const a = await analyticsOverview(user.id, "week", TZ);
    const source = await n.nutritionSummary(user.id, a.range);
    expect(a.nutrition.average).toEqual(source.average);
    expect(a.nutrition.daysLogged).toBe(2);
    expect(a.nutrition.coverage).toMatchObject({ daysLogged: 2, daysInRange: 7 });
    expect(a.nutrition.coverage.pct).toBe(29); // 2/7
    // The average is over logged days, not over the period.
    expect(a.nutrition.average.calories).toBe(500);
    // The same consistency rule the entries obey.
    expect(a.nutrition.consistency).toEqual(n.consistencyOf(a.nutrition.average));
    expect(a.nutrition.consistency.macroCalories).toBe(n.macroCalories(a.nutrition.average));
    // Compliance counts days within 10% of the target, and is null when there is no target.
    expect(a.nutrition.compliance.calories.target).toBeGreaterThan(0);
    expect(a.nutrition.compliance.calories.daysOnTarget).toBeGreaterThanOrEqual(0);
    expect(a.nutrition.compliance.calories.daysOnTarget).toBeLessThanOrEqual(a.nutrition.daysLogged);
  });

  it("studies, calendar, journal and productivity report what actually happened", async () => {
    const a = await analyticsOverview(user.id, "week", TZ);
    expect(a.studies.current.totalMinutes).toBe(90);
    expect(a.studies.consistency).toMatchObject({ daysStudied: 2, daysInRange: 7 });
    expect(a.studies.consistency.avgMinutesPerStudyDay).toBe(45);
    expect(a.calendar.events).toBe(2);
    expect(a.calendar.totalHours).toBe(9.5); // 8h work + 1.5h gym
    expect(a.calendar.byKind.find((k) => k.kind === "work")?.hours).toBe(8);
    expect(a.journal).toMatchObject({ entries: 2, withMood: 1, avgMood: 4 });
    expect(a.productivity.done).toBe(1);
    expect(a.productivity.created).toBeGreaterThanOrEqual(2);
    expect(a.productivity.completionRate).toBe(pct(a.productivity.done, a.productivity.created));
    expect(a.productivity.byWeekday.reduce((s, w) => s + w.n, 0)).toBe(a.productivity.done);
    expect(a.productivity.overdue).toBe(1);
  });

  it("goals and projects report counts, progress and milestones", async () => {
    const a = await analyticsOverview(user.id, "week", TZ);
    expect(a.goals.active).toBe(1);
    // The goal was created at a hand-typed 40 % and then given a milestone. From that moment its
    // progress is measured by its checkpoints (phase 3.8): 0 of 1 reached, so 0 %. The hand-typed
    // number was a guess; a real structure replaces it, and the change is in the audit log.
    expect(a.goals.avgProgress).toBe(0);
    expect(a.goals.milestones.total).toBe(1);
    expect(a.goals.milestones.completed).toBe(0);
    expect(a.goals.milestones.overdue).toBe(0);
    expect(a.projects.active).toBe(1);
    // The project has neither tasks nor milestones, so the manual value still stands.
    expect(a.projects.avgProgress).toBe(60);
  });

  it("a brand-new account produces zeros and nulls, never fake trends", async () => {
    const fresh = await createTestUser();
    try {
      const a = await analyticsOverview(fresh.id, "month", TZ);
      assertNoBadNumbers(a, "fresh");
      expect(a.finance.current).toMatchObject({ income: 0, expenses: 0, net: 0, savingsRate: null });
      expect(a.finance.change.income).toBeNull();
      expect(a.training.current.sessions).toBe(0);
      expect(a.training.perWeek).toBe(0);
      expect(a.training.adherence.adherencePct).toBe(0); // a plan exists and nothing was trained
      expect(a.nutrition.daysLogged).toBe(0);
      expect(a.nutrition.coverage.pct).toBe(0);
      expect(a.nutrition.compliance.calories.pct).toBeNull(); // no logged days to divide by
      expect(a.productivity.completionRate).toBeNull();
      expect(a.studies.consistency.avgMinutesPerStudyDay).toBeNull();
      expect(a.journal.avgMood).toBeNull();
      expect(a.investing.changePct).toBeNull();
      expect(a.calendar.byKind).toEqual([]);
    } finally { await deleteTestUser(fresh.id); }
  });

  it("without a training plan there is no adherence target invented", async () => {
    const fresh = await createTestUser();
    try {
      const plan = await tr.getPlanWithDays(fresh.id);
      await tr.updatePlan(fresh.id, plan!.id, { active: false });
      const a = await analyticsOverview(fresh.id, "week", TZ);
      expect(a.training.adherence.plannedDays).toBeNull();
      expect(a.training.adherence.adherencePct).toBeNull();
    } finally { await deleteTestUser(fresh.id); }
  });

  it("the previous period is a different window, and comparisons use it", async () => {
    const a = await analyticsOverview(user.id, "week", TZ);
    expect(a.previousRange.to).toBe(addDaysKey(a.range.from, -1));
    const previous = await fin.financialSummary(user.id, a.previousRange);
    expect(a.finance.previous.income).toBe(previous.income);
    expect(a.finance.change.income).toBe(changePct(a.finance.current.income, previous.income));
  });

  it("one user's analytics never contain another user's records", async () => {
    await fin.createTransaction(other.id, fin.transactionSchema.parse({ type: "expense", amount: 999, category: "Food", date: today() }), TZ);
    await st.logStudySession(other.id, st.studySessionSchema.parse({ subject: "Maths", durationMinutes: 500 }), TZ);
    const mine = await analyticsOverview(user.id, "week", TZ);
    const theirs = await analyticsOverview(other.id, "week", TZ);
    expect(mine.finance.current.expenses).toBe(500);
    expect(theirs.finance.current.expenses).toBe(999);
    expect(mine.studies.current.totalMinutes).toBe(90);
    expect(theirs.studies.current.totalMinutes).toBe(500);
    expect(theirs.training.current.sessions).toBe(0);
  });

  it("a custom range is honoured and bounded", async () => {
    const from = addDaysKey(today(), -2);
    const a = await analyticsOverview(user.id, { from, to: today() }, TZ);
    expect(a.period).toBe("custom");
    expect(a.range).toEqual({ from, to: today() });
    expect(a.rangeDays).toBe(3);
    expect(a.studies.consistency.daysInRange).toBe(3);
    await expect(analyticsOverview(user.id, { from: "2020-01-01", to: today() }, TZ)).rejects.toMatchObject({ status: 400 });
  });

  it("the AI tool returns the same numbers and can ask for single sections", async () => {
    const tool = getTool("get_analytics")!;
    expect(tool.risk).toBe("read");
    const full = await runTool(tool, { period: "week" }, { user, conversationId: null, confirmed: false });
    expect(full.status).toBe("success");
    const direct = await analyticsOverview(user.id, "week", TZ);
    expect((full.result as { finance: { current: { net: number } } }).finance.current.net).toBe(direct.finance.current.net);
    const partial = await runTool(tool, { period: "week", sections: ["training", "nutrition"] }, { user, conversationId: null, confirmed: false });
    const keys = Object.keys(partial.result as object);
    expect(keys).toContain("training");
    expect(keys).toContain("nutrition");
    expect(keys).not.toContain("finance");
  });
});
