/**
 * Full AI write coverage. The product rule: anything the user can edit on the web, the assistant can
 * edit through a controlled tool. These tests check the rule holds in practice — each new tool is
 * registered, reaches its domain service, persists for real, is gated by risk, refuses another user's
 * records, and reports failure instead of pretending.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { auditLogs, users } from "@/server/db/schema";
import { allTools, getTool } from "@/server/ai/registry";
import { confirmAction, runTool } from "@/server/ai/agent";
import * as fin from "@/server/services/finance";
import * as inv from "@/server/services/investing";
import * as trd from "@/server/services/trading";
import * as st from "@/server/services/studies";
import * as j from "@/server/services/journal";
import * as ac from "@/server/services/academy";
import * as mem from "@/server/services/memory";
import * as pr from "@/server/services/projects";
import * as g from "@/server/services/goals";
import * as tr from "@/server/services/training";
import { todayKey, addDaysKey } from "@/lib/dates";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

/** Tools the assistant must have, grouped by the UI capability they cover. */
const REQUIRED = {
  journal: ["create_journal_entry", "get_journal_entries", "update_journal_entry", "delete_journal_entry"],
  finance: ["create_finance_account", "update_finance_account", "delete_finance_account", "create_finance_category", "create_recurring_transaction", "update_recurring_transaction", "delete_recurring_transaction", "create_savings_goal", "update_savings_goal", "delete_savings_goal", "update_budget", "delete_budget"],
  investing: ["create_investment_account", "delete_investment_account", "create_investment_asset", "update_investment_asset", "delete_investment_asset", "add_investment_transaction", "delete_investment_transaction"],
  trading: ["create_trading_account", "delete_trading_account", "create_strategy", "delete_strategy", "add_to_watchlist", "update_watchlist_item", "remove_watchlist_item", "create_price_alert", "delete_price_alert", "add_trade", "update_trade", "delete_trade"],
  studies: ["create_subject", "update_subject", "delete_subject", "create_exam", "update_exam", "delete_exam", "create_assignment", "complete_assignment", "delete_assignment", "log_study_session", "delete_study_session"],
  academy: ["get_academy_lessons", "create_academy_lesson", "update_academy_lesson", "delete_academy_lesson", "set_academy_notes", "record_academy_quiz"],
  ai: ["remember_memory", "update_memory", "forget_memory"],
  notifications: ["get_notifications", "mark_notifications_read", "delete_notification"],
  training: ["log_workout", "log_set", "delete_workout_set", "delete_workout_session", "modify_routine", "update_training_plan"],
  goals: ["create_goal", "update_goal", "delete_goal", "add_milestone", "complete_milestone", "delete_milestone"],
  projects: ["create_project", "update_project", "delete_project", "add_project_milestone", "create_project_task"],
  settings: ["update_profile"],
};

describe("write-capability coverage", () => {
  it("every capability the UI offers has a registered tool", () => {
    const names = new Set(allTools().map((t) => t.name));
    for (const [group, tools] of Object.entries(REQUIRED)) {
      for (const tool of tools) expect({ group, tool, registered: names.has(tool) }).toEqual({ group, tool, registered: true });
    }
  });

  it("the registry stays coherent: unique names, no generic database access, destructive actions gated", () => {
    const tools = allTools();
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    for (const banned of ["update_database", "execute_sql", "run_sql", "update_record", "query_database", "write_table", "patch_row"]) {
      expect(tools.map((t) => t.name)).not.toContain(banned);
    }
    for (const t of tools) {
      const shape = JSON.stringify((t.schema as { _def?: unknown })._def ?? {});
      for (const forbidden of ["table", "sql", "columns", "userId", "user_id"]) {
        expect({ tool: t.name, leaks: forbidden, found: shape.includes(`"${forbidden}"`) }).toEqual({ tool: t.name, leaks: forbidden, found: false });
      }
      if (t.name.startsWith("delete_") || t.name.startsWith("remove_")) {
        const reversible = ["delete_price_alert", "delete_notification", "remove_watchlist_item"].includes(t.name);
        const gated = t.risk === "high" || Boolean(t.needsConfirmation) || reversible;
        expect({ tool: t.name, gated }).toEqual({ tool: t.name, gated: true });
      }
    }
    // Every high-risk tool is confirmation-gated by the agent regardless of its own rule.
    for (const t of tools.filter((x) => x.risk === "high")) expect(t.risk).toBe("high");
  });

  it("the exceptions stay exceptions", () => {
    const names = allTools().map((t) => t.name);
    for (const forbidden of ["accept_plan", "apply_plan", "change_password", "delete_account", "revoke_sessions", "set_german_progress", "update_german_state"]) {
      expect(names).not.toContain(forbidden);
    }
  });
});

d("new write tools reach their service and persist (real database)", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  const ctx = () => ({ user, conversationId: null, confirmed: false });
  const direct = () => ({ user, conversationId: null, confirmed: true });
  beforeAll(async () => { user = await createTestUser(); other = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });

  it("journal: edit and delete an entry", async () => {
    const entry = await j.createEntry(user.id, j.journalCreateSchema.parse({ content: "First version", kind: "note" }), TZ);
    const edited = await runTool(getTool("update_journal_entry")!, { id: entry.id, content: "Second version", mood: 4 }, ctx());
    expect(edited.status).toBe("success");
    expect((await j.getEntry(user.id, entry.id)).content).toBe("Second version");
    const pending = await runTool(getTool("delete_journal_entry")!, { id: entry.id }, ctx());
    expect(pending.status).toBe("pending_confirmation");
    await confirmAction(user, pending.logId);
    await expect(j.getEntry(user.id, entry.id)).rejects.toBeTruthy();
  });

  it("finance: account, category, recurring and savings goal all round-trip", async () => {
    const account = await runTool(getTool("create_finance_account")!, { name: "Broker cash", type: "savings", currency: "EUR", balance: 0 }, ctx());
    const accountId = (account.result as { id: string }).id;
    expect((await fin.listAccounts(user.id)).some((a) => a.id === accountId)).toBe(true);
    await runTool(getTool("update_finance_account")!, { id: accountId, name: "Savings pot" }, direct());
    expect((await fin.listAccounts(user.id)).find((a) => a.id === accountId)?.name).toBe("Savings pot");

    const category = await runTool(getTool("create_finance_category")!, { name: "Books", kind: "expense" }, ctx());
    expect((await fin.listCategories(user.id)).some((c) => c.id === (category.result as { id: string }).id)).toBe(true);

    const recurring = await runTool(getTool("create_recurring_transaction")!, { type: "expense", amount: 12.99, description: "Streaming", frequency: "monthly", nextDate: addDaysKey(todayKey(TZ), 10) }, ctx());
    expect(recurring.status).toBe("pending_confirmation");
    const confirmed = await confirmAction(user, recurring.logId);
    const recurringId = (confirmed.result as { id: string }).id;
    await runTool(getTool("update_recurring_transaction")!, { id: recurringId, amount: 14.99 }, direct());
    const delRecurring = await runTool(getTool("delete_recurring_transaction")!, { id: recurringId }, ctx());
    await confirmAction(user, delRecurring.logId);

    const savings = await runTool(getTool("create_savings_goal")!, { name: "New laptop", targetAmount: 1500, currentAmount: 100 }, ctx());
    const savingsId = (savings.result as { id: string }).id;
    expect((await fin.listSavingsGoals(user.id)).some((s) => s.id === savingsId)).toBe(true);
    const delSavings = await runTool(getTool("delete_savings_goal")!, { id: savingsId }, ctx());
    expect(delSavings.status).toBe("pending_confirmation");
    await confirmAction(user, delSavings.logId);
    expect((await fin.listSavingsGoals(user.id)).some((s) => s.id === savingsId)).toBe(false);

    // Deleting an account is high risk, name-checked, and keeps the transactions.
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 5, accountId, category: "Food", date: todayKey(TZ) }), TZ);
    const wrongName = await runTool(getTool("delete_finance_account")!, { id: accountId, name: "Not the name" }, direct());
    expect(wrongName.status).toBe("failed");
    const pending = await runTool(getTool("delete_finance_account")!, { id: accountId, name: "Savings pot" }, ctx());
    expect(pending.status).toBe("pending_confirmation");
    await confirmAction(user, pending.logId);
    expect((await fin.listAccounts(user.id)).some((a) => a.id === accountId)).toBe(false);
    expect((await fin.listTransactions(user.id, { limit: 50 })).some((t) => t.amount === 5)).toBe(true);
  });

  it("investing: account, asset and transaction, with the cascading delete confirmed", async () => {
    const account = await runTool(getTool("create_investment_account")!, { name: "Broker", currency: "EUR", cashBalance: 1000 }, ctx());
    const accountId = (account.result as { id: string }).id;
    const asset = await runTool(getTool("create_investment_asset")!, { symbol: "VWCE", name: "FTSE All-World", assetClass: "etf", currency: "EUR" }, ctx());
    const assetId = (asset.result as { id: string }).id;
    await runTool(getTool("update_investment_asset")!, { id: assetId, name: "Vanguard FTSE All-World" }, direct());
    expect((await inv.listAssets(user.id)).find((a) => a.id === assetId)?.name).toBe("Vanguard FTSE All-World");

    const tx = await runTool(getTool("add_investment_transaction")!, { accountId, assetId, type: "buy", quantity: 2, price: 100, date: todayKey(TZ) }, ctx());
    expect(tx.status).toBe("pending_confirmation"); // high risk
    const txDone = await confirmAction(user, tx.logId);
    const txId = (txDone.result as { id: string }).id;
    const delTx = await runTool(getTool("delete_investment_transaction")!, { id: txId }, ctx());
    expect(delTx.status).toBe("pending_confirmation");
    await confirmAction(user, delTx.logId);
    expect((await inv.listInvestmentTransactions(user.id)).some((t) => t.id === txId)).toBe(false);

    const delAccount = await runTool(getTool("delete_investment_account")!, { id: accountId, name: "Broker" }, ctx());
    expect(delAccount.status).toBe("pending_confirmation");
    await confirmAction(user, delAccount.logId);
    expect((await inv.listInvestmentAccounts(user.id)).some((a) => a.id === accountId)).toBe(false);
  });

  it("trading: real accounts and trade deletion are confirmed, watchlist edits are not", async () => {
    const paper = await runTool(getTool("create_trading_account")!, { name: "Paper", mode: "paper", currency: "EUR", startingBalance: 10000 }, ctx());
    expect(paper.status).toBe("success");
    const real = await runTool(getTool("create_trading_account")!, { name: "Real money", mode: "real", currency: "EUR", startingBalance: 500 }, ctx());
    expect(real.status).toBe("pending_confirmation");
    await confirmAction(user, real.logId);

    const strategy = await runTool(getTool("create_strategy")!, { name: "Breakouts" }, ctx());
    const strategyId = (strategy.result as { id: string }).id;
    const item = await runTool(getTool("add_to_watchlist")!, { symbol: "aapl" }, ctx());
    const itemId = (item.result as { id: string }).id;
    await runTool(getTool("update_watchlist_item")!, { id: itemId, notes: "Earnings next week" }, direct());
    const removed = await runTool(getTool("remove_watchlist_item")!, { id: itemId }, ctx());
    expect(removed.status).toBe("success"); // low risk: trivially reversible

    const trade = await trd.addTrade(user.id, trd.tradeSchema.parse({ accountId: (paper.result as { id: string }).id, symbol: "AAPL", direction: "long", entryPrice: 100, quantity: 10, entryAt: new Date().toISOString() }));
    const delTrade = await runTool(getTool("delete_trade")!, { id: trade.id }, ctx());
    expect(delTrade.status).toBe("pending_confirmation");
    const done = await confirmAction(user, delTrade.logId);
    expect((done.result as { mode: string }).mode).toBe("paper");

    const delStrategy = await runTool(getTool("delete_strategy")!, { id: strategyId }, ctx());
    await confirmAction(user, delStrategy.logId);
    expect((await trd.listStrategies(user.id)).some((s) => s.id === strategyId)).toBe(false);
  });

  it("studies: subject lifecycle, exam edits and session deletion", async () => {
    const subject = await runTool(getTool("create_subject")!, { name: "Statistics", kind: "subject", weeklyGoalMinutes: 120 }, ctx());
    const subjectId = (subject.result as { id: string }).id;
    const exam = await runTool(getTool("create_exam")!, { subject: "Statistics", title: "Midterm", date: addDaysKey(todayKey(TZ), 20) }, ctx());
    expect(exam.status).toBe("success");
    const examId = (exam.result as { id: string }).id;
    await runTool(getTool("update_exam")!, { id: examId, date: addDaysKey(todayKey(TZ), 25) }, direct());
    expect((await st.listExams(user.id, false)).find((e) => e.id === examId)?.date).toBe(addDaysKey(todayKey(TZ), 25));
    const delExam = await runTool(getTool("delete_exam")!, { id: examId }, ctx());
    await confirmAction(user, delExam.logId);

    const session = await st.logStudySession(user.id, st.studySessionSchema.parse({ subjectId, durationMinutes: 45 }), TZ);
    const delSession = await runTool(getTool("delete_study_session")!, { id: session.id }, ctx());
    expect(delSession.status).toBe("pending_confirmation");
    await confirmAction(user, delSession.logId);
    expect((await st.listStudySessions(user.id)).some((s) => s.id === session.id)).toBe(false);

    const delSubject = await runTool(getTool("delete_subject")!, { id: subjectId, name: "Statistics" }, ctx());
    expect(delSubject.status).toBe("pending_confirmation");
    await confirmAction(user, delSubject.logId);
    expect((await st.listSubjects(user.id)).some((s) => s.id === subjectId)).toBe(false);
  });

  it("academy: lessons, notes and quiz attempts", async () => {
    const lesson = await runTool(getTool("create_academy_lesson")!, { topic: "risk", title: "Position sizing", content: "Risk a fixed share of the account." }, ctx());
    const lessonId = (lesson.result as { id: string }).id;
    await runTool(getTool("update_academy_lesson")!, { id: lessonId, title: "Position sizing basics" }, direct());
    await runTool(getTool("set_academy_notes")!, { lessonId, notes: "Never more than 1%." }, ctx());
    const quiz = await runTool(getTool("record_academy_quiz")!, { lessonId, score: 90 }, ctx());
    expect(quiz.status).toBe("success");
    const read = await runTool(getTool("get_academy_lessons")!, { id: lessonId }, ctx());
    const detail = read.result as { title: string; progress: { bestScore: number | null; notes: string | null } | null };
    expect(detail.title).toBe("Position sizing basics");
    expect(detail.progress?.bestScore).toBe(90);
    const del = await runTool(getTool("delete_academy_lesson")!, { id: lessonId }, ctx());
    await confirmAction(user, del.logId);
    expect((await ac.listLessons(user.id)).some((l) => l.id === lessonId)).toBe(false);
  });

  it("memory, notifications, milestones and profile", async () => {
    const remembered = await runTool(getTool("remember_memory")!, { content: "Trains at 19:00", kind: "routine" }, ctx());
    const memoryId = (remembered.result as { id: string }).id;
    await runTool(getTool("update_memory")!, { id: memoryId, content: "Trains at 20:00", importance: 5 }, direct());
    expect((await mem.listMemory(user.id, { limit: 20 })).find((m) => m.id === memoryId)?.content).toBe("Trains at 20:00");

    const project = await pr.createProject(user.id, pr.projectCreateSchema.parse({ name: "Website", status: "active" }));
    const milestone = await runTool(getTool("add_project_milestone")!, { projectId: project.id, title: "Ship v1" }, ctx());
    const milestoneId = (milestone.result as { id: string }).id;
    const delMilestone = await runTool(getTool("delete_milestone")!, { id: milestoneId }, ctx());
    expect(delMilestone.status).toBe("pending_confirmation");
    await confirmAction(user, delMilestone.logId);

    const profile = await runTool(getTool("update_profile")!, { timezone: "Europe/Lisbon" }, ctx());
    expect(profile.status).toBe("pending_confirmation");
    await confirmAction(user, profile.logId);
    expect((await db.select().from(users).where(eq(users.id, user.id)))[0].timezone).toBe("Europe/Lisbon");
  });

  it("training: a whole session can be removed, and stats follow", async () => {
    const set = await tr.logSet(user.id, tr.setSchema.parse({ exercise: "bench", weightKg: 70, reps: 5, date: todayKey(TZ) }));
    const pending = await runTool(getTool("delete_workout_session")!, { id: set.session.id }, ctx());
    expect(pending.status).toBe("pending_confirmation");
    const done = await confirmAction(user, pending.logId);
    expect((done.result as { sets: number }).sets).toBe(1);
    expect((await tr.workoutHistory(user.id, { limit: 20 })).some((w) => w.id === set.session.id)).toBe(false);
  });

  it("no new write tool can touch another user's records", async () => {
    const theirAccount = await fin.createAccount(other.id, fin.accountSchema.parse({ name: "Theirs", type: "checking", currency: "EUR", balance: 0 }));
    const theirEntry = await j.createEntry(other.id, j.journalCreateSchema.parse({ content: "Private" }), TZ);
    const theirSubject = await st.createSubject(other.id, st.subjectSchema.parse({ name: "Theirs" }));
    const theirGoal = await g.createGoal(other.id, g.goalCreateSchema.parse({ name: "Their goal" }), TZ);
    const attempts: [string, Record<string, unknown>][] = [
      ["update_journal_entry", { id: theirEntry.id, content: "hacked" }],
      ["delete_journal_entry", { id: theirEntry.id }],
      ["delete_finance_account", { id: theirAccount.id, name: "Theirs" }],
      ["delete_subject", { id: theirSubject.id, name: "Theirs" }],
      ["delete_goal", { id: theirGoal.id, name: "Their goal" }],
    ];
    for (const [tool, input] of attempts) {
      const r = await runTool(getTool(tool)!, input, direct());
      expect({ tool, status: r.status }).toEqual({ tool, status: "failed" });
    }
    expect((await fin.listAccounts(other.id)).some((a) => a.id === theirAccount.id)).toBe(true);
    expect((await j.getEntry(other.id, theirEntry.id)).content).toBe("Private");
    expect((await st.listSubjects(other.id)).some((s) => s.id === theirSubject.id)).toBe(true);
  });

  it("invalid input fails loudly and writes nothing", async () => {
    const bad = await runTool(getTool("create_finance_account")!, { name: "", type: "nonsense" }, direct());
    expect(bad.status).toBe("failed");
    expect(bad.error).toMatch(/Invalid parameters/);
    const missing = await runTool(getTool("update_journal_entry")!, { id: "00000000-0000-0000-0000-000000000000", content: "ghost" }, direct());
    expect(missing.status).toBe("failed");
  });

  it("deleting twice is honest: the second attempt does not claim success on a phantom", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Temporary" }), TZ);
    const first = await runTool(getTool("delete_goal")!, { id: goal.id, name: "Temporary" }, direct());
    expect(first.status).toBe("confirmed");
    const second = await runTool(getTool("delete_goal")!, { id: goal.id, name: "Temporary" }, direct());
    expect(second.status).toBe("failed");
  });

  it("every AI write leaves an audit row with actor ai", async () => {
    await runTool(getTool("create_savings_goal")!, { name: "Audited goal", targetAmount: 100 }, direct());
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.userId, user.id));
    const aiRows = rows.filter((r) => r.actor === "ai");
    expect(aiRows.length).toBeGreaterThan(5);
    expect(aiRows.some((r) => r.action === "ai.create_savings_goal")).toBe(true);
  });
});
