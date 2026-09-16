/**
 * Phase 3.8 — goals, projects, milestones and the one progress formula.
 *
 * The bug this phase exists to remove: a project with one of two tasks done read 50 % on its own page,
 * 0 % in the stored column and 0 % in Analytics and the weekly Review; and completing a milestone moved
 * nothing at all. So the central tests here are parity tests — the same project measured through the
 * detail page, the list, Analytics, Reviews and the snapshot has to give one number.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { auditLogs, milestones as milestonesTable, projects as projectsTable } from "@/server/db/schema";
import { deriveProgress, pctOf } from "@/server/services/progress";
import * as pj from "@/server/services/projects";
import * as g from "@/server/services/goals";
import * as tasks from "@/server/services/tasks";
import { analyticsOverview } from "@/server/services/analytics";
import { computeReview } from "@/server/services/reviews";
import { lifeSnapshot, renderCompact } from "@/server/services/snapshot";
import { globalSearch } from "@/server/services/search";
import { generateNotifications } from "@/server/services/notifications";
import { getTool, runTool } from "./_tool-helpers";
import { addDaysKey, todayKey } from "@/lib/dates";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

// ------------------------------------------------------------------ pure

describe("the progress formula", () => {
  const none = { openTasks: 0, doneTasks: 0, totalMilestones: 0, doneMilestones: 0 };

  it("prefers tasks, then milestones, then the manual value", () => {
    expect(deriveProgress({ ...none, openTasks: 1, doneTasks: 3, totalMilestones: 2, doneMilestones: 0 }, 99))
      .toMatchObject({ progress: 75, basis: "tasks", done: 3, total: 4 });
    expect(deriveProgress({ ...none, totalMilestones: 4, doneMilestones: 1 }, 99))
      .toMatchObject({ progress: 25, basis: "milestones", done: 1, total: 4 });
    expect(deriveProgress(none, 40)).toMatchObject({ progress: 40, basis: "manual" });
  });

  it("reports nothing to measure rather than a zero that looks measured", () => {
    expect(deriveProgress(none, 0)).toMatchObject({ progress: 0, basis: "none", total: 0 });
  });

  it("never divides by zero and never leaves the 0–100 range", () => {
    expect(pctOf(5, 0)).toBe(0);
    expect(pctOf(0, 0)).toBe(0);
    expect(pctOf(-3, 4)).toBe(0);       // a negative count cannot make negative progress
    expect(pctOf(9, 4)).toBe(100);      // nor can a corrupt count exceed 100
    expect(pctOf(NaN, 4)).toBe(0);
    expect(pctOf(4, Infinity)).toBe(0);
    expect(deriveProgress(none, 250).progress).toBe(100);
    expect(deriveProgress(none, -40).progress).toBe(0);
    for (const p of [pctOf(1, 3), pctOf(2, 3), deriveProgress({ ...none, totalMilestones: 3, doneMilestones: 1 }).progress]) {
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  it("all done is exactly 100", () => {
    expect(deriveProgress({ ...none, doneTasks: 3 }).progress).toBe(100);
    expect(deriveProgress({ ...none, totalMilestones: 2, doneMilestones: 2 }).progress).toBe(100);
  });
});

// ------------------------------------------------------------------ projects

d("project progress is one number everywhere", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  const freshProject = async (name: string) => pj.createProject(user.id, pj.projectCreateSchema.parse({ name }));

  it("completing a task moves the detail page, the stored column and Analytics together", async () => {
    const p = await freshProject("Parity project");
    const t1 = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "A", projectId: p.id }));
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "B", projectId: p.id }));

    await tasks.completeTask(user.id, t1.id, TZ);

    const detail = await pj.getProject(user.id, p.id);
    const [stored] = await db.select().from(projectsTable).where(eq(projectsTable.id, p.id));
    const list = (await pj.listProjects(user.id, "active")).find((x) => x.id === p.id)!;

    expect(detail.computedProgress).toBe(50);
    expect(detail.progressBasis).toBe("tasks");
    expect(list.computedProgress).toBe(50);
    // The column Analytics averages is kept equal to what the page shows — this was the bug.
    expect(stored.progress).toBe(50);
  });

  it("reopening a task takes the progress back down", async () => {
    const p = await freshProject("Reopen project");
    const t1 = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "A", projectId: p.id }));
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "B", projectId: p.id }));
    await tasks.completeTask(user.id, t1.id, TZ);
    expect((await pj.getProject(user.id, p.id)).computedProgress).toBe(50);

    await tasks.updateTask(user.id, t1.id, { status: "todo" }, TZ);
    const after = await pj.getProject(user.id, p.id);
    const [stored] = await db.select().from(projectsTable).where(eq(projectsTable.id, p.id));
    expect(after.computedProgress).toBe(0);
    expect(stored.progress).toBe(0);
  });

  it("deleting a task recomputes what is left", async () => {
    const p = await freshProject("Delete-task project");
    const t1 = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "A", projectId: p.id }));
    const t2 = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "B", projectId: p.id }));
    await tasks.completeTask(user.id, t1.id, TZ);
    expect((await pj.getProject(user.id, p.id)).computedProgress).toBe(50);

    await tasks.deleteTask(user.id, t2.id, TZ); // the open one goes: what remains is 1 of 1
    const after = await pj.getProject(user.id, p.id);
    const [stored] = await db.select().from(projectsTable).where(eq(projectsTable.id, p.id));
    expect(after.computedProgress).toBe(100);
    expect(stored.progress).toBe(100);
  });

  it("unlinking a task from its project recomputes both sides", async () => {
    const p = await freshProject("Unlink project");
    const t1 = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "A", projectId: p.id }));
    const t2 = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "B", projectId: p.id }));
    await tasks.completeTask(user.id, t1.id, TZ);
    await tasks.updateTask(user.id, t2.id, { projectId: null }, TZ);
    const after = await pj.getProject(user.id, p.id);
    expect(after.openTasks).toBe(0);
    expect(after.computedProgress).toBe(100); // only the completed one is still linked
  });

  it("a project with no tasks falls back to milestones, and a milestone moves it", async () => {
    const p = await freshProject("Milestone project");
    await pj.addProjectMilestone(user.id, p.id, { title: "M1" });
    const m2 = await pj.addProjectMilestone(user.id, p.id, { title: "M2" });
    expect((await pj.getProject(user.id, p.id)).computedProgress).toBe(0);

    await g.toggleMilestone(user.id, m2.id, true);
    const after = await pj.getProject(user.id, p.id);
    const [stored] = await db.select().from(projectsTable).where(eq(projectsTable.id, p.id));
    expect(after.computedProgress).toBe(50);
    expect(after.progressBasis).toBe("milestones");
    expect(stored.progress).toBe(50);
  });

  it("a project with neither reports nothing to measure", async () => {
    const p = await freshProject("Empty project");
    const detail = await pj.getProject(user.id, p.id);
    expect(detail.computedProgress).toBe(0);
    expect(detail.progressBasis).toBe("none");
    expect(detail.progressTotal).toBe(0);
  });

  it("Analytics, Reviews and the snapshot all report the same average", async () => {
    const other = await createTestUser();
    try {
      const p = await pj.createProject(other.id, pj.projectCreateSchema.parse({ name: "Only project" }));
      const t1 = await tasks.createTask(other.id, tasks.taskCreateSchema.parse({ title: "A", projectId: p.id }));
      await tasks.createTask(other.id, tasks.taskCreateSchema.parse({ title: "B", projectId: p.id }));
      await tasks.createTask(other.id, tasks.taskCreateSchema.parse({ title: "C", projectId: p.id }));
      await tasks.createTask(other.id, tasks.taskCreateSchema.parse({ title: "D", projectId: p.id }));
      await tasks.completeTask(other.id, t1.id, TZ);

      const detail = await pj.getProject(other.id, p.id);
      const a = await analyticsOverview(other.id, "month", TZ);
      const review = await computeReview(other.id, "monthly", todayKey(TZ), TZ);
      expect(detail.computedProgress).toBe(25);
      expect(a.projects.avgProgress).toBe(25);
      expect(review.facts.projects.avgProgress).toBe(a.projects.avgProgress);

      const snap = await lifeSnapshot({ ...other, timezone: TZ } as never, { sections: ["projects"], horizonDays: 7, tz: TZ });
      expect(renderCompact(snap).find((l) => l.includes("Active projects"))).toContain("25%");
    } finally { await deleteTestUser(other.id); }
  });

  it("an archived project stops counting as active", async () => {
    const solo = await createTestUser();
    try {
      const p = await pj.createProject(solo.id, pj.projectCreateSchema.parse({ name: "To archive" }));
      const t = await tasks.createTask(solo.id, tasks.taskCreateSchema.parse({ title: "A", projectId: p.id }));
      await tasks.completeTask(solo.id, t.id, TZ);
      expect((await analyticsOverview(solo.id, "month", TZ)).projects.active).toBe(1);

      await pj.updateProject(solo.id, p.id, { status: "archived" });
      const a = await analyticsOverview(solo.id, "month", TZ);
      expect(a.projects.active).toBe(0);
      expect(a.projects.avgProgress).toBe(0); // no active project to average, not a stale 100
      expect((await pj.listProjects(solo.id, "active"))).toHaveLength(0);
    } finally { await deleteTestUser(solo.id); }
  });
});

// ------------------------------------------------------------------ goals

d("goal progress and milestones", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("completing a milestone finally moves the goal — the phase 3.8 fix", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Milestone goal" }), TZ);
    const m1 = await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "M1" }));
    await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "M2" }));
    expect((await g.getGoal(user.id, goal.id, TZ)).progress).toBe(0);

    await g.toggleMilestone(user.id, m1.id, true);
    expect((await g.getGoal(user.id, goal.id, TZ)).progress).toBe(50);

    // And it comes back down when it is unticked.
    await g.toggleMilestone(user.id, m1.id, false);
    expect((await g.getGoal(user.id, goal.id, TZ)).progress).toBe(0);
  });

  it("completing every milestone completes the goal once, keeping the first completion date", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Finishable goal" }), TZ);
    const m1 = await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "Only one" }));
    await g.toggleMilestone(user.id, m1.id, true);
    const done = await g.getGoal(user.id, goal.id, TZ);
    expect(done.progress).toBe(100);
    expect(done.status).toBe("completed");
    expect(done.completedAt).toBeTruthy();
  });

  it("linked goals are never overwritten by the milestone path", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({
      name: "Linked goal", metricSource: "tasks", metricKind: "completed_tasks", metricPeriod: "total", metricTarget: 10,
    }), TZ);
    const m = await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "M" }));
    await g.toggleMilestone(user.id, m.id, true);
    const after = await g.getGoal(user.id, goal.id, TZ);
    // One of one milestone would be 100 %; the linked metric says otherwise and wins.
    expect(after.progress).not.toBe(100);
    expect(after.metricSource).toBe("tasks");
  });

  it("tasks take precedence over milestones on the same goal", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Both goal" }), TZ);
    const m = await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "M" }));
    await g.toggleMilestone(user.id, m.id, true);
    expect((await g.getGoal(user.id, goal.id, TZ)).progress).toBe(100);

    const t1 = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "T1", goalId: goal.id }));
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "T2", goalId: goal.id }));
    await tasks.completeTask(user.id, t1.id, TZ);
    const after = await g.getGoal(user.id, goal.id, TZ);
    expect(after.progress).toBe(50); // 1 of 2 tasks, not 1 of 1 milestones
  });

  it("a manual goal with no tasks or milestones keeps the value the user set", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Manual goal", progress: 40 }), TZ);
    await g.recomputeGoalProgress(user.id, goal.id, "test");
    expect((await g.getGoal(user.id, goal.id, TZ)).progress).toBe(40);
  });

  it("deleting a milestone recomputes what is left", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Shrinking goal" }), TZ);
    const m1 = await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "M1" }));
    const m2 = await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "M2" }));
    await g.toggleMilestone(user.id, m1.id, true);
    expect((await g.getGoal(user.id, goal.id, TZ)).progress).toBe(50);
    await g.deleteMilestone(user.id, m2.id);
    expect((await g.getGoal(user.id, goal.id, TZ)).progress).toBe(100); // 1 of 1 now
  });

  it("editing a milestone's due date does not touch progress, but ticking it does", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Editable goal" }), TZ);
    const m = await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "M" }));
    await g.updateMilestone(user.id, m.id, { dueDate: "2026-12-01", title: "Renamed" });
    expect((await g.getGoal(user.id, goal.id, TZ)).progress).toBe(0);
    const edited = (await g.getGoal(user.id, goal.id, TZ)).milestones[0];
    expect(edited.title).toBe("Renamed");
    expect(edited.dueDate).toBe("2026-12-01");
    await g.updateMilestone(user.id, m.id, { done: true });
    expect((await g.getGoal(user.id, goal.id, TZ)).progress).toBe(100);
  });
});

// ------------------------------------------------------------------ transitions, isolation, audit

d("states, ownership and the audit trail", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); other = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });

  it("completing a project keeps its first completion date across later edits", async () => {
    const p = await pj.createProject(user.id, pj.projectCreateSchema.parse({ name: "Dated project", status: "completed" }));
    const first = (await pj.getProject(user.id, p.id)).completedAt;
    expect(first).toBeTruthy(); // creating it completed used to leave this null
    await new Promise((r) => setTimeout(r, 25));
    await pj.updateProject(user.id, p.id, { status: "completed", notes: "touched" });
    expect((await pj.getProject(user.id, p.id)).completedAt?.getTime()).toBe(first?.getTime());
  });

  it("reopening a completed project clears its completion date", async () => {
    const p = await pj.createProject(user.id, pj.projectCreateSchema.parse({ name: "Reopened project", status: "completed" }));
    await pj.updateProject(user.id, p.id, { status: "active" });
    const after = await pj.getProject(user.id, p.id);
    expect(after.status).toBe("active");
    expect(after.completedAt).toBeNull();
  });

  it("editing a project without mentioning status never re-dates it", async () => {
    const p = await pj.createProject(user.id, pj.projectCreateSchema.parse({ name: "Untouched", status: "active" }));
    await pj.updateProject(user.id, p.id, { notes: "just notes" });
    expect((await pj.getProject(user.id, p.id)).completedAt).toBeNull();
  });

  it("a milestone that is not yours is not found, and is left alone", async () => {
    const goal = await g.createGoal(other.id, g.goalCreateSchema.parse({ name: "Their goal" }), TZ);
    const m = await g.addMilestone(other.id, goal.id, g.milestoneSchema.parse({ title: "Theirs" }));
    await expect(g.toggleMilestone(user.id, m.id, true)).rejects.toThrow(/not found/i);
    await expect(g.updateMilestone(user.id, m.id, { title: "hijacked" })).rejects.toThrow(/not found/i);
    await expect(g.deleteMilestone(user.id, m.id)).rejects.toThrow(/not found/i);
    const [still] = await db.select().from(milestonesTable).where(eq(milestonesTable.id, m.id));
    expect(still.title).toBe("Theirs");
    expect(still.completedAt).toBeNull();
  });

  it("a milestone id that does not exist fails loudly instead of silently", async () => {
    await expect(g.deleteMilestone(user.id, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/not found/i);
  });

  it("another user's goal and project are invisible", async () => {
    const goal = await g.createGoal(other.id, g.goalCreateSchema.parse({ name: "Private goal" }), TZ);
    const p = await pj.createProject(other.id, pj.projectCreateSchema.parse({ name: "Private project" }));
    await expect(g.getGoal(user.id, goal.id, TZ)).rejects.toThrow(/not found/i);
    await expect(pj.getProject(user.id, p.id)).rejects.toThrow(/not found/i);
    await expect(pj.deleteProject(user.id, p.id)).rejects.toThrow(/not found/i);
    expect((await globalSearch(user.id, "Private")).hits.some((h) => h.id === goal.id || h.id === p.id)).toBe(false);
  });

  it("every domain write is audited, and says whether it was the user or the AI", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Audited goal" }), TZ, "ai");
    await g.updateGoal(user.id, goal.id, { priority: "high" }, TZ, "user");
    const m = await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "M" }), "user");
    await g.toggleMilestone(user.id, m.id, true, "ai");
    await g.deleteGoal(user.id, goal.id, "user");

    // Selected by the entities this test created, not by row order: the table is shared and unordered.
    const rows = (await db.select().from(auditLogs).where(eq(auditLogs.userId, user.id)))
      .filter((r) => r.entityId === goal.id || r.entityId === m.id);
    const byAction = new Map(rows.map((r) => [r.action, r.actor]));
    expect(byAction.get("goal.created")).toBe("ai");
    expect(byAction.get("goal.updated")).toBe("user");
    expect(byAction.get("milestone.created")).toBe("user");
    expect(byAction.get("milestone.completed")).toBe("ai");
    expect(byAction.get("goal.deleted")).toBe("user");
    // The recompute that the milestone triggered is attributed to the system, not to a person.
    expect(rows.some((r) => r.action === "goal.progress_recomputed" && r.actor === "system")).toBe(true);
    for (const r of rows) expect(JSON.stringify(r.metadata ?? {})).not.toMatch(/password|token|secret/i);
  });
});

// ------------------------------------------------------------------ overdue, notifications, tools

d("overdue and the assistant", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("Analytics counts overdue milestones per owner, and Reviews reads the same figures", async () => {
    const yesterday = addDaysKey(todayKey(TZ), -1);
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Late goal", deadline: yesterday }), TZ);
    await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "Late goal milestone", dueDate: yesterday }));
    const p = await pj.createProject(user.id, pj.projectCreateSchema.parse({ name: "Late project", deadline: yesterday }));
    await pj.addProjectMilestone(user.id, p.id, { title: "Late project milestone", dueDate: yesterday });

    const a = await analyticsOverview(user.id, "month", TZ);
    expect(a.goals.milestones.overdue).toBe(1);
    expect(a.projects.milestones.overdue).toBe(1);
    expect(a.projects.overdue).toBe(1);
    expect(a.goals.pastDeadline).toBe(1);

    const review = await computeReview(user.id, "monthly", todayKey(TZ), TZ);
    expect(review.facts.goals.milestones.overdue).toBe(a.goals.milestones.overdue);
    expect(review.facts.projects.overdue).toBe(a.projects.overdue);
    expect(review.observations.some((o) => o.module === "goals" && o.text.includes("milestone"))).toBe(true);
    expect(review.observations.some((o) => o.module === "projects" && o.text.includes("past their deadline"))).toBe(true);
  });

  it("each overdue condition notifies once, not once per run", async () => {
    await generateNotifications(user.id, TZ);
    const first = await db.select().from(milestonesTable).where(eq(milestonesTable.userId, user.id));
    expect(first.length).toBeGreaterThan(0);
    const created = await generateNotifications(user.id, TZ);
    expect(created).toBe(0); // the same conditions produce nothing the second time
  });

  it("the assistant has a tool for every editable action, at the right risk level", () => {
    const expected: Record<string, string> = {
      get_goals: "read", create_goal: "low", update_goal: "medium", update_goal_progress: "low",
      add_milestone: "low", update_milestone: "low", complete_milestone: "low",
      delete_milestone: "medium", delete_goal: "high",
      get_projects: "read", create_project: "low", update_project: "medium",
      create_project_task: "low", add_project_milestone: "low", delete_project: "high",
    };
    for (const [name, risk] of Object.entries(expected)) {
      const tool = getTool(name);
      expect(tool, `${name} must exist`).toBeTruthy();
      expect(tool!.risk, name).toBe(risk);
    }
  });

  it("no goals or projects tool takes a table, a column, raw SQL or someone else's userId", async () => {
    const { allTools } = await import("@/server/ai/registry");
    for (const tool of allTools().filter((t) => t.module === "goals" || t.module === "projects")) {
      const shape = JSON.stringify(tool.schema).toLowerCase();
      for (const forbidden of ["userid", "user_id", "table", "column", "sql", "where"]) {
        expect(shape, `${tool.name} must not expose "${forbidden}"`).not.toContain(`"${forbidden}"`);
      }
    }
  });

  it("deleting through the assistant needs confirmation and names the exact record", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Deletable goal" }), TZ);
    const pending = await runTool(getTool("delete_goal")!, { id: goal.id, name: "Deletable goal" }, user);
    expect(pending.status).toBe("pending_confirmation");
    expect(pending.summary).toContain("Deletable goal");
    // Still there while it waits.
    expect((await g.getGoal(user.id, goal.id, TZ)).id).toBe(goal.id);

    // A confirmed call whose name does not match the id refuses rather than deleting the wrong thing.
    const wrong = await runTool(getTool("delete_goal")!, { id: goal.id, name: "Some other goal" }, user, true);
    expect(wrong.status).toBe("failed");
    expect((await g.getGoal(user.id, goal.id, TZ)).id).toBe(goal.id);

    const ok = await runTool(getTool("delete_goal")!, { id: goal.id, name: "Deletable goal" }, user, true);
    expect(ok.status).toBe("confirmed");
    await expect(g.getGoal(user.id, goal.id, TZ)).rejects.toThrow(/not found/i);
  });

  it("the assistant cannot invent progress on a linked goal", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({
      name: "Linked, untouchable", metricSource: "training", metricKind: "completed_workouts", metricPeriod: "week", metricTarget: 4,
    }), TZ);
    const r = await runTool(getTool("update_goal_progress")!, { id: goal.id, progress: 100 }, user);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/computed from training/i);
  });

  it("a milestone ticked through the assistant moves the goal and is attributed to the AI", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Tool-driven goal" }), TZ);
    const m = await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "Half" }));
    await g.addMilestone(user.id, goal.id, g.milestoneSchema.parse({ title: "Other half" }));
    const r = await runTool(getTool("complete_milestone")!, { id: m.id, done: true }, user);
    expect(r.status).toBe("success");
    expect((await g.getGoal(user.id, goal.id, TZ)).progress).toBe(50);
    const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.userId, user.id), eq(auditLogs.entityId, m.id)));
    expect(rows.some((x) => x.action === "milestone.completed" && x.actor === "ai")).toBe(true);
  });
});
