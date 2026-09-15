/**
 * Phase 2 — domain event bus and linked goals. Integration tests against a real database and the real
 * services: a normal operation (completing a task, logging a set, studying, spending) must move the goal
 * that tracks it, without counters, without duplicates and without touching anybody else's data.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { auditLogs, notifications } from "@/server/db/schema";
import { emitDomainEvent, listSubscribers, subscribe, unsubscribe } from "@/server/events";
import * as goals from "@/server/services/goals";
import * as tasks from "@/server/services/tasks";
import * as tr from "@/server/services/training";
import * as st from "@/server/services/studies";
import * as de from "@/server/services/german";
import * as fin from "@/server/services/finance";
import * as journal from "@/server/services/journal";
import { addDaysKey, dateKey, todayKey, weekRange } from "@/lib/dates";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";
const today = () => todayKey(TZ);

const linkedGoal = (over: Record<string, unknown>) =>
  goals.goalCreateSchema.parse({ name: "goal", category: "personal", metricTarget: 4, metricPeriod: "week", ...over });

d("phase 2 — event bus and linked goals", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); other = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });
  afterEach(() => { unsubscribe("test-boom"); unsubscribe("test-spy"); });

  it("A. task.completed moves a goal that counts completed tasks", async () => {
    const g = await goals.createGoal(user.id, linkedGoal({ name: "Three tasks for this goal", metricSource: "tasks", metricKind: "completed_tasks", metricPeriod: "total", metricTarget: 3 }), TZ);
    expect(g).toMatchObject({ metricSource: "tasks", metricKind: "completed_tasks", metricUnit: "tasks", metricCurrent: 0, progress: 0 });
    const t1 = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "one", goalId: g.id }));
    const t2 = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "two", goalId: g.id }));
    await tasks.completeTask(user.id, t1.id, TZ);
    expect((await goals.getGoal(user.id, g.id, TZ)).metricCurrent).toBe(1);
    // A task that is not linked to the goal does not count.
    const loose = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "unrelated" }));
    await tasks.completeTask(user.id, loose.id, TZ);
    expect((await goals.getGoal(user.id, g.id, TZ)).metricCurrent).toBe(1);
    // Completing via updateTask counts too, and reopening gives the progress back.
    await tasks.updateTask(user.id, t2.id, { status: "done" }, TZ);
    expect(await goals.getGoal(user.id, g.id, TZ)).toMatchObject({ metricCurrent: 2, progress: 67 });
    await tasks.updateTask(user.id, t2.id, { status: "todo" }, TZ);
    expect(await goals.getGoal(user.id, g.id, TZ)).toMatchObject({ metricCurrent: 1, progress: 33 });
  });

  it("B. workout.finished (and each working set) moves a training goal", async () => {
    const g = await goals.createGoal(user.id, linkedGoal({ name: "Train 2× this week", category: "training", metricSource: "training", metricKind: "completed_workouts", metricTarget: 2 }), TZ);
    const empty = await tr.startSession(user.id, { date: today(), source: "user" }, TZ);
    await tr.updateSession(user.id, empty.id, { finished: true });
    expect((await goals.getGoal(user.id, g.id, TZ)).metricCurrent).toBe(0); // an empty session is not a workout
    const r = await tr.logSet(user.id, tr.setSchema.parse({ exercise: "bench", weightKg: 60, reps: 8, date: today() }));
    await tr.updateSession(user.id, r.session.id, { finished: true, durationMinutes: 50 });
    expect(await goals.getGoal(user.id, g.id, TZ)).toMatchObject({ metricCurrent: 1, progress: 50 });
    const vol = await goals.createGoal(user.id, linkedGoal({ name: "Volume", category: "training", metricSource: "training", metricKind: "volume_kg", metricTarget: 1000 }), TZ);
    expect(vol.metricCurrent).toBe(480);
    expect(vol.metricUnit).toBe("kg");
  });

  it("C. study.logged moves a study goal, and German activity moves a German goal through the same path", async () => {
    const study = await goals.createGoal(user.id, linkedGoal({ name: "Study 120 min", category: "study", metricSource: "study", metricKind: "minutes", metricTarget: 120 }), TZ);
    const german = await goals.createGoal(user.id, linkedGoal({ name: "German 60 min", category: "german", metricSource: "german", metricKind: "minutes", metricTarget: 60 }), TZ);
    await st.logStudySession(user.id, st.studySessionSchema.parse({ subject: "Maths", durationMinutes: 30 }), TZ);
    expect((await goals.getGoal(user.id, study.id, TZ)).metricCurrent).toBe(30);
    expect((await goals.getGoal(user.id, german.id, TZ)).metricCurrent).toBe(0);
    // via the German module UI
    await de.recordGermanEvent(user.id, { kind: "session", durationSec: 1500, unitId: "u4", label: "Unidad u4" }, TZ);
    expect((await goals.getGoal(user.id, german.id, TZ)).metricCurrent).toBe(25);
    expect((await goals.getGoal(user.id, study.id, TZ)).metricCurrent).toBe(55); // German minutes are study minutes
    // via the assistant
    await st.logStudySession(user.id, st.studySessionSchema.parse({ subject: "alemán", durationMinutes: 35, source: "ai" }), TZ);
    expect(await goals.getGoal(user.id, german.id, TZ)).toMatchObject({ metricCurrent: 60, progress: 100 });
    expect((await goals.getGoal(user.id, study.id, TZ)).metricCurrent).toBe(90);
  });

  it("D. expense.added and income.added move a finance goal", async () => {
    const g = await goals.createGoal(user.id, linkedGoal({ name: "Save 500 this month", category: "finance", metricSource: "finance", metricKind: "net_savings", metricPeriod: "month", metricTarget: 500 }), TZ);
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "income", amount: 600, category: "Salary", date: today() }), TZ);
    expect((await goals.getGoal(user.id, g.id, TZ)).metricCurrent).toBe(600);
    const tx = await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 150, category: "Food", date: today() }), TZ);
    expect(await goals.getGoal(user.id, g.id, TZ)).toMatchObject({ metricCurrent: 450, progress: 90 });
    await fin.deleteTransaction(user.id, tx.id);
    expect((await goals.getGoal(user.id, g.id, TZ)).metricCurrent).toBe(600); // deleting the expense gives it back
  });

  it("E. german.unit_completed moves a units-passed goal, read from the module's own state", async () => {
    const g = await goals.createGoal(user.id, linkedGoal({ name: "Pass 2 units", category: "german", metricSource: "german", metricKind: "units_passed", metricPeriod: "total", metricTarget: 2 }), TZ);
    expect(g.metricCurrent).toBe(0);
    // The module owns the state; the server only reads it.
    await de.saveGermanState(user.id, { lessons: { u1: { testBest: 90 }, u2: { testBest: 40 } } });
    expect((await goals.getGoal(user.id, g.id, TZ)).metricCurrent).toBe(1);
    await de.saveGermanState(user.id, { lessons: { u1: { testBest: 90 }, u2: { testBest: 80 } } });
    const ev = await de.recordGermanEvent(user.id, { kind: "unit_test", unitId: "u2", score: 80 }, TZ);
    expect(ev.deduplicated).toBe(false);
    const after = await goals.getGoal(user.id, g.id, TZ);
    expect(after).toMatchObject({ metricCurrent: 2, progress: 100, status: "completed" });
  });

  it("F. a failing subscriber never breaks the operation, and the failure is recorded", async () => {
    subscribe({ name: "test-boom", types: ["task.completed"], run: async () => { throw new Error("boom"); } });
    const t = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "survives a broken subscriber" }));
    const r = await tasks.completeTask(user.id, t.id, TZ);
    expect(r.task.status).toBe("done");
    expect((await tasks.getTask(user.id, t.id)).status).toBe("done");
    const [row] = await db.select().from(auditLogs).where(and(eq(auditLogs.userId, user.id), eq(auditLogs.action, "domain_event.subscriber_failed"))).orderBy(desc(auditLogs.createdAt)).limit(1);
    expect(row).toBeTruthy();
    expect(row.actor).toBe("system");
    expect(row.metadata).toMatchObject({ subscriber: "test-boom", message: "boom" });
    // The other subscribers still ran: a goal linked to tasks was still recomputed.
    const g = await goals.createGoal(user.id, linkedGoal({ name: "still recomputed", metricSource: "tasks", metricKind: "completed_tasks", metricPeriod: "total", metricTarget: 1 }), TZ);
    const t2 = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "counted", goalId: g.id }));
    const emit = await emitDomainEvent(user.id, { type: "task.completed", taskId: t2.id, projectId: null, goalId: g.id, date: today() }, { tz: TZ });
    expect(emit.failures.map((f) => f.subscriber)).toEqual(["test-boom"]);
    expect(emit.delivered.map((x) => x.subscriber)).toContain("goals");
  });

  it("G. processing the same event twice does not double count", async () => {
    const g = await goals.createGoal(user.id, linkedGoal({ name: "Idempotent tasks", metricSource: "tasks", metricKind: "completed_tasks", metricPeriod: "total", metricTarget: 5 }), TZ);
    const t = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "only once", goalId: g.id }));
    await tasks.completeTask(user.id, t.id, TZ);
    const afterFirst = await goals.getGoal(user.id, g.id, TZ);
    expect(afterFirst.metricCurrent).toBe(1);
    const event = { type: "task.completed", taskId: t.id, projectId: null, goalId: g.id, date: today() } as const;
    await emitDomainEvent(user.id, event, { tz: TZ });
    await emitDomainEvent(user.id, event, { tz: TZ });
    await emitDomainEvent(user.id, event, { tz: TZ });
    expect((await goals.getGoal(user.id, g.id, TZ)).metricCurrent).toBe(1);
    // A replay changes nothing, so it writes no audit row: only the first completion was recorded.
    const recomputes = await db.select().from(auditLogs).where(and(eq(auditLogs.userId, user.id), eq(auditLogs.action, "goal.recomputed"), eq(auditLogs.entityId, g.id)));
    const byCompletion = recomputes.filter((r) => (r.metadata as { cause?: string } | null)?.cause === "task.completed");
    expect(byCompletion).toHaveLength(1);
    expect(byCompletion[0].metadata).toMatchObject({ before: { metricCurrent: 0 }, after: { metricCurrent: 1 } });
  });

  it("H. events never touch another user's goals", async () => {
    const mine = await goals.createGoal(user.id, linkedGoal({ name: "mine", metricSource: "finance", metricKind: "income", metricPeriod: "month", metricTarget: 100 }), TZ);
    const theirs = await goals.createGoal(other.id, linkedGoal({ name: "theirs", metricSource: "finance", metricKind: "income", metricPeriod: "month", metricTarget: 100 }), TZ);
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "income", amount: 100, category: "Salary", date: today() }), TZ);
    expect((await goals.getGoal(user.id, mine.id, TZ)).metricCurrent).toBeGreaterThanOrEqual(100);
    expect(await goals.getGoal(other.id, theirs.id, TZ)).toMatchObject({ metricCurrent: 0, progress: 0 });
    await expect(goals.getGoal(other.id, mine.id, TZ)).rejects.toThrow();
  });

  it("I. an event with no matching goal is a no-op, and unrelated operations are untouched", async () => {
    const fresh = await createTestUser();
    try {
      const r = await emitDomainEvent(fresh.id, { type: "workout.finished", sessionId: "00000000-0000-0000-0000-000000000000", date: today(), sets: 3 }, { tz: TZ });
      expect(r.failures).toEqual([]);
      expect(r.delivered.find((x) => x.subscriber === "goals")?.result).toMatchObject({ changed: 0 });
      expect(await goals.listGoals(fresh.id, "active", TZ)).toEqual([]);
      // J. an operation with no applicable subscriber behaves exactly as before.
      const j = await journal.createEntry(fresh.id, journal.journalCreateSchema.parse({ content: "no subscriber for this", kind: "note" }));
      expect(j.content).toBe("no subscriber for this");
      expect(await journal.listJournal(fresh.id, {})).toHaveLength(1);
    } finally { await deleteTestUser(fresh.id); }
  });

  it("linked goals reject manual progress edits; manual goals keep working", async () => {
    const linked = await goals.createGoal(user.id, linkedGoal({ name: "linked", metricSource: "training", metricKind: "completed_workouts", metricTarget: 3 }), TZ);
    await expect(goals.updateGoalProgress(user.id, linked.id, { delta: 5 }, TZ)).rejects.toThrow(/computed from training/);
    await expect(goals.updateGoal(user.id, linked.id, { metricCurrent: 99 }, TZ)).rejects.toThrow(/computed from/);
    const manual = await goals.createGoal(user.id, goals.goalCreateSchema.parse({ name: "manual", metricName: "pages", metricUnit: "pages", metricTarget: 10 }), TZ);
    expect((await goals.updateGoalProgress(user.id, manual.id, { delta: 4 }, TZ)).metricCurrent).toBe(4);
    expect((await goals.updateGoalProgress(user.id, manual.id, { delta: 6 }, TZ)).progress).toBe(100);
  });

  it("an impossible metric is refused instead of being silently ignored", async () => {
    await expect(goals.createGoal(user.id, linkedGoal({ name: "bad source", metricSource: "training", metricKind: "minutes", metricTarget: 10 }), TZ)).rejects.toThrow(/metricKind/);
    await expect(goals.createGoal(user.id, linkedGoal({ name: "bad period", metricSource: "german", metricKind: "units_passed", metricPeriod: "week", metricTarget: 3 }), TZ)).rejects.toThrow(/metricPeriod/);
    await expect(goals.createGoal(user.id, linkedGoal({ name: "no target", metricSource: "training", metricKind: "completed_workouts", metricTarget: null }), TZ)).rejects.toThrow(/metricTarget/);
  });

  it("a legacy German time goal (category german, unit min) is treated as linked", async () => {
    const fresh = await createTestUser();
    try {
      const g = await goals.createGoal(fresh.id, goals.goalCreateSchema.parse({ name: "German 300 min", category: "german", metricName: "minutes", metricUnit: "min", metricTarget: 300 }), TZ);
      expect(g).toMatchObject({ metricSource: "german", metricKind: "minutes", metricPeriod: "total" });
      await de.recordGermanEvent(fresh.id, { kind: "session", durationSec: 1800, unitId: "u1" }, TZ);
      expect((await goals.getGoal(fresh.id, g.id, TZ)).metricCurrent).toBe(30);
    } finally { await deleteTestUser(fresh.id); }
  });

  it("notifications: one message when a goal is reached, none for ordinary progress", async () => {
    const fresh = await createTestUser();
    try {
      const g = await goals.createGoal(fresh.id, linkedGoal({ name: "Two workouts", category: "training", metricSource: "training", metricKind: "completed_workouts", metricTarget: 2 }), TZ);
      const goalNotifications = () => db.select().from(notifications).where(and(eq(notifications.userId, fresh.id), eq(notifications.kind, "goal")));
      /**
       * Only the "reached" transition. The subscriber also reports at-risk → on-track, which is a
       * different (and correct) message: whether it fires depends on how far into the week today is,
       * so counting every goal notification would make this test pass or fail by weekday.
       */
      const reached = async () => (await goalNotifications()).filter((n) => n.title.startsWith("Goal reached"));
      // Two distinct days inside the current ISO week, so the week metric counts both wherever today falls.
      const monday = dateKey(weekRange(new Date(today() + "T12:00:00")).start);
      const s1 = await tr.logSet(fresh.id, tr.setSchema.parse({ exercise: "bench", weightKg: 50, reps: 5, date: monday }));
      await tr.updateSession(fresh.id, s1.session.id, { finished: true });
      expect((await goals.getGoal(fresh.id, g.id, TZ)).metricCurrent).toBe(1);
      expect(await reached()).toHaveLength(0); // halfway is not news
      const s2 = await tr.logSet(fresh.id, tr.setSchema.parse({ exercise: "sentadilla", weightKg: 70, reps: 5, date: addDaysKey(monday, 1) }));
      await tr.updateSession(fresh.id, s2.session.id, { finished: true });
      expect(await goals.getGoal(fresh.id, g.id, TZ)).toMatchObject({ metricCurrent: 2, progress: 100 });
      const notes = await reached();
      expect(notes).toHaveLength(1);
      // Replaying the event does not notify again (dedupeKey per goal and period).
      await emitDomainEvent(fresh.id, { type: "workout.finished", sessionId: s2.session.id, date: addDaysKey(monday, 1), sets: 1 }, { tz: TZ });
      expect(await reached()).toHaveLength(1);
      // A weekly goal does not auto-complete: it resets when the week does.
      expect((await goals.getGoal(fresh.id, g.id, TZ)).status).toBe("active");
    } finally { await deleteTestUser(fresh.id); }
  });

  it("the bus registers exactly the two production subscribers", async () => {
    await emitDomainEvent(user.id, { type: "german.state_saved", revision: 1 }, { tz: TZ });
    const names = listSubscribers().map((s) => s.name);
    expect(names).toContain("goals");
    expect(names).toContain("notifications");
    expect(names.filter((n) => !n.startsWith("test-"))).toHaveLength(2);
  });
});
