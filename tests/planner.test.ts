/**
 * Phase 3.2b — persistent planner. A plan is a proposal: creating one never touches tasks or events,
 * acceptance is the user's explicit action, and accepting twice can never duplicate anything. No AI
 * tool can accept or apply a plan.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { conversations, events, planItems, plans, tasks } from "@/server/db/schema";
import * as planner from "@/server/services/planner";
import * as taskService from "@/server/services/tasks";
import * as cal from "@/server/services/calendar";
import * as projects from "@/server/services/projects";
import * as goalService from "@/server/services/goals";
import { allTools, getTool } from "@/server/ai/registry";
import { runTool } from "@/server/ai/agent";
import { lifeSnapshot } from "@/server/services/snapshot";
import { conversationExpiry, purgeExpiredConversations } from "@/server/services/conversations";
import { addDaysKey, isoWeekKey, todayKey } from "@/lib/dates";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

d("phase 3.2b — persistent planner", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  const today = () => todayKey(TZ);
  const countTasks = (userId: string) => db.select().from(tasks).where(eq(tasks.userId, userId)).then((r) => r.length);
  const countEvents = (userId: string) => db.select().from(events).where(eq(events.userId, userId)).then((r) => r.length);
  const draft = (over: Partial<planner.PlanDraftInput> = {}) =>
    planner.planDraftSchema.parse({
      horizon: "day", content: "Focus on the exam, train after work.",
      items: [
        { kind: "task", title: "Finish the statistics problem set", date: today(), priority: "high" },
        { kind: "event", title: "Gym", startAt: `${today()}T19:00:00`, endAt: `${today()}T20:30:00`, eventKind: "training" },
        { kind: "note", title: "Sleep before midnight" },
      ],
      ...over,
    });

  beforeAll(async () => { user = await createTestUser(); other = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });

  it("creating a draft stores the plan and its items, and creates nothing real", async () => {
    const tasksBefore = await countTasks(user.id), eventsBefore = await countEvents(user.id);
    const plan = await planner.createDraft(user, draft(), { tz: TZ });
    expect(plan).toMatchObject({ status: "draft", horizon: "day", periodKey: today(), source: "ai" });
    expect(plan.items).toHaveLength(3);
    expect(plan.items.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(plan.items.every((i) => i.status === "proposed" && !i.createdTaskId && !i.createdEventId)).toBe(true);
    expect(await countTasks(user.id)).toBe(tasksBefore);
    expect(await countEvents(user.id)).toBe(eventsBefore);
  });

  it("reading a draft returns it by id and as the plan in force for the period", async () => {
    const plan = await planner.createDraft(user, draft({ title: "Tuesday" }), { tz: TZ });
    const byId = await planner.getPlan(user.id, plan.id);
    expect(byId.title).toBe("Tuesday");
    expect(byId.items.map((i) => i.title)).toEqual(plan.items.map((i) => i.title));
    const current = await planner.currentPlan(user.id, { horizon: "day", tz: TZ });
    expect(current?.id).toBe(plan.id);
    expect(await planner.getPlan(user.id, plan.id).then((p) => p.items.length)).toBe(3);
    await expect(planner.getPlan(other.id, plan.id)).rejects.toMatchObject({ status: 404 });
    expect(await planner.currentPlan(other.id, { horizon: "day", tz: TZ })).toBeNull();
  });

  it("a new draft for the same period supersedes the previous draft, week plans are independent", async () => {
    const first = await planner.createDraft(user, draft(), { tz: TZ });
    const second = await planner.createDraft(user, draft(), { tz: TZ });
    expect((await planner.getPlan(user.id, first.id)).status).toBe("superseded");
    expect((await planner.currentPlan(user.id, { horizon: "day", tz: TZ }))?.id).toBe(second.id);
    const week = await planner.createDraft(user, draft({ horizon: "week" }), { tz: TZ });
    expect(week.periodKey).toBe(isoWeekKey(new Date(today() + "T12:00:00")));
    expect((await planner.getPlan(user.id, second.id)).status).toBe("draft"); // the day plan is untouched
    expect((await planner.currentPlan(user.id, { horizon: "week", tz: TZ }))?.id).toBe(week.id);
  });

  it("accepting materialises each item through the real services, keeping project and goal links", async () => {
    const project = await projects.createProject(user.id, projects.projectCreateSchema.parse({ name: "Thesis", status: "active" }));
    const goal = await goalService.createGoal(user.id, goalService.goalCreateSchema.parse({ name: "Submit the thesis", metricName: "chapters", metricUnit: "chapters", metricTarget: 5 }), TZ);
    const plan = await planner.createDraft(user, planner.planDraftSchema.parse({
      horizon: "day", content: "Thesis day",
      items: [
        { kind: "task", title: "Write chapter 3", date: today(), priority: "urgent", projectId: project.id, goalId: goal.id },
        { kind: "event", title: "Deep work", startAt: `${today()}T09:00:00`, endAt: `${today()}T12:00:00`, eventKind: "work", projectId: project.id },
        { kind: "note", title: "No phone in the morning" },
      ],
    }), { tz: TZ });

    const { plan: accepted, results } = await planner.acceptPlan(user, plan.id);
    expect(results.map((r) => r.status)).toEqual(["created", "created", "created"]);
    expect(accepted.status).toBe("accepted");
    expect(accepted.acceptedAt).not.toBeNull();

    const taskItem = accepted.items.find((i) => i.kind === "task")!;
    const eventItem = accepted.items.find((i) => i.kind === "event")!;
    expect(taskItem.createdTaskId).toBeTruthy();
    expect(eventItem.createdEventId).toBeTruthy();
    const createdTask = await taskService.getTask(user.id, taskItem.createdTaskId!);
    expect(createdTask).toMatchObject({ title: "Write chapter 3", dueDate: today(), priority: "urgent", projectId: project.id, goalId: goal.id, source: "ai" });
    const createdEvent = await cal.getEvent(user.id, eventItem.createdEventId!);
    expect(createdEvent).toMatchObject({ title: "Deep work", kind: "work", projectId: project.id, source: "ai" });
    expect(accepted.items.every((i) => i.status === "accepted")).toBe(true);
  });

  it("accepting twice is idempotent: no duplicated tasks or events", async () => {
    const plan = await planner.createDraft(user, draft(), { tz: TZ });
    const tasksBefore = await countTasks(user.id), eventsBefore = await countEvents(user.id);
    const first = await planner.acceptPlan(user, plan.id);
    expect(first.results.filter((r) => r.status === "created")).toHaveLength(3);
    expect(await countTasks(user.id)).toBe(tasksBefore + 1);
    expect(await countEvents(user.id)).toBe(eventsBefore + 1);

    const second = await planner.acceptPlan(user, plan.id);
    expect(second.results.every((r) => r.status === "already_created" || r.status === "skipped")).toBe(true);
    expect(await countTasks(user.id)).toBe(tasksBefore + 1);
    expect(await countEvents(user.id)).toBe(eventsBefore + 1);
    const third = await planner.acceptPlan(user, plan.id);
    expect(third.results.some((r) => r.status === "created")).toBe(false);
    expect(await countTasks(user.id)).toBe(tasksBefore + 1);
  });

  it("partial acceptance and rejection move the plan through its states", async () => {
    const plan = await planner.createDraft(user, draft(), { tz: TZ });
    const [firstItem] = plan.items;
    const { plan: partial } = await planner.acceptPlan(user, plan.id, { itemIds: [firstItem.id] });
    expect(partial.status).toBe("partially_accepted");
    expect(partial.items.filter((i) => i.status === "proposed")).toHaveLength(2);

    const rejected = await planner.rejectPlan(user, plan.id);
    expect(rejected.status).toBe("partially_accepted"); // one item is already real, so it is not a plain rejection
    expect(rejected.items.filter((i) => i.status === "rejected")).toHaveLength(2);
    expect(rejected.items.find((i) => i.id === firstItem.id)?.status).toBe("accepted");
    // A fully rejected plan cannot be accepted afterwards.
    const fresh = await planner.createDraft(user, draft({ horizon: "week" }), { tz: TZ });
    const gone = await planner.rejectPlan(user, fresh.id);
    expect(gone.status).toBe("rejected");
    await expect(planner.acceptPlan(user, fresh.id)).rejects.toMatchObject({ status: 400 });
  });

  it("a failing item is reported as failed and stays proposed, and nothing is silently claimed", async () => {
    const plan = await planner.createDraft(user, draft({ horizon: "day", periodKey: addDaysKey(today(), 5) }), { tz: TZ });
    // Bypasses the draft schema on purpose to simulate an item the task service will refuse (empty title),
    // which is what a real materialisation failure looks like from acceptPlan's point of view.
    const [broken] = await db.insert(planItems).values({ userId: user.id, planId: plan.id, position: 9, kind: "task", title: "", date: today() }).returning();
    const { plan: after, results } = await planner.acceptPlan(user, plan.id, { itemIds: [broken.id] });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toBeTruthy();
    const stored = after.items.find((i) => i.id === broken.id)!;
    expect(stored.status).toBe("proposed"); // handed back, not left half-accepted
    expect(stored.createdTaskId).toBeNull();
    expect(after.status).toBe("draft"); // nothing was accepted, so the plan did not move
  });

  it("a draft cannot reference a project or goal that does not exist", async () => {
    await expect(planner.createDraft(user, planner.planDraftSchema.parse({
      horizon: "day", periodKey: addDaysKey(today(), 6), content: "Phantom project",
      items: [{ kind: "task", title: "Task for nobody", date: today(), projectId: "00000000-0000-0000-0000-000000000000" }],
    }), { tz: TZ })).rejects.toThrow();
  });

  it("propose_plan only writes a draft, and no AI tool can accept or apply a plan", async () => {
    const tool = getTool("propose_plan")!;
    expect(tool.risk).toBe("low");
    const tasksBefore = await countTasks(user.id), eventsBefore = await countEvents(user.id);
    const r = await runTool(tool, { horizon: "day", periodKey: addDaysKey(today(), 1), content: "Tomorrow", items: [{ kind: "task", title: "Call the dentist", date: addDaysKey(today(), 1) }] }, { user, conversationId: null, confirmed: false });
    expect(r.status).toBe("success");
    const result = r.result as { id: string; status: string; note: string };
    expect(result.status).toBe("draft");
    expect(result.note).toContain("Nothing was created");
    expect(await countTasks(user.id)).toBe(tasksBefore);
    expect(await countEvents(user.id)).toBe(eventsBefore);
    const stored = await planner.getPlan(user.id, result.id);
    expect(stored.items[0]).toMatchObject({ title: "Call the dentist", status: "proposed", createdTaskId: null });

    // There is no tool that accepts, applies or materialises a plan.
    const names = allTools().map((t) => t.name);
    expect(names).toContain("propose_plan");
    expect(names).toContain("get_plan");
    for (const forbidden of ["accept_plan", "apply_plan", "confirm_plan", "materialize_plan", "materialise_plan", "execute_plan"]) expect(names).not.toContain(forbidden);
    expect(allTools().filter((t) => t.module === "planner").map((t) => t.name)).toEqual(["propose_plan", "get_plan"]);
    expect(new Set(names).size).toBe(names.length); // no duplicate tool names
  });

  it("get_plan reads back what was proposed, by id and by period", async () => {
    const plan = await planner.createDraft(user, draft({ horizon: "day", periodKey: addDaysKey(today(), 2) }), { tz: TZ });
    const tool = getTool("get_plan")!;
    expect(tool.risk).toBe("read");
    const byId = await runTool(tool, { planId: plan.id }, { user, conversationId: null, confirmed: false });
    expect((byId.result as { id: string }).id).toBe(plan.id);
    const byPeriod = await runTool(tool, { horizon: "day", periodKey: addDaysKey(today(), 2) }, { user, conversationId: null, confirmed: false });
    expect((byPeriod.result as { id: string }).id).toBe(plan.id);
    const none = await runTool(tool, { horizon: "day", periodKey: "1999-01-01" }, { user, conversationId: null, confirmed: false });
    expect(none.result).toBeNull();
  });

  it("the plan shows up in the life snapshot without inflating it", async () => {
    const plan = await planner.createDraft(user, draft(), { tz: TZ });
    const snap = await lifeSnapshot(user, { sections: ["plan"], tz: TZ });
    const section = snap.sections.plan as { day: { id: string; status: string; pendingItems: number } | null; draftsAwaitingAnswer: number };
    expect(section.day?.id).toBe(plan.id);
    expect(section.day?.status).toBe("draft");
    expect(section.day?.pendingItems).toBe(3);
    expect(section.draftsAwaitingAnswer).toBeGreaterThan(0);
  });

  it("a plan outlives the conversation that produced it (24 h retention of phase 3.2a)", async () => {
    const [conv] = await db.insert(conversations).values({ userId: user.id, kind: "planner", title: "Plan my day", expiresAt: new Date(Date.now() - 1000) }).returning();
    const plan = await planner.createDraft(user, draft({ horizon: "week" }), { conversationId: conv.id, tz: TZ });
    expect(plan.conversationId).toBe(conv.id);
    await purgeExpiredConversations();
    const after = await planner.getPlan(user.id, plan.id);
    expect(after.conversationId).toBeNull(); // ON DELETE SET NULL
    expect(after.items).toHaveLength(3);
    expect(after.status).toBe("draft");
    // And a live conversation is still untouched by any of this.
    const [live] = await db.insert(conversations).values({ userId: user.id, kind: "assistant", title: "Alive", expiresAt: conversationExpiry() }).returning();
    await purgeExpiredConversations();
    expect(await db.select().from(conversations).where(eq(conversations.id, live.id))).toHaveLength(1);
  });

  it("plans and items are scoped per user, and deleting a plan keeps what it already created", async () => {
    const plan = await planner.createDraft(user, draft({ horizon: "day", periodKey: addDaysKey(today(), 3) }), { tz: TZ });
    const { results } = await planner.acceptPlan(user, plan.id);
    const taskId = results.find((r) => r.taskId)!.taskId!;
    await expect(planner.deletePlan(other.id, plan.id)).rejects.toMatchObject({ status: 404 });
    await planner.deletePlan(user.id, plan.id);
    expect(await db.select().from(plans).where(eq(plans.id, plan.id))).toHaveLength(0);
    expect(await db.select().from(planItems).where(eq(planItems.planId, plan.id))).toHaveLength(0);
    expect(await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, user.id)))).toHaveLength(1);
  });
});
