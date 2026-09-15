/**
 * Phase 3.1 — life snapshot and assistant context. Integration tests against a real database:
 * the snapshot is assembled from the real services, the system prompt stays inside its budget with a
 * loaded account, and a brand-new account produces a valid prompt instead of an error.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { aiReports } from "@/server/db/schema";
import { COMPACT_SECTIONS, SNAPSHOT_BUDGET_CHARS, SNAPSHOT_SECTIONS, fitToBudget, lifeSnapshot, renderCompact } from "@/server/services/snapshot";
import { buildSystemPrompt } from "@/server/ai/context";
import { getTool } from "@/server/ai/registry";
import { runTool } from "@/server/ai/agent";
import * as tasks from "@/server/services/tasks";
import * as projects from "@/server/services/projects";
import * as st from "@/server/services/studies";
import * as goals from "@/server/services/goals";
import * as fin from "@/server/services/finance";
import * as tr from "@/server/services/training";
import * as cal from "@/server/services/calendar";
import { todayKey, addDaysKey } from "@/lib/dates";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

d("phase 3.1 — life snapshot and system prompt", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  const today = () => todayKey(TZ);

  beforeAll(async () => {
    user = await createTestUser();
    // A realistically loaded account: many tasks, a project with open work, goals, an exam and an
    // assignment, money, a workout and a calendar full of events.
    const project = await projects.createProject(user.id, projects.projectCreateSchema.parse({ name: "Portfolio revamp", status: "active", deadline: addDaysKey(today(), 20) }));
    for (let i = 0; i < 30; i++) {
      await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: `Task number ${i} with a deliberately long title to push the snapshot towards its budget`, dueDate: today(), priority: i % 2 ? "high" : "medium", projectId: i < 5 ? project.id : undefined }));
    }
    for (let i = 0; i < 10; i++) await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: `Overdue item ${i}`, dueDate: "2026-01-0" + ((i % 9) + 1) }));
    await goals.createGoal(user.id, goals.goalCreateSchema.parse({ name: "Train twice a week", category: "training", metricSource: "training", metricKind: "completed_workouts", metricPeriod: "week", metricTarget: 2 }), TZ);
    await goals.createGoal(user.id, goals.goalCreateSchema.parse({ name: "Read more", metricName: "books", metricUnit: "books", metricTarget: 12 }), TZ);
    await st.createExam(user.id, st.examSchema.parse({ title: "Goethe B1 written exam", date: addDaysKey(today(), 9) }));
    await st.createAssignment(user.id, st.assignmentSchema.parse({ title: "Statistics problem set", dueDate: addDaysKey(today(), 4) }));
    await st.logStudySession(user.id, st.studySessionSchema.parse({ subject: "alemán", durationMinutes: 40 }), TZ);
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "income", amount: 2000, category: "Salary", date: today() }), TZ);
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 55, category: "Food", date: today() }), TZ);
    await tr.logSet(user.id, tr.setSchema.parse({ exercise: "bench", weightKg: 60, reps: 8, date: today() }));
    for (let i = 0; i < 12; i++) {
      const day = addDaysKey(today(), i % 10);
      await cal.createEvent(user.id, cal.eventCreateSchema.parse({ title: `Meeting ${i} about the ongoing work`, kind: "work", startAt: `${day}T09:00:00`, endAt: `${day}T10:00:00` }));
    }
    await db.insert(aiReports).values({ userId: user.id, kind: "daily_review", periodKey: addDaysKey(today(), -1), content: "Yesterday you closed four tasks and skipped training." });
    await db.insert(aiReports).values({ userId: user.id, kind: "weekly_review", periodKey: "2026-W36", content: "Steady week: German on track, spending above average." });
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("keeps the snapshot and the whole system prompt inside the context budget", async () => {
    const snap = await lifeSnapshot(user, { sections: COMPACT_SECTIONS, horizonDays: 14, tz: TZ });
    const rendered = renderCompact(snap);
    const fitted = fitToBudget(rendered);
    expect(fitted.chars).toBeLessThanOrEqual(SNAPSHOT_BUDGET_CHARS);
    const prompt = await buildSystemPrompt(user);
    expect(prompt.length).toBeLessThan(SNAPSHOT_BUDGET_CHARS + 6000); // snapshot + fixed rules + memory
    // Clipping is never silent: either nothing was dropped, or the prompt says so.
    if (fitted.clipped > 0) expect(fitted.lines.at(-1)).toContain("omitted to stay within the context budget");
    // Long lists are summarised rather than dumped.
    expect(prompt).not.toContain("Task number 29");
  });

  it("the prompt carries projects, the next exam and assignment, and which reviews exist", async () => {
    const prompt = await buildSystemPrompt(user);
    expect(prompt).toContain("Active projects");
    expect(prompt).toContain("Portfolio revamp");
    expect(prompt).toContain("Goethe B1 written exam");
    expect(prompt).toContain("Statistics problem set");
    expect(prompt).toContain("Last reviews");
    expect(prompt).toContain("2026-W36");
    expect(prompt).toContain(addDaysKey(today(), -1)); // the latest daily review's period
  });

  it("the prompt states that the snapshot is partial and points at the retrieval tools", async () => {
    const prompt = await buildSystemPrompt(user);
    expect(prompt).toContain("get_snapshot");
    expect(prompt).toContain("is a summary, not the whole database");
    expect(prompt).toContain("Active goals");
    expect(prompt).toContain("Training today");
  });

  it("get_snapshot returns only the requested sections, and honours the horizon", async () => {
    const tool = getTool("get_snapshot");
    expect(tool).toBeTruthy();
    expect(tool!.risk).toBe("read");
    const r = await runTool(tool!, { sections: ["goals", "projects"], horizon: 3 }, { user, conversationId: null, confirmed: false });
    expect(r.status).toBe("success");
    const result = r.result as { sections: Record<string, unknown>; horizonDays: number };
    expect(Object.keys(result.sections).sort()).toEqual(["goals", "projects"]);
    expect(result.horizonDays).toBe(3);
    const all = await lifeSnapshot(user, { tz: TZ });
    expect(Object.keys(all.sections).sort()).toEqual([...SNAPSHOT_SECTIONS].sort());
    // The horizon actually changes what the calendar section carries.
    const near = await lifeSnapshot(user, { sections: ["calendar"], horizonDays: 0, tz: TZ });
    const far = await lifeSnapshot(user, { sections: ["calendar"], horizonDays: 14, tz: TZ });
    const ahead = (s: typeof near) => ((s.sections.calendar as { ahead: unknown[] }).ahead ?? []).length;
    expect(ahead(near)).toBe(0);
    expect(ahead(far)).toBeGreaterThan(0);
  });

  it("an empty account produces a valid snapshot and prompt instead of failing", async () => {
    const fresh = await createTestUser();
    try {
      const snap = await lifeSnapshot(fresh, { tz: TZ });
      expect(Object.keys(snap.sections)).toHaveLength(SNAPSHOT_SECTIONS.length);
      for (const [name, value] of Object.entries(snap.sections)) expect({ name, hasError: Boolean((value as { error?: string })?.error) }).toEqual({ name, hasError: false });
      const prompt = await buildSystemPrompt(fresh);
      expect(prompt).toContain("nothing scheduled");
      expect(prompt).toContain("none yet"); // no reviews yet
      expect(prompt).toContain("0 open");
      expect(prompt.length).toBeGreaterThan(500);
    } finally { await deleteTestUser(fresh.id); }
  });

  it("a failing section degrades that section only, never the whole snapshot", async () => {
    const snap = await lifeSnapshot({ ...user, id: "00000000-0000-0000-0000-000000000000" }, { sections: ["tasks", "goals"], tz: TZ });
    expect(Object.keys(snap.sections).sort()).toEqual(["goals", "tasks"]);
  });
});
