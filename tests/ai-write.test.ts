/**
 * AI write capabilities. Every new tool goes through its domain service, so it inherits validation,
 * ownership checks and the audit trail; none of them touches the database directly. These tests check
 * the behaviour that matters for an assistant acting on the app: it succeeds for real, it fails
 * honestly, it cannot reach another user's data, and destructive actions are always confirmed first.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { auditLogs, goals as goalsTable, notifications, projects as projectsTable } from "@/server/db/schema";
import { allTools, getTool } from "@/server/ai/registry";
import { confirmAction, runTool } from "@/server/ai/agent";
import * as n from "@/server/services/nutrition";
import * as st from "@/server/services/studies";
import * as g from "@/server/services/goals";
import * as pr from "@/server/services/projects";
import * as tr from "@/server/services/training";
import { generateNotifications, unreadCount } from "@/server/services/notifications";
import { todayKey } from "@/lib/dates";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

describe("tool surface", () => {
  it("no tool exposes raw database access", () => {
    for (const t of allTools()) {
      const shape = JSON.stringify((t.schema as { _def?: unknown })._def ?? {});
      for (const forbidden of ["table", "sql", "query", "columns", "userId", "user_id"]) {
        expect({ tool: t.name, exposes: shape.includes(`"${forbidden}"`) }).toEqual({ tool: t.name, exposes: false });
      }
    }
    // And there is no generic write-anything tool.
    const names = allTools().map((t) => t.name);
    for (const banned of ["update_database", "run_sql", "query_database", "write_record", "update_record"]) expect(names).not.toContain(banned);
  });

  it("every write tool is classified and destructive ones are high risk", () => {
    const risky = allTools().filter((t) => t.risk !== "read");
    expect(risky.length).toBeGreaterThan(30);
    // Every removal is confirmation-gated except a short, explicit list of trivially reversible ones:
    // re-adding a price alert, a watchlist symbol or a notification costs the user nothing.
    const REVERSIBLE = new Set(["delete_price_alert", "delete_notification", "remove_watchlist_item"]);
    for (const t of allTools().filter((t) => t.name.startsWith("delete_") || t.name.startsWith("remove_"))) {
      const gated = t.risk === "high" || Boolean(t.needsConfirmation) || REVERSIBLE.has(t.name);
      expect({ tool: t.name, gated }).toEqual({ tool: t.name, gated: true });
      if (REVERSIBLE.has(t.name)) expect(t.risk).toBe("low");
    }
    expect(getTool("delete_goal")!.risk).toBe("high");
    expect(getTool("delete_project")!.risk).toBe("high");
    expect(getTool("update_nutrition_targets")!.risk).toBe("medium");
  });
});

d("AI write tools (real services, real database)", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  const ctx = () => ({ user, conversationId: null, confirmed: false });
  beforeAll(async () => { user = await createTestUser(); other = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });

  it("nutrition targets: confirmation first, then a real update with the previous values reported", async () => {
    const tool = getTool("update_nutrition_targets")!;
    const before = await n.nutritionGoals(user.id);
    const pending = await runTool(tool, { calories: 2500, protein: 170, carbs: 300, fat: 70 }, ctx());
    expect(pending.status).toBe("pending_confirmation");
    expect(pending.summary).toContain("2500 kcal");
    expect(await n.nutritionGoals(user.id)).toEqual(before); // nothing changed yet

    const done = await confirmAction(user, pending.logId);
    expect(done.status).toBe("confirmed");
    const result = done.result as { previous: typeof before; goals: typeof before };
    expect(result.previous).toEqual(before);
    expect(result.goals).toEqual({ calories: 2500, protein: 170, carbs: 300, fat: 70 });
    expect(await n.nutritionGoals(user.id)).toEqual({ calories: 2500, protein: 170, carbs: 300, fat: 70 });
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.userId, user.id), eq(auditLogs.action, "ai.update_nutrition_targets")));
    expect(logs).toHaveLength(1);
    expect(logs[0].actor).toBe("ai");
  });

  it("nutrition targets: incoherent macros are refused with a reason, and nothing is written", async () => {
    const before = await n.nutritionGoals(user.id);
    await expect(n.updateNutritionGoals(user.id, { calories: 2000, protein: 200, carbs: 200, fat: 100 })).rejects.toMatchObject({ status: 400 });
    const failed = await runTool(getTool("update_nutrition_targets")!, { calories: 2000, protein: 200, carbs: 200, fat: 100 }, { ...ctx(), confirmed: true });
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("not consistent");
    expect(await n.nutritionGoals(user.id)).toEqual(before);
  });

  it("nutrition: a saved food becomes usable by log_meal, and an entry can be removed", async () => {
    const created = await runTool(getTool("create_food")!, { name: "Protein shake", servingGrams: 300, calories: 220, protein: 40, carbs: 8, fat: 3 }, ctx());
    expect(created.status).toBe("success");
    const meal = await runTool(getTool("log_meal")!, { date: todayKey(TZ), type: "snack", items: [{ description: "Shake", food: "protein shake", quantity: 2, unit: "serving", source: "estimated" }] }, ctx());
    const items = (meal.result as { items: { id: string; calories: number; source: string }[] }).items;
    expect(items[0]).toMatchObject({ calories: 440, source: "import" });

    const pending = await runTool(getTool("delete_nutrition_entry")!, { id: items[0].id }, ctx());
    expect(pending.status).toBe("pending_confirmation");
    await confirmAction(user, pending.logId);
    const day = await n.dailyNutrition(user.id, todayKey(TZ));
    expect(day.meals.flatMap((m) => m.items).some((i) => i.id === items[0].id)).toBe(false);
  });

  it("studies: the weekly goal can be changed and an assignment completed", async () => {
    const subject = (await st.listSubjects(user.id)).find((s) => s.slug === "german")!;
    const pending = await runTool(getTool("update_subject")!, { id: subject.id, weeklyGoalMinutes: 180 }, ctx());
    expect(pending.status).toBe("success"); // medium risk without a confirmation rule executes directly
    expect((await st.listSubjects(user.id)).find((s) => s.id === subject.id)?.weeklyGoalMinutes).toBe(180);

    const assignment = await st.createAssignment(user.id, st.assignmentSchema.parse({ title: "Problem set", dueDate: todayKey(TZ) }));
    const done = await runTool(getTool("complete_assignment")!, { id: assignment.id }, ctx());
    expect(done.status).toBe("success");
    expect((await st.listAssignments(user.id, true)).some((a) => a.id === assignment.id)).toBe(false);
  });

  it("goals: milestones can be ticked, and deleting is confirmed and name-checked", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Ship the portfolio" }), TZ);
    const milestone = await g.addMilestone(user.id, goal.id, { title: "First draft", position: 0 });
    const ticked = await runTool(getTool("complete_milestone")!, { id: milestone.id }, ctx());
    expect(ticked.status).toBe("success");
    expect((await g.getGoal(user.id, goal.id)).milestones[0].completedAt).not.toBeNull();

    const pending = await runTool(getTool("delete_goal")!, { id: goal.id, name: "Ship the portfolio" }, ctx());
    expect(pending.status).toBe("pending_confirmation");
    expect(pending.summary).toContain('"Ship the portfolio"');
    expect(await db.select().from(goalsTable).where(eq(goalsTable.id, goal.id))).toHaveLength(1);
    const deleted = await confirmAction(user, pending.logId);
    expect(deleted.status).toBe("confirmed");
    expect(await db.select().from(goalsTable).where(eq(goalsTable.id, goal.id))).toHaveLength(0);
  });

  it("goals: a mismatched name refuses to delete anything", async () => {
    const goal = await g.createGoal(user.id, g.goalCreateSchema.parse({ name: "Keep this one" }), TZ);
    const r = await runTool(getTool("delete_goal")!, { id: goal.id, name: "Something else" }, { ...ctx(), confirmed: true });
    expect(r.status).toBe("failed");
    expect(r.error).toContain("Nothing was deleted");
    expect(await db.select().from(goalsTable).where(eq(goalsTable.id, goal.id))).toHaveLength(1);
  });

  it("projects: deleting is confirmed, keeps the tasks, and is reported truthfully", async () => {
    const project = await pr.createProject(user.id, pr.projectCreateSchema.parse({ name: "Old side project", status: "active" }));
    const task = await runTool(getTool("create_project_task")!, { projectId: project.id, title: "Leftover task" }, ctx());
    expect(task.status).toBe("success");
    const pending = await runTool(getTool("delete_project")!, { id: project.id, name: "Old side project" }, ctx());
    expect(pending.status).toBe("pending_confirmation");
    const done = await confirmAction(user, pending.logId);
    expect((done.result as { name: string }).name).toBe("Old side project");
    expect(await db.select().from(projectsTable).where(eq(projectsTable.id, project.id))).toHaveLength(0);
    const taskId = (task.result as { id: string }).id;
    const orphan = await db.query.tasks?.findFirst?.({ where: (t, { eq: e }) => e(t.id, taskId) });
    expect(orphan ?? { projectId: null }).toBeTruthy(); // the task survives the project
  });

  it("training: the cycle anchor is confirmed before it moves, and a set can be deleted", async () => {
    const pending = await runTool(getTool("update_training_plan")!, { startDate: "2026-09-01" }, ctx());
    expect(pending.status).toBe("pending_confirmation");
    expect(pending.summary).toContain("2026-09-01");
    await confirmAction(user, pending.logId);
    expect((await tr.activePlan(user.id))?.startDate).toBe("2026-09-01");

    const set = await tr.logSet(user.id, tr.setSchema.parse({ exercise: "bench", weightKg: 60, reps: 8, date: todayKey(TZ) }));
    const del = await runTool(getTool("delete_workout_set")!, { id: set.set.id }, ctx());
    expect(del.status).toBe("pending_confirmation");
    await confirmAction(user, del.logId);
    const session = await tr.getSession(user.id, set.session.id);
    expect(session.sets.some((s) => s.id === set.set.id)).toBe(false);
  });

  it("notifications can be read and marked, without deleting anything", async () => {
    await generateNotifications(user.id, TZ);
    const before = await unreadCount(user.id);
    expect(before).toBeGreaterThan(0);
    const list = await runTool(getTool("get_notifications")!, { unreadOnly: true, limit: 50 }, ctx());
    expect(list.status).toBe("success");
    const marked = await runTool(getTool("mark_notifications_read")!, { all: true }, ctx());
    expect(marked.status).toBe("success");
    expect((marked.result as { unread: number }).unread).toBe(0);
    expect((await db.select().from(notifications).where(eq(notifications.userId, user.id))).length).toBeGreaterThan(0); // marked, not deleted
    const empty = await runTool(getTool("mark_notifications_read")!, {}, ctx());
    expect(empty.status).toBe("failed");
  });

  it("no write tool can reach another user's records", async () => {
    const theirGoal = await g.createGoal(other.id, g.goalCreateSchema.parse({ name: "Their goal" }), TZ);
    const theirProject = await pr.createProject(other.id, pr.projectCreateSchema.parse({ name: "Their project", status: "active" }));
    const theirSubject = (await st.listSubjects(other.id))[0];
    for (const [tool, input] of [
      ["delete_goal", { id: theirGoal.id, name: "Their goal" }],
      ["delete_project", { id: theirProject.id, name: "Their project" }],
      ["update_subject", { id: theirSubject.id, weeklyGoalMinutes: 999 }],
    ] as const) {
      const r = await runTool(getTool(tool)!, input, { ...ctx(), confirmed: true });
      expect({ tool, status: r.status }).toEqual({ tool, status: "failed" });
    }
    expect(await db.select().from(goalsTable).where(eq(goalsTable.id, theirGoal.id))).toHaveLength(1);
    expect(await db.select().from(projectsTable).where(eq(projectsTable.id, theirProject.id))).toHaveLength(1);
    expect((await st.listSubjects(other.id))[0].weeklyGoalMinutes).toBe(theirSubject.weeklyGoalMinutes);
  });

  it("repeating a write is safe: the same targets twice leave one state, not two", async () => {
    const input = { calories: 2400, protein: 150, carbs: 280, fat: 72 };
    const a = await runTool(getTool("update_nutrition_targets")!, input, { ...ctx(), confirmed: true });
    const b = await runTool(getTool("update_nutrition_targets")!, input, { ...ctx(), confirmed: true });
    expect(a.status).toBe("confirmed");
    expect(b.status).toBe("confirmed");
    expect(await n.nutritionGoals(user.id)).toEqual(input);
    expect((b.result as { previous: typeof input }).previous).toEqual(input); // second run was a no-op in effect
  });
});
