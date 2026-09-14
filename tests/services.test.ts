import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, deleteTestUser } from "./helpers";
import * as tasks from "@/server/services/tasks";
import * as fin from "@/server/services/finance";
import * as tr from "@/server/services/training";
import * as cal from "@/server/services/calendar";
import * as st from "@/server/services/studies";
import * as de from "@/server/services/german";
import * as trading from "@/server/services/trading";
import * as goals from "@/server/services/goals";
import { globalSearch } from "@/server/services/search";
import { exportAll } from "@/server/services/export";
import { generateNotifications, listNotifications } from "@/server/services/notifications";
import { getTool } from "@/server/ai/registry";
import { runTool } from "@/server/ai/agent";
import { db } from "@/server/db";
import { aiActionLogs } from "@/server/db/schema";
import { eq } from "drizzle-orm";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("services (integration, real database)", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("bootstraps the account with categories, an account and the routine", async () => {
    expect((await fin.listCategories(user.id)).length).toBeGreaterThan(10);
    expect((await fin.listAccounts(user.id))[0]?.isDefault).toBe(true);
    const plan = await tr.getPlanWithDays(user.id);
    expect(plan?.cycleLength).toBe(8);
    expect(plan?.days).toHaveLength(8);
    expect(plan?.days.reduce((a, dd) => a + dd.exercises.length, 0)).toBe(49);
    expect(await tr.seedRoutine(user.id)).toBe(plan!.id); // idempotent
  });

  it("tasks: create, complete recurring, counts", async () => {
    const t = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "Study German", dueDate: "2026-09-14", recurrence: "daily", priority: "high" }));
    const r = await tasks.completeTask(user.id, t.id);
    expect(r.task.status).toBe("done");
    expect(r.next?.dueDate).toBe("2026-09-15");
    await expect(tasks.getTask("00000000-0000-0000-0000-000000000000", t.id)).rejects.toThrow();
  });

  it("finance: transactions, category resolution by name, summary, budgets", async () => {
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 18, category: "Food", description: "dinner", date: "2026-09-10" }));
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 24.5, category: "groceries", description: "supermarket", date: "2026-09-11" }));
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "income", amount: 1800, category: "Salary", date: "2026-09-01" }));
    const cats = await fin.listCategories(user.id);
    expect(cats.filter((c) => c.name.toLowerCase() === "groceries")).toHaveLength(1); // matched case-insensitively, not duplicated
    await fin.upsertBudget(user.id, { categoryId: cats.find((c) => c.name === "Food")!.id, amount: 200, period: "monthly" });
    const s = await fin.financialSummary(user.id, { from: "2026-09-01", to: "2026-09-30" });
    expect(s.income).toBe(1800);
    expect(s.expenses).toBe(42.5);
    expect(s.net).toBe(1757.5);
    expect(s.savingsRate).toBeCloseTo(97.64, 1);
    expect(s.budgets[0]).toMatchObject({ name: "Food", spent: 18, remaining: 182 });
    expect((await fin.listAccounts(user.id))[0].balance).toBe(1757.5);
  });

  it("training: log sets against the routine, PRs and progression", async () => {
    const plan = await tr.getPlanWithDays(user.id);
    await tr.updatePlan(user.id, plan!.id, { startDate: "2026-09-14" });
    const w = await tr.workoutForDate(user.id, "2026-09-14");
    expect(w?.day?.name).toBe("Push");
    expect((await tr.workoutForDate(user.id, "2026-09-17"))?.day?.isRest).toBe(true);
    const r1 = await tr.logSet(user.id, tr.setSchema.parse({ exercise: "bench", weightKg: 80, reps: 6, date: "2026-09-14" }));
    expect(r1.set.setNumber).toBe(1);
    expect(r1.newRecords.map((x) => x.kind)).toContain("est_1rm");
    const r2 = await tr.logSet(user.id, tr.setSchema.parse({ exercise: "press banca", weightKg: 82.5, reps: 6, date: "2026-09-14" }));
    expect(r2.set.setNumber).toBe(2);
    expect(r2.newRecords.some((x) => x.kind === "max_weight" && x.value === 82.5)).toBe(true);
    const ex = await tr.resolveExercise(user.id, "Press Banca con Barra");
    const prog = await tr.exerciseProgress(user.id, ex!.id);
    expect(prog.series[0].topWeight).toBe(82.5);
    const sess = await tr.updateSession(user.id, r1.session.id, { finished: true, rating: 4 });
    expect(sess.finishedAt).not.toBeNull();
    expect((await tr.workoutHistory(user.id))[0].sets).toBe(2);
  });

  it("calendar: events and free slots", async () => {
    await cal.createEvent(user.id, cal.eventCreateSchema.parse({ title: "Work", kind: "work", startAt: "2026-09-15T10:00:00", endAt: "2026-09-15T18:00:00" }));
    const slots = await cal.freeSlots(user.id, new Date("2026-09-15T07:00:00"), new Date("2026-09-15T23:00:00"));
    expect(slots.map((s) => s.minutes)).toEqual([180, 300]);
    await expect(cal.createEvent(user.id, cal.eventCreateSchema.parse({ title: "bad", startAt: "2026-09-15T10:00:00", endAt: "2026-09-15T09:00:00" }))).rejects.toThrow();
  });

  it("german bridge: an event becomes a study session and feeds goals", async () => {
    const g = await goals.createGoal(user.id, goals.goalCreateSchema.parse({ name: "German 300 min", category: "german", metricName: "minutes", metricUnit: "min", metricTarget: 300 }));
    await de.recordGermanEvent(user.id, { kind: "session", durationSec: 1800, unitId: "u3", label: "Unidad u3" });
    const sessions = await st.listStudySessions(user.id);
    expect(sessions[0]).toMatchObject({ durationMinutes: 30, subjectName: "German" });
    const g2 = await goals.getGoal(user.id, g.id);
    expect(g2.metricCurrent).toBe(30);
    expect(g2.progress).toBe(10);
    const summary = await de.germanSummary(user.id, { from: "2020-01-01", to: "2099-01-01" });
    expect(summary.totalMinutes).toBe(30);
  });

  it("trading: real and paper never mix", async () => {
    const t = await trading.addTrade(user.id, trading.tradeSchema.parse({ mode: "paper", symbol: "aapl", direction: "long", entryPrice: 100, stopLoss: 95, quantity: 10, exitPrice: 110 }));
    expect(t.mode).toBe("paper");
    expect(t.status).toBe("closed");
    expect(t.pnl).toBe(100);
    expect(t.rMultiple).toBe(2);
    expect((await trading.tradingStatistics(user.id, "paper")).trades).toBe(1);
    expect((await trading.tradingStatistics(user.id, "real")).trades).toBe(0);
    await expect(trading.addTrade(user.id, trading.tradeSchema.parse({ mode: "real", symbol: "MSFT" }))).rejects.toThrow(/No real trading account/);
  });

  it("AI tools: validation, execution, logging and confirmation gating", async () => {
    const add = getTool("add_expense")!;
    const ok = await runTool(add, { amount: 12, category: "Food", description: "lunch" }, { user, conversationId: null, confirmed: false });
    expect(ok.status).toBe("success");
    const bad = await runTool(add, { amount: -5 }, { user, conversationId: null, confirmed: false });
    expect(bad.status).toBe("failed");
    expect(bad.error).toMatch(/Invalid parameters/);
    const del = getTool("delete_expense")!;
    const pending = await runTool(del, { id: (ok.result as { id: string }).id }, { user, conversationId: null, confirmed: false });
    expect(pending.status).toBe("pending_confirmation");
    const logs = await db.select().from(aiActionLogs).where(eq(aiActionLogs.userId, user.id));
    expect(logs.map((l) => l.status).sort()).toEqual(["failed", "pending_confirmation", "success"]);
    const high = getTool("create_transfer")!;
    expect(high.risk).toBe("high");
  });

  it("notifications, search and export", async () => {
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "Overdue thing", dueDate: "2020-01-01" }));
    expect(await generateNotifications(user.id, "Europe/Madrid")).toBeGreaterThan(0);
    expect(await generateNotifications(user.id, "Europe/Madrid")).toBe(0); // idempotent
    expect((await listNotifications(user.id)).some((n) => n.title.includes("Overdue thing"))).toBe(true);
    const hits = await globalSearch(user.id, "supermarket");
    expect(hits.some((h) => h.type === "transaction")).toBe(true);
    expect((await globalSearch(user.id, "Akkusativ")).some((h) => h.type.startsWith("german"))).toBe(true);
    const dump = await exportAll(user.id);
    expect(dump.finance.transactions.length).toBeGreaterThanOrEqual(4);
    expect(dump.training.dayExercises).toHaveLength(49);
    expect(JSON.stringify(dump)).not.toContain("passwordHash");
  });
});
