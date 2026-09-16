/**
 * Phase 3.12 — two accounts on one instance must be two separate worlds.
 *
 * The app was built for one person and grew a `user_id` on almost everything; that is necessary but
 * not sufficient. Reads and writes were already filtered by owner, but a *reference* was not: a create
 * call would store whatever `projectId`, `subjectId` or `watchlistId` it was handed. That let one
 * account attach a row to another account's project — which moved that project's counters — and, in
 * the watchlist case, handed back the other account's row as a "duplicate".
 *
 * These tests are the contract now: A sees A, B sees B, and every id that crosses the boundary is
 * rejected as `not found` — the same answer an id that never existed gets, so nothing here can be
 * used to probe what the other account owns.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { aiMemory, users } from "@/server/db/schema";
import { AppError } from "@/server/http";
import { assertOwned, assertAllOwned, ownedKinds } from "@/server/ownership";

import * as tasks from "@/server/services/tasks";
import * as goals from "@/server/services/goals";
import * as projects from "@/server/services/projects";
import * as finance from "@/server/services/finance";
import * as calendar from "@/server/services/calendar";
import * as studies from "@/server/services/studies";
import * as journal from "@/server/services/journal";
import * as nutrition from "@/server/services/nutrition";
import * as training from "@/server/services/training";
import * as trading from "@/server/services/trading";
import * as investing from "@/server/services/investing";
import * as memory from "@/server/services/memory";
import * as conversations from "@/server/services/conversations";
import * as notifications from "@/server/services/notifications";
import * as planner from "@/server/services/planner";
import * as reviews from "@/server/services/reviews";
import { globalSearch } from "@/server/services/search";
import { analyticsOverview } from "@/server/services/analytics";
import { dashboardData } from "@/server/services/dashboard";
import { lifeSnapshot } from "@/server/services/snapshot";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";
const today = () => new Date().toISOString().slice(0, 10);

type U = Awaited<ReturnType<typeof createTestUser>>;

/** Asserts the call fails, and fails the way an unknown id fails — not with a leak or a 500. */
async function refuses(fn: () => Promise<unknown>) {
  let thrown: unknown = null;
  try { await fn(); } catch (e) { thrown = e; }
  expect(thrown, "expected the cross-user call to be refused").not.toBeNull();
  expect(thrown).toBeInstanceOf(AppError);
  expect([403, 404]).toContain((thrown as AppError).status);
  return thrown as AppError;
}

d("two accounts, one instance", () => {
  let A: U;
  let B: U;
  const a: Record<string, string> = {};
  const b: Record<string, string> = {};

  beforeAll(async () => {
    A = await createTestUser();
    B = await createTestUser();

    // Deliberately distinct data, with markers that cannot collide.
    a.task = (await tasks.createTask(A.id, tasks.taskCreateSchema.parse({ title: "TASK_A_UNIQUE", dueDate: today() }))).id;
    b.task = (await tasks.createTask(B.id, tasks.taskCreateSchema.parse({ title: "TASK_B_UNIQUE", dueDate: today() }))).id;

    a.goal = (await goals.createGoal(A.id, goals.goalCreateSchema.parse({ name: "GOAL_A_UNIQUE" }), TZ)).id;
    b.goal = (await goals.createGoal(B.id, goals.goalCreateSchema.parse({ name: "GOAL_B_UNIQUE" }), TZ)).id;

    a.project = (await projects.createProject(A.id, projects.projectCreateSchema.parse({ name: "PROJECT_A_UNIQUE" }))).id;
    b.project = (await projects.createProject(B.id, projects.projectCreateSchema.parse({ name: "PROJECT_B_UNIQUE" }))).id;

    a.tx = (await finance.createTransaction(A.id, finance.transactionSchema.parse({ type: "expense", amount: 11.11, description: "FINANCE_A_UNIQUE", date: today() }), TZ)).id;
    b.tx = (await finance.createTransaction(B.id, finance.transactionSchema.parse({ type: "expense", amount: 22.22, description: "FINANCE_B_UNIQUE", date: today() }), TZ)).id;

    a.event = (await calendar.createEvent(A.id, calendar.eventCreateSchema.parse({ title: "EVENT_A_UNIQUE", startAt: new Date() }))).id;
    b.event = (await calendar.createEvent(B.id, calendar.eventCreateSchema.parse({ title: "EVENT_B_UNIQUE", startAt: new Date() }))).id;

    a.journal = (await journal.createEntry(A.id, journal.journalCreateSchema.parse({ content: "JOURNAL_A_UNIQUE", date: today() }))).id;
    b.journal = (await journal.createEntry(B.id, journal.journalCreateSchema.parse({ content: "JOURNAL_B_UNIQUE", date: today() }))).id;

    a.memory = (await memory.rememberMemory(A.id, memory.memorySchema.parse({ content: "MEMORY_A_UNIQUE", key: "marker-a" }))).id;
    b.memory = (await memory.rememberMemory(B.id, memory.memorySchema.parse({ content: "MEMORY_B_UNIQUE", key: "marker-b" }))).id;

    a.subject = (await studies.createSubject(A.id, studies.subjectSchema.parse({ name: "SUBJECT_A_UNIQUE" }))).id;
    b.subject = (await studies.createSubject(B.id, studies.subjectSchema.parse({ name: "SUBJECT_B_UNIQUE" }))).id;

    a.food = (await nutrition.createFood(A.id, nutrition.foodSchema.parse({ name: "FOOD_A_UNIQUE", calories: 100 }))).id;
    b.food = (await nutrition.createFood(B.id, nutrition.foodSchema.parse({ name: "FOOD_B_UNIQUE", calories: 200 }))).id;

    const wlA = await trading.listWatchlists(A.id);
    const wlB = await trading.listWatchlists(B.id);
    a.watchlist = wlA[0].id;
    b.watchlist = wlB[0].id;
    await trading.addWatchlistItem(B.id, trading.watchlistItemSchema.parse({ symbol: "BBBB", notes: "WATCH_B_UNIQUE" }));
  });

  afterAll(async () => {
    if (A) await deleteTestUser(A.id);
    if (B) await deleteTestUser(B.id);
  });

  /* ------------------------------------------------------------------ lists */

  it("every list returns only its own account's rows", async () => {
    const mine = {
      tasks: (await tasks.listTasks(A.id, { view: "all" })).map((t) => t.title),
      goals: (await goals.listGoals(A.id, undefined, TZ)).map((g) => g.name),
      projects: (await projects.listProjects(A.id)).map((p) => p.name),
      journal: (await journal.listJournal(A.id, {})).map((j) => j.content),
      memory: (await memory.listMemory(A.id, {})).map((m) => m.content),
      subjects: (await studies.listSubjects(A.id)).map((s) => s.name),
      foods: (await nutrition.listFoods(A.id)).map((f) => f.name),
      events: (await calendar.listEvents(A.id, { from: new Date(Date.now() - 864e5), to: new Date(Date.now() + 864e5) })).map((e) => e.title),
    };
    const flat = JSON.stringify(mine);
    expect(flat).toContain("TASK_A_UNIQUE");
    expect(flat).toContain("GOAL_A_UNIQUE");
    expect(flat).toContain("PROJECT_A_UNIQUE");
    expect(flat).toContain("MEMORY_A_UNIQUE");
    for (const marker of ["TASK_B_UNIQUE", "GOAL_B_UNIQUE", "PROJECT_B_UNIQUE", "JOURNAL_B_UNIQUE", "MEMORY_B_UNIQUE", "SUBJECT_B_UNIQUE", "FOOD_B_UNIQUE", "EVENT_B_UNIQUE"]) {
      expect(flat, `A's lists leaked ${marker}`).not.toContain(marker);
    }
  });

  /* ------------------------------------------------------------------ get by the other account's id */

  it("reading another account's row by id is refused everywhere", async () => {
    await refuses(() => tasks.getTask(A.id, b.task));
    await refuses(() => goals.getGoal(A.id, b.goal, TZ));
    await refuses(() => projects.getProject(A.id, b.project));
    await refuses(() => finance.getTransaction(A.id, b.tx));
    await refuses(() => calendar.getEvent(A.id, b.event));
    await refuses(() => memory.getMemory(A.id, { id: b.memory }));
    await refuses(() => conversations.getLiveConversation(A.id, b.memory)); // any foreign uuid
  });

  it("updating another account's row is refused", async () => {
    await refuses(() => tasks.updateTask(A.id, b.task, { title: "hijacked" }, TZ));
    await refuses(() => goals.updateGoal(A.id, b.goal, { name: "hijacked" }, TZ));
    await refuses(() => projects.updateProject(A.id, b.project, { name: "hijacked" }));
    await refuses(() => memory.updateMemory(A.id, { id: b.memory }, { content: "hijacked" }));
    await refuses(() => studies.updateSubject(A.id, b.subject, { name: "hijacked" }));
    // …and the row is untouched.
    expect((await tasks.getTask(B.id, b.task)).title).toBe("TASK_B_UNIQUE");
    expect((await goals.getGoal(B.id, b.goal, TZ)).name).toBe("GOAL_B_UNIQUE");
    expect((await projects.getProject(B.id, b.project)).name).toBe("PROJECT_B_UNIQUE");
  });

  it("deleting another account's row deletes nothing", async () => {
    await tasks.deleteTask(A.id, b.task, TZ).catch(() => {});
    await projects.deleteProject(A.id, b.project).catch(() => {});
    await memory.forgetMemory(A.id, { id: b.memory }).catch(() => {});
    expect(await tasks.getTask(B.id, b.task)).toBeTruthy();
    expect(await projects.getProject(B.id, b.project)).toBeTruthy();
    expect(await memory.getMemory(B.id, { id: b.memory })).toBeTruthy();
  });

  /* ------------------------------------------------------------------ references across the boundary */

  it("a task cannot be attached to another account's project, goal or milestone", async () => {
    await refuses(() => tasks.createTask(A.id, tasks.taskCreateSchema.parse({ title: "sneaky", projectId: b.project })));
    await refuses(() => tasks.createTask(A.id, tasks.taskCreateSchema.parse({ title: "sneaky", goalId: b.goal })));
    await refuses(() => tasks.updateTask(A.id, a.task, { projectId: b.project }, TZ));
  });

  it("the other account's project counters do not move", async () => {
    const before = (await projects.listProjects(B.id)).find((p) => p.id === b.project)!;
    await tasks.createTask(A.id, tasks.taskCreateSchema.parse({ title: "sneaky-2", projectId: b.project })).catch(() => {});
    const after = (await projects.listProjects(B.id)).find((p) => p.id === b.project)!;
    expect(after.openTasks).toBe(before.openTasks);
    expect(after.computedProgress).toBe(before.computedProgress);
  });

  it("a calendar event cannot reference another account's task, project or goal", async () => {
    await refuses(() => calendar.createEvent(A.id, calendar.eventCreateSchema.parse({ title: "sneaky", startAt: new Date(), taskId: b.task })));
    await refuses(() => calendar.createEvent(A.id, calendar.eventCreateSchema.parse({ title: "sneaky", startAt: new Date(), projectId: b.project })));
  });

  it("a transaction cannot reference another account's account or category", async () => {
    const bAccounts = await finance.listAccounts(B.id);
    const bCats = await finance.listCategories(B.id);
    await refuses(() => finance.createTransaction(A.id, finance.transactionSchema.parse({ type: "expense", amount: 5, description: "sneaky", accountId: bAccounts[0].id }), TZ));
    await refuses(() => finance.createTransaction(A.id, finance.transactionSchema.parse({ type: "expense", amount: 5, description: "sneaky", categoryId: bCats[0].id }), TZ));
    await refuses(() => finance.upsertBudget(A.id, finance.budgetSchema.parse({ categoryId: bCats[0].id, amount: 100 })));
  });

  it("a study session, assignment or exam cannot reference another account's subject", async () => {
    await refuses(() => studies.logStudySession(A.id, studies.studySessionSchema.parse({ subjectId: b.subject, durationMinutes: 30, date: today() }), TZ));
    await refuses(() => studies.createAssignment(A.id, studies.assignmentSchema.parse({ subjectId: b.subject, title: "sneaky" })));
    await refuses(() => studies.createExam(A.id, studies.examSchema.parse({ subjectId: b.subject, title: "sneaky", date: today() })));
  });

  it("a project cannot be attached to another account's goal", async () => {
    await refuses(() => projects.createProject(A.id, projects.projectCreateSchema.parse({ name: "sneaky", goalId: b.goal })));
    await refuses(() => projects.updateProject(A.id, a.project, { goalId: b.goal }));
  });

  it("a set cannot be logged against another account's exercise or session", async () => {
    const bExercises = await training.listExercises(B.id);
    await refuses(() => training.logSet(A.id, training.setSchema.parse({ exerciseId: bExercises[0].id, reps: 5, weightKg: 100 }), TZ));
    const bSession = await training.startSession(B.id, training.sessionStartSchema.parse({ date: today() }), TZ);
    await refuses(() => training.logSet(A.id, training.setSchema.parse({ sessionId: bSession.id, exercise: "Press Banca con Barra", reps: 5 }), TZ));
  });

  it("adding to another account's watchlist is refused — and never returns their row", async () => {
    // The bug this replaces: the duplicate check ran on the supplied watchlist id, so passing B's id
    // and a symbol B already tracks returned B's item, notes included.
    const err = await refuses(() => trading.addWatchlistItem(A.id, trading.watchlistItemSchema.parse({ watchlistId: b.watchlist, symbol: "BBBB" })));
    expect(JSON.stringify(err)).not.toContain("WATCH_B_UNIQUE");
    const mine = await trading.listWatchlists(A.id);
    expect(JSON.stringify(mine)).not.toContain("WATCH_B_UNIQUE");
  });

  it("an investment transaction cannot reference another account's asset", async () => {
    const bAcct = (await investing.listInvestmentAccounts(B.id))[0] ?? (await investing.createInvestmentAccount(B.id, investing.invAccountSchema.parse({ name: "B broker" })));
    const bAsset = await investing.createAsset(B.id, investing.invAssetSchema.parse({ symbol: "BBB", name: "B asset", assetClass: "stock" }));
    const aAcct = (await investing.listInvestmentAccounts(A.id))[0] ?? (await investing.createInvestmentAccount(A.id, investing.invAccountSchema.parse({ name: "A broker" })));
    await refuses(() => investing.createInvestmentTransaction(A.id, investing.invTxSchema.parse({ accountId: aAcct.id, assetId: bAsset.id, type: "buy", quantity: 1, price: 10 }), TZ));
    await refuses(() => investing.createInvestmentTransaction(A.id, investing.invTxSchema.parse({ accountId: bAcct.id, type: "contribution", amount: 10 }), TZ));
  });

  it("a plan cannot propose items pointing at another account's project or goal", async () => {
    await refuses(() => planner.createDraft(A as never, planner.planDraftSchema.parse({
      horizon: "day", content: "sneaky", items: [{ kind: "task", title: "sneaky", date: today(), projectId: b.project }],
    })));
  });

  /* ------------------------------------------------------------------ aggregates */

  it("search never crosses accounts", async () => {
    const aHits = JSON.stringify(await globalSearch(A.id, "UNIQUE", { limit: 100, perEntity: 20 }));
    const bHits = JSON.stringify(await globalSearch(B.id, "UNIQUE", { limit: 100, perEntity: 20 }));
    expect(aHits).toContain("TASK_A_UNIQUE");
    expect(bHits).toContain("TASK_B_UNIQUE");
    for (const marker of ["TASK_B_UNIQUE", "GOAL_B_UNIQUE", "PROJECT_B_UNIQUE", "JOURNAL_B_UNIQUE", "MEMORY_B_UNIQUE"]) expect(aHits).not.toContain(marker);
    for (const marker of ["TASK_A_UNIQUE", "GOAL_A_UNIQUE", "PROJECT_A_UNIQUE", "JOURNAL_A_UNIQUE", "MEMORY_A_UNIQUE"]) expect(bHits).not.toContain(marker);
  });

  it("searching for the other account's exact marker returns nothing", async () => {
    const r = await globalSearch(A.id, "TASK_B_UNIQUE", { limit: 50, perEntity: 10 });
    expect(r.hits).toHaveLength(0);
    const r2 = await globalSearch(B.id, "TASK_A_UNIQUE", { limit: 50, perEntity: 10 });
    expect(r2.hits).toHaveLength(0);
  });

  it("analytics counts only its own account", async () => {
    const aa = await analyticsOverview(A.id, "month", TZ);
    const bb = await analyticsOverview(B.id, "month", TZ);
    expect(JSON.stringify(aa)).not.toContain("_B_UNIQUE");
    expect(JSON.stringify(bb)).not.toContain("_A_UNIQUE");
    // A spent 11.11 and B spent 22.22: neither total may contain the other's money.
    expect(aa.finance.current.expenses).toBeCloseTo(11.11, 2);
    expect(bb.finance.current.expenses).toBeCloseTo(22.22, 2);
  });

  it("the dashboard and the life snapshot are per account", async () => {
    const aDash = JSON.stringify(await dashboardData(A as never));
    const bDash = JSON.stringify(await dashboardData(B as never));
    expect(aDash).not.toContain("_B_UNIQUE");
    expect(bDash).not.toContain("_A_UNIQUE");
    const aSnap = JSON.stringify(await lifeSnapshot(A as never, { tz: TZ }));
    expect(aSnap).not.toContain("_B_UNIQUE");
  });

  it("reviews are built from one account's numbers only", async () => {
    const aReview = await reviews.generateReview(A.id, "weekly", undefined, TZ);
    const bReview = await reviews.generateReview(B.id, "weekly", undefined, TZ);
    expect(aReview.facts).toBeTruthy();
    expect(JSON.stringify(aReview)).not.toContain("_B_UNIQUE");
    expect(JSON.stringify(bReview)).not.toContain("_A_UNIQUE");
    await refuses(() => reviews.getReview(A.id, bReview.id));
    expect((await reviews.listReviews(A.id, {})).every((r) => r.id !== bReview.id)).toBe(true);
  });

  it("notifications stay with their owner", async () => {
    await notifications.notify(B.id, { kind: "system", title: "NOTIF_B_UNIQUE" });
    const aList = JSON.stringify(await notifications.listNotifications(A.id, {}));
    expect(aList).not.toContain("NOTIF_B_UNIQUE");
  });

  it("memory search and key lookup are per account", async () => {
    expect(JSON.stringify(await memory.searchMemory(A.id, "MEMORY_B_UNIQUE"))).not.toContain("MEMORY_B_UNIQUE");
    // B's key resolves for B and not for A.
    expect((await memory.getMemory(B.id, { key: "marker-b" })).content).toBe("MEMORY_B_UNIQUE");
    await refuses(() => memory.getMemory(A.id, { key: "marker-b" }));
  });

  it("a conversation belongs to one account", async () => {
    const [row] = await db.insert(await import("@/server/db/schema").then((s) => s.conversations)).values({ userId: B.id, title: "CONV_B_UNIQUE" }).returning();
    await refuses(() => conversations.conversationWithMessages(A.id, row.id));
    expect(JSON.stringify(await conversations.listActiveConversations(A.id))).not.toContain("CONV_B_UNIQUE");
    await conversations.deleteConversation(A.id, row.id);
    expect((await conversations.listActiveConversations(B.id)).some((c) => c.id === row.id)).toBe(true);
  });

  it("touching memories cannot reach into another account", async () => {
    const before = (await memory.getMemory(B.id, { id: b.memory })).lastUsedAt;
    await memory.touchMemories(A.id, [b.memory]);
    expect((await memory.getMemory(B.id, { id: b.memory })).lastUsedAt).toEqual(before);
  });
});

/* -------------------------------------------------------------------- the helper itself */

d("assertOwned", () => {
  let A: U;
  let B: U;
  let bTask: string;

  beforeAll(async () => {
    A = await createTestUser();
    B = await createTestUser();
    bTask = (await tasks.createTask(B.id, tasks.taskCreateSchema.parse({ title: "B's" }))).id;
  });
  afterAll(async () => { if (A) await deleteTestUser(A.id); if (B) await deleteTestUser(B.id); });

  it("accepts an id the user owns", async () => {
    const mine = await tasks.createTask(A.id, tasks.taskCreateSchema.parse({ title: "A's" }));
    await expect(assertOwned(A.id, { task: mine.id })).resolves.toBeUndefined();
  });

  it("rejects another user's id as not found", async () => {
    await expect(assertOwned(A.id, { task: bTask })).rejects.toMatchObject({ status: 404 });
  });

  it("answers the same for an id that does not exist at all", async () => {
    await expect(assertOwned(A.id, { task: "00000000-0000-0000-0000-000000000000" })).rejects.toMatchObject({ status: 404 });
  });

  it("treats null and undefined as 'no reference'", async () => {
    await expect(assertOwned(A.id, { task: null, project: undefined, goal: "" })).resolves.toBeUndefined();
  });

  it("checks every id in a list and rejects if any is foreign", async () => {
    const mine = await tasks.createTask(A.id, tasks.taskCreateSchema.parse({ title: "A's 2" }));
    await expect(assertAllOwned(A.id, "task", [mine.id])).resolves.toBeUndefined();
    await expect(assertAllOwned(A.id, "task", [mine.id, bTask])).rejects.toMatchObject({ status: 404 });
  });

  it("covers the reference kinds the services actually pass", () => {
    for (const kind of ["project", "goal", "milestone", "task", "account", "category", "subject", "food", "exercise", "workoutSession", "trainingDay", "watchlist", "strategy", "investmentAsset"]) {
      expect(ownedKinds).toContain(kind);
    }
  });
});

/* -------------------------------------------------------------------- new accounts start empty */

d("a brand new account", () => {
  let admin: U;
  let fresh: U;

  beforeAll(async () => {
    admin = await createTestUser();
    await tasks.createTask(admin.id, tasks.taskCreateSchema.parse({ title: "ADMIN_ONLY_TASK", dueDate: today() }));
    await finance.createTransaction(admin.id, finance.transactionSchema.parse({ type: "expense", amount: 99, description: "ADMIN_ONLY_SPEND", date: today() }), TZ);
    await memory.rememberMemory(admin.id, memory.memorySchema.parse({ content: "ADMIN_ONLY_MEMORY" }));
    fresh = await createTestUser();
  });
  afterAll(async () => { if (admin) await deleteTestUser(admin.id); if (fresh) await deleteTestUser(fresh.id); });

  it("sees none of the existing account's data anywhere on its first load", async () => {
    const dash = JSON.stringify(await dashboardData(fresh as never));
    expect(dash).not.toContain("ADMIN_ONLY_TASK");
    expect(dash).not.toContain("ADMIN_ONLY_SPEND");
    const snap = JSON.stringify(await lifeSnapshot(fresh as never, { tz: TZ }));
    expect(snap).not.toContain("ADMIN_ONLY_");
    // The result echoes the query, so assert on the hits rather than the whole envelope.
    expect((await globalSearch(fresh.id, "ADMIN_ONLY", { limit: 50, perEntity: 10 })).hits).toHaveLength(0);
  });

  it("starts with no activity of its own", async () => {
    expect(await tasks.listTasks(fresh.id, { view: "all" })).toHaveLength(0);
    expect(await journal.listJournal(fresh.id, {})).toHaveLength(0);
    expect(await memory.listMemory(fresh.id, {})).toHaveLength(0);
    expect(await goals.listGoals(fresh.id, undefined, TZ)).toHaveLength(0);
    expect(await projects.listProjects(fresh.id)).toHaveLength(0);
    expect((await finance.listTransactions(fresh.id, {})).length).toBe(0);
  });

  it("does start with the structural defaults every account gets", async () => {
    expect((await finance.listAccounts(fresh.id)).length).toBeGreaterThan(0);
    expect((await finance.listCategories(fresh.id)).length).toBeGreaterThan(0);
    expect((await studies.listSubjects(fresh.id)).some((s) => s.slug === "german")).toBe(true);
    expect((await trading.listWatchlists(fresh.id)).length).toBeGreaterThan(0);
    expect((await training.listExercises(fresh.id)).length).toBeGreaterThan(0);
  });

  it("its defaults are its own rows, not shared ones", async () => {
    const mine = await finance.listAccounts(fresh.id);
    const theirs = await finance.listAccounts(admin.id);
    expect(mine[0].id).not.toBe(theirs[0].id);
    expect(mine.every((x) => x.userId === fresh.id)).toBe(true);
  });

  it("nothing in the database ties a memory to more than one account", async () => {
    const rows = await db.select().from(aiMemory).where(eq(aiMemory.userId, fresh.id));
    expect(rows).toHaveLength(0);
    const all = await db.select({ id: users.id }).from(users).where(and(eq(users.id, fresh.id)));
    expect(all).toHaveLength(1);
  });
});
