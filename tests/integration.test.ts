/**
 * Phase 1 — integration fixes (P0). Real database, one fresh user.
 * German has a single write path (UI bridge and Studies/AI both go through recordGermanEvent),
 * empty workout sessions are not workouts, the Home training metric is cycle-based, and Finance
 * balance is never presented as net worth.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { germanEvents, studySessions } from "@/server/db/schema";
import * as st from "@/server/services/studies";
import * as de from "@/server/services/german";
import * as goals from "@/server/services/goals";
import * as tr from "@/server/services/training";
import * as fin from "@/server/services/finance";
import * as inv from "@/server/services/investing";
import * as tasks from "@/server/services/tasks";
import { dashboardData } from "@/server/services/dashboard";
import { analyticsOverview } from "@/server/services/analytics";
import { todayKey } from "@/lib/dates";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

d("phase 1 — German single source of truth", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let germanSubjectId: string;
  let goalId: string;
  const countEvents = () => db.select().from(germanEvents).where(eq(germanEvents.userId, user.id)).then((r) => r.length);
  const germanSessions = () => db.select().from(studySessions).where(and(eq(studySessions.userId, user.id), eq(studySessions.subjectId, germanSubjectId)));

  beforeAll(async () => {
    user = await createTestUser();
    germanSubjectId = (await st.listSubjects(user.id)).find((s) => s.slug === "german")!.id;
    goalId = (await goals.createGoal(user.id, goals.goalCreateSchema.parse({ name: "German 300 min", category: "german", metricName: "minutes", metricUnit: "min", metricTarget: 300 }))).id;
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("German via UI: one event, one study session labelled source=user, goal progress", async () => {
    const r = await de.recordGermanEvent(user.id, { kind: "session", durationSec: 1800, unitId: "u2", label: "Unidad u2" }, TZ);
    expect(r.deduplicated).toBe(false);
    expect(r.session).toMatchObject({ subjectId: germanSubjectId, durationMinutes: 30, source: "user", link: { type: "german_event", id: r.event.id } });
    expect(r.event.data).toMatchObject({ source: "user" });
    expect(await countEvents()).toBe(1);
    expect(await germanSessions()).toHaveLength(1);
    expect(await goals.getGoal(user.id, goalId)).toMatchObject({ metricCurrent: 30, progress: 10 });
  });

  it("German via AI/Studies: logStudySession goes through the same bridge (event + session + goal)", async () => {
    const s = await st.logStudySession(user.id, st.studySessionSchema.parse({ subject: "alemán", durationMinutes: 45, topic: "Dativ", source: "ai" }), TZ);
    expect(s.subjectId).toBe(germanSubjectId); // "alemán" resolves to the integrated subject, no new subject
    expect(s.source).toBe("ai");
    expect(s.durationMinutes).toBe(45);
    expect(s.link?.type).toBe("german_event");
    expect((await st.listSubjects(user.id)).map((x) => x.name.toLowerCase())).not.toContain("alemán");
    const events = await db.select().from(germanEvents).where(eq(germanEvents.userId, user.id));
    expect(events).toHaveLength(2);
    const aiEvent = events.find((e) => e.id === s.link?.id)!;
    expect(aiEvent).toMatchObject({ kind: "session", durationSec: 2700, label: "Dativ" });
    expect(aiEvent.data).toMatchObject({ source: "ai" });
    expect(await germanSessions()).toHaveLength(2);
    expect(await goals.getGoal(user.id, goalId)).toMatchObject({ metricCurrent: 75, progress: 25 });
  });

  it("both paths are visible identically in German summary, Studies progress, Analytics and Home", async () => {
    const today = todayKey(TZ);
    const summary = await de.germanSummary(user.id, { from: "2020-01-01", to: "2099-01-01" });
    expect(summary.totalMinutes).toBe(75);
    const progress = await st.studyProgress(user.id, { from: today, to: today });
    expect(progress.bySubject.find((b) => b.subjectId === germanSubjectId)).toMatchObject({ minutes: 75, sessions: 2 });
    const analytics = await analyticsOverview(user.id, "week", TZ);
    expect(analytics.german.totalMinutes).toBe(75);
    const home = await dashboardData(user);
    expect(home.studies?.german?.totalMinutes).toBe(75);
    expect(home.studies?.bySubject.find((b) => b.subjectId === germanSubjectId)?.minutes).toBe(75);
  });

  it("no duplicates: the same event delivered twice within the window is recorded once", async () => {
    const r = await de.recordGermanEvent(user.id, { kind: "session", durationSec: 1800, unitId: "u2", label: "Unidad u2" }, TZ);
    expect(r.deduplicated).toBe(true);
    expect(r.session).toBeNull();
    expect(await countEvents()).toBe(2);
    expect(await germanSessions()).toHaveLength(2);
    expect((await goals.getGoal(user.id, goalId)).metricCurrent).toBe(75);
  });

  it("a non-German subject never touches the German bridge", async () => {
    const s = await st.logStudySession(user.id, st.studySessionSchema.parse({ subject: "Maths", durationMinutes: 20 }), TZ);
    expect(s.subjectId).not.toBe(germanSubjectId);
    expect(s.link).toBeNull();
    expect(await countEvents()).toBe(2);
    expect((await goals.getGoal(user.id, goalId)).metricCurrent).toBe(75);
  });

  it("events without duration (unit test, score) are recorded but create no study session", async () => {
    const r = await de.recordGermanEvent(user.id, { kind: "unit_test", unitId: "u2", score: 85 }, TZ);
    expect(r.session).toBeNull();
    expect(await countEvents()).toBe(3);
    expect(await germanSessions()).toHaveLength(2);
  });
});

d("phase 1 — training sessions vs workouts, weekly metric", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });
  const range = { from: "2026-08-03", to: "2026-08-09" }; // a past ISO week, so the current-week metric stays untouched

  it("an empty session is 'started' then 'empty' and never counts as a workout", async () => {
    const s = await tr.startSession(user.id, { date: "2026-08-03", source: "user" }, TZ);
    expect((await tr.workoutHistory(user.id, range))[0]).toMatchObject({ id: s.id, status: "started", isWorkout: false, sets: 0 });
    await tr.updateSession(user.id, s.id, { finished: true, durationMinutes: 40 });
    expect((await tr.workoutHistory(user.id, range))[0]).toMatchObject({ id: s.id, status: "empty", isWorkout: false });
    const stats = await tr.trainingStats(user.id, range);
    expect(stats).toMatchObject({ sessions: 0, emptySessions: 1, sets: 0, volume: 0, minutes: 0 });
    expect(stats.weekly).toEqual([{ week: "2026-W32", sessions: 0, volume: 0 }]);
  });

  it("a session with working sets is a workout (in_progress → completed) and is counted once", async () => {
    const r = await tr.logSet(user.id, tr.setSchema.parse({ exercise: "bench", weightKg: 60, reps: 8, date: "2026-08-04" }));
    expect((await tr.workoutHistory(user.id, range)).find((h) => h.id === r.session.id)).toMatchObject({ status: "in_progress", isWorkout: true, sets: 1 });
    await tr.updateSession(user.id, r.session.id, { finished: true, durationMinutes: 55 });
    expect((await tr.workoutHistory(user.id, range)).find((h) => h.id === r.session.id)).toMatchObject({ status: "completed", isWorkout: true });
    const stats = await tr.trainingStats(user.id, range);
    expect(stats).toMatchObject({ sessions: 1, emptySessions: 1, sets: 1, volume: 480, minutes: 55 });
    expect(stats.weekly).toEqual([{ week: "2026-W32", sessions: 1, volume: 480 }]);
  });

  it("weekly metric compares completed workouts with the training days of the cycle in this week", async () => {
    const w0 = await tr.weeklyTrainingStatus(user.id, TZ);
    expect(w0.completed).toBe(0);
    expect(w0.plannedDays).toBeGreaterThanOrEqual(5); // 3-1-3-1 cycle: any 7-day window holds 5 or 6 training days
    expect(w0.plannedDays).toBeLessThanOrEqual(6);
    expect(w0.plannedSoFar).toBeLessThanOrEqual(w0.plannedDays!);
    const today = todayKey(TZ);
    const empty = await tr.startSession(user.id, { date: today, source: "ai" }, TZ);
    await tr.updateSession(user.id, empty.id, { finished: true });
    const w1 = await tr.weeklyTrainingStatus(user.id, TZ);
    expect(w1).toMatchObject({ completed: 0, sessions: 0, emptySessions: 1 });
    await tr.logSet(user.id, tr.setSchema.parse({ exercise: "sentadilla", weightKg: 80, reps: 5, date: today }));
    const w2 = await tr.weeklyTrainingStatus(user.id, TZ);
    expect(w2).toMatchObject({ completed: 1, sessions: 1, emptySessions: 1 });
    const home = await dashboardData(user);
    expect(home.training.week).toMatchObject({ completed: 1, plannedDays: w2.plannedDays });
    expect(home.training.recent.find((s) => s.id === empty.id)).toMatchObject({ isWorkout: false, status: "empty" });
  });
});

d("phase 1 — finance balance is not net worth; task counts", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("financeBalance covers Finance accounts only; investing is reported separately", async () => {
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "income", amount: 1000, category: "Salary", date: "2026-09-01" }));
    const before = await fin.financialSummary(user.id, { from: "2026-09-01", to: "2026-09-30" });
    expect(before.financeBalance).toBe(1000);
    expect("netWorth" in before).toBe(false);
    const acc = await inv.createInvestmentAccount(user.id, inv.invAccountSchema.parse({ name: "Broker", cashBalance: 0 }));
    await inv.createInvestmentTransaction(user.id, inv.invTxSchema.parse({ accountId: acc.id, type: "contribution", amount: 500, date: "2026-09-02" }), TZ);
    const after = await fin.financialSummary(user.id, { from: "2026-09-01", to: "2026-09-30" });
    expect(after.financeBalance).toBe(1000); // untouched by investing
    const home = await dashboardData(user);
    expect(home.finance?.financeBalance).toBe(1000);
    expect(home.investing?.cash).toBe(500);
    const analytics = await analyticsOverview(user.id, "month", TZ);
    expect(analytics.finance.financeBalance).toBe(1000);
  });

  it("taskCounts: open, today and overdue (with and without due dates)", async () => {
    const today = todayKey(TZ);
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "no date" }));
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "today", dueDate: today }));
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "late", dueDate: "2026-01-01" }));
    const done = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "done", dueDate: today }));
    await tasks.completeTask(user.id, done.id);
    expect(await tasks.taskCounts(user.id, TZ)).toEqual({ open: 3, today: 1, overdue: 1 });
  });
});
