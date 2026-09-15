/**
 * Phase 3.3 — the data the Planner screen and Home render. There is no DOM test runner in this project,
 * so these tests pin the contracts the UI consumes (the planner routes' payloads and the dashboard block)
 * rather than the markup: what the user must be able to tell apart — proposed, accepted, materialised,
 * failed — has to be present and correct in the data itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { planItems, tasks } from "@/server/db/schema";
import * as planner from "@/server/services/planner";
import { dashboardData } from "@/server/services/dashboard";
import { allTools } from "@/server/ai/registry";
import { addDaysKey, todayKey } from "@/lib/dates";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

d("phase 3.3 — planner UI contracts and Home integration", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  const today = () => todayKey(TZ);
  const draftFor = (periodKey: string) =>
    planner.planDraftSchema.parse({
      horizon: "day", periodKey, content: "Two blocks and one reminder.",
      items: [
        { kind: "task", title: "Review the chapter", date: periodKey, priority: "high" },
        { kind: "event", title: "Gym", startAt: `${periodKey}T19:00:00`, endAt: `${periodKey}T20:00:00`, eventKind: "training" },
        { kind: "note", title: "Sleep early" },
      ],
    });

  beforeAll(async () => { user = await createTestUser(); other = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });

  it("a draft arrives with everything the screen needs to explain it", async () => {
    const plan = await planner.createDraft(user, draftFor(today()), { tz: TZ });
    const current = await planner.currentPlan(user.id, { horizon: "day", tz: TZ });
    expect(current?.id).toBe(plan.id);
    expect(current?.status).toBe("draft");
    for (const item of current!.items) {
      expect(item).toHaveProperty("kind");
      expect(item).toHaveProperty("status", "proposed");
      expect(item.createdTaskId).toBeNull();
      expect(item.createdEventId).toBeNull();
    }
    // The screen tells apart what will become a task, an event, or nothing at all.
    expect(current!.items.map((i) => i.kind).sort()).toEqual(["event", "note", "task"]);
  });

  it("a plan with no items is readable and offers nothing to accept", async () => {
    const [empty] = await db.insert((await import("@/server/db/schema")).plans).values({ userId: user.id, horizon: "day", periodKey: addDaysKey(today(), 9), content: "" }).returning();
    const plan = await planner.getPlan(user.id, empty.id);
    expect(plan.items).toEqual([]);
    expect(plan.status).toBe("draft");
    const { results } = await planner.acceptPlan(user, plan.id);
    expect(results).toEqual([]);
    expect((await planner.getPlan(user.id, plan.id)).status).toBe("draft");
  });

  it("accepting from the UI marks items as materialised and says which record each became", async () => {
    const plan = await planner.createDraft(user, draftFor(addDaysKey(today(), 1)), { tz: TZ });
    const { plan: accepted, results } = await planner.acceptPlan(user, plan.id);
    expect(results.every((r) => r.status === "created")).toBe(true);
    const task = accepted.items.find((i) => i.kind === "task")!;
    const event = accepted.items.find((i) => i.kind === "event")!;
    const note = accepted.items.find((i) => i.kind === "note")!;
    expect(task.createdTaskId).toBeTruthy();
    expect(event.createdEventId).toBeTruthy();
    expect(note.createdTaskId).toBeNull();
    expect(note.createdEventId).toBeNull();
    expect(note.status).toBe("accepted");
    expect(accepted.status).toBe("accepted");
    expect(results.find((r) => r.kind === "task")?.taskId).toBe(task.createdTaskId);
    expect(results.find((r) => r.kind === "event")?.eventId).toBe(event.createdEventId);
  });

  it("partial acceptance leaves the rest pending, and rejecting closes only what was pending", async () => {
    const plan = await planner.createDraft(user, draftFor(addDaysKey(today(), 2)), { tz: TZ });
    const first = plan.items[0];
    const { plan: partial } = await planner.acceptPlan(user, plan.id, { itemIds: [first.id] });
    expect(partial.status).toBe("partially_accepted");
    expect(partial.items.filter((i) => i.status === "proposed")).toHaveLength(2);
    const rejected = await planner.rejectPlan(user, plan.id);
    expect(rejected.items.filter((i) => i.status === "rejected")).toHaveLength(2);
    expect(rejected.items.find((i) => i.id === first.id)?.status).toBe("accepted");
    // A closed plan offers no further acceptance.
    const closed = await planner.createDraft(user, draftFor(addDaysKey(today(), 3)), { tz: TZ });
    await planner.rejectPlan(user, closed.id);
    await expect(planner.acceptPlan(user, closed.id)).rejects.toMatchObject({ status: 400 });
  });

  it("accepting twice from the screen duplicates nothing and reports it as already created", async () => {
    const plan = await planner.createDraft(user, draftFor(addDaysKey(today(), 4)), { tz: TZ });
    const before = await db.select().from(tasks).where(eq(tasks.userId, user.id)).then((r) => r.length);
    await planner.acceptPlan(user, plan.id);
    const after = await db.select().from(tasks).where(eq(tasks.userId, user.id)).then((r) => r.length);
    const { results } = await planner.acceptPlan(user, plan.id);
    expect(results.every((r) => r.status === "already_created" || r.status === "skipped")).toBe(true);
    expect(await db.select().from(tasks).where(eq(tasks.userId, user.id)).then((r) => r.length)).toBe(after);
    expect(after).toBe(before + 1);
  });

  it("a materialisation error is reported per item and never presented as success", async () => {
    const plan = await planner.createDraft(user, draftFor(addDaysKey(today(), 5)), { tz: TZ });
    const [broken] = await db.insert(planItems).values({ userId: user.id, planId: plan.id, position: 9, kind: "task", title: "" }).returning();
    const { results } = await planner.acceptPlan(user, plan.id, { itemIds: [broken.id] });
    expect(results[0]).toMatchObject({ itemId: broken.id, status: "failed" });
    expect(typeof results[0].error).toBe("string");
    expect(results[0].taskId).toBeUndefined();
    const reread = await planner.getPlan(user.id, plan.id);
    expect(reread.items.find((i) => i.id === broken.id)?.status).toBe("proposed");
  });

  it("Home shows today's plan from the planner service, with its real state", async () => {
    const plan = await planner.createDraft(user, draftFor(today()), { tz: TZ });
    const home = await dashboardData(user);
    expect(home.plan?.day?.id).toBe(plan.id);
    expect(home.plan?.day?.status).toBe("draft");
    expect(home.plan?.day?.pendingItems).toBe(3);
    expect(home.plan?.day?.items.every((i) => i.materialised === false)).toBe(true);
    expect(home.plan?.draftsAwaitingAnswer).toBeGreaterThan(0);

    await planner.acceptPlan(user, plan.id);
    const after = await dashboardData(user);
    expect(after.plan?.day?.status).toBe("accepted");
    expect(after.plan?.day?.pendingItems).toBe(0);
    expect(after.plan?.day?.items.filter((i) => i.materialised)).toHaveLength(2); // task + event; the note has no record
  });

  it("Home reports the absence of a plan instead of inventing one", async () => {
    const fresh = await createTestUser();
    try {
      const home = await dashboardData(fresh);
      expect(home.plan).not.toBeNull();
      expect(home.plan?.day).toBeNull();
      expect(home.plan?.week).toBeNull();
      expect(home.plan?.draftsAwaitingAnswer).toBe(0);
    } finally { await deleteTestUser(fresh.id); }
  });

  it("one user's plan never reaches another user's screen", async () => {
    const mine = await planner.createDraft(user, draftFor(addDaysKey(today(), 6)), { tz: TZ });
    await expect(planner.getPlan(other.id, mine.id)).rejects.toMatchObject({ status: 404 });
    await expect(planner.acceptPlan(other, mine.id)).rejects.toMatchObject({ status: 404 });
    await expect(planner.rejectPlan(other, mine.id)).rejects.toMatchObject({ status: 404 });
    const theirHome = await dashboardData(other);
    expect(theirHome.plan?.day).toBeNull();
    expect((await planner.getPlan(user.id, mine.id)).status).toBe("draft"); // untouched by the attempts
  });

  it("the assistant still has no way to accept or apply a plan", async () => {
    const names = allTools().map((t) => t.name);
    expect(allTools().filter((t) => t.module === "planner").map((t) => t.name)).toEqual(["propose_plan", "get_plan"]);
    for (const forbidden of ["accept_plan", "apply_plan", "materialize_plan", "execute_plan", "confirm_plan"]) expect(names).not.toContain(forbidden);
    expect(names).toHaveLength(77);
  });
});
