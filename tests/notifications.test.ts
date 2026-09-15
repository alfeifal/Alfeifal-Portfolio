/**
 * Phase 3.4 — the notification generators that the settings screen already offered but nothing
 * produced: training, finance and study consistency. All of them read the user's real data, respect
 * their toggle, say nothing when there is nothing to say, and cannot repeat themselves.
 */
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { notifications } from "@/server/db/schema";
import { generateNotifications, listNotifications, updateNotificationSettings } from "@/server/services/notifications";
import * as tr from "@/server/services/training";
import * as fin from "@/server/services/finance";
import * as st from "@/server/services/studies";
import { addDaysKey, todayKey } from "@/lib/dates";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";
const today = () => todayKey(TZ);

/** Only the kinds this phase introduces; tasks/deadlines/events keep their own tests. */
const ofKind = async (userId: string, kind: "training" | "finance" | "study") =>
  db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.kind, kind)));

d("phase 3.4 — training, finance and study notifications", () => {
  const users: string[] = [];
  const newUser = async () => { const u = await createTestUser(); users.push(u.id); return u; };
  afterEach(async () => { while (users.length) await deleteTestUser(users.pop()!); });

  /** Moves the routine so that today lands on the given cycle day (0-based; 3 and 7 are rest days). */
  const alignCycle = async (userId: string, dayIndex: number) => {
    const plan = await tr.getPlanWithDays(userId);
    await tr.updatePlan(userId, plan!.id, { startDate: addDaysKey(today(), -dayIndex) });
    return plan!;
  };

  it("training: says the cycle put a workout today, and stops once it is logged", async () => {
    const user = await newUser();
    await alignCycle(user.id, 0); // D1 Push
    await generateNotifications(user.id, TZ);
    const first = await ofKind(user.id, "training");
    expect(first).toHaveLength(1);
    expect(first[0].title).toContain("Training today");
    expect(first[0].href).toBe("/training");

    // Logging a working set makes the condition false; nothing new appears.
    await tr.logSet(user.id, tr.setSchema.parse({ exercise: "bench", weightKg: 60, reps: 8, date: today() }));
    await generateNotifications(user.id, TZ);
    expect(await ofKind(user.id, "training")).toHaveLength(1);
  });

  it("training: a rest day produces nothing at all", async () => {
    const user = await newUser();
    await alignCycle(user.id, 3); // D4 is a rest day in the 3-1-3-1 cycle
    await generateNotifications(user.id, TZ);
    expect(await ofKind(user.id, "training")).toHaveLength(0);
  });

  it("training: an unfinished session from a past day is surfaced once", async () => {
    const user = await newUser();
    await alignCycle(user.id, 3); // rest day today, so only the open session can fire
    const session = await tr.startSession(user.id, { date: addDaysKey(today(), -2), source: "user" }, TZ);
    await generateNotifications(user.id, TZ);
    const open = await ofKind(user.id, "training");
    expect(open).toHaveLength(1);
    expect(open[0].title).toContain("still open");
    expect(open[0].href).toBe(`/training/sessions/${session.id}`);
    await generateNotifications(user.id, TZ);
    expect(await ofKind(user.id, "training")).toHaveLength(1);
    // Finishing it stops any further notice for a new session.
    await tr.updateSession(user.id, session.id, { finished: true, durationMinutes: 30 });
    await generateNotifications(user.id, TZ);
    expect(await ofKind(user.id, "training")).toHaveLength(1);
  });

  it("training: falling two or more training days behind in the week is reported once per week", async () => {
    const user = await newUser();
    await alignCycle(user.id, 6); // late in the cycle, so several training days already passed this week
    const before = await tr.weeklyTrainingStatus(user.id, TZ);
    await generateNotifications(user.id, TZ);
    const behind = (await ofKind(user.id, "training")).filter((n) => n.title.includes("Behind on training"));
    if (before.plannedSoFar != null && before.plannedSoFar - before.completed >= 2) {
      expect(behind).toHaveLength(1);
      await generateNotifications(user.id, TZ);
      expect((await ofKind(user.id, "training")).filter((n) => n.title.includes("Behind on training"))).toHaveLength(1);
    } else {
      expect(behind).toHaveLength(0); // early in the week the cycle may not have placed two days yet
    }
  });

  it("finance: a budget warns once, then reports being exceeded once, and never repeats", async () => {
    const user = await newUser();
    const food = (await fin.listCategories(user.id)).find((c) => c.name === "Food")!;
    await fin.upsertBudget(user.id, { categoryId: food.id, amount: 100, period: "monthly" });
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 85, categoryId: food.id, date: today() }), TZ);
    await generateNotifications(user.id, TZ);
    const warn = await ofKind(user.id, "finance");
    expect(warn).toHaveLength(1);
    expect(warn[0].title).toContain("Budget at 85%");

    await generateNotifications(user.id, TZ);
    expect(await ofKind(user.id, "finance")).toHaveLength(1); // same condition, same notice

    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 30, categoryId: food.id, date: today() }), TZ);
    await generateNotifications(user.id, TZ);
    const all = await ofKind(user.id, "finance");
    expect(all).toHaveLength(2);
    expect(all.some((n) => n.title.startsWith("Budget exceeded"))).toBe(true);
    await generateNotifications(user.id, TZ);
    expect(await ofKind(user.id, "finance")).toHaveLength(2);
  });

  it("finance: a budget below the threshold says nothing, and the threshold is configurable", async () => {
    const user = await newUser();
    const food = (await fin.listCategories(user.id)).find((c) => c.name === "Food")!;
    await fin.upsertBudget(user.id, { categoryId: food.id, amount: 100, period: "monthly" });
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 60, categoryId: food.id, date: today() }), TZ);
    await generateNotifications(user.id, TZ);
    expect(await ofKind(user.id, "finance")).toHaveLength(0);

    await updateNotificationSettings(user.id, { budgetWarnPct: 50 });
    await generateNotifications(user.id, TZ);
    const warned = await ofKind(user.id, "finance");
    expect(warned).toHaveLength(1);
    expect(warned[0].title).toContain("60%");
  });

  it("finance: a savings goal due soon is reported, one that is met or far away is not", async () => {
    const user = await newUser();
    await fin.createSavingsGoal(user.id, fin.savingsGoalSchema.parse({ name: "Emergency fund", targetAmount: 1000, currentAmount: 400, deadline: addDaysKey(today(), 2) }));
    await fin.createSavingsGoal(user.id, fin.savingsGoalSchema.parse({ name: "Already saved", targetAmount: 500, currentAmount: 500, deadline: addDaysKey(today(), 2) }));
    await fin.createSavingsGoal(user.id, fin.savingsGoalSchema.parse({ name: "Next year", targetAmount: 5000, currentAmount: 0, deadline: addDaysKey(today(), 200) }));
    await generateNotifications(user.id, TZ);
    const notes = await ofKind(user.id, "finance");
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toContain("Emergency fund");
    expect(notes[0].body).toContain("40%");
  });

  it("study: a quiet streak is reported once a day and disappears after studying", async () => {
    const user = await newUser();
    await generateNotifications(user.id, TZ);
    const quiet = (await ofKind(user.id, "study")).filter((n) => n.title.includes("No study logged"));
    expect(quiet).toHaveLength(1);
    expect(quiet[0].body).toContain("subject");
    await generateNotifications(user.id, TZ);
    expect((await ofKind(user.id, "study")).filter((n) => n.title.includes("No study logged"))).toHaveLength(1);

    const fresh = await newUser();
    await st.logStudySession(fresh.id, st.studySessionSchema.parse({ subject: "alemán", durationMinutes: 30 }), TZ);
    await generateNotifications(fresh.id, TZ);
    expect((await ofKind(fresh.id, "study")).filter((n) => n.title.includes("No study logged"))).toHaveLength(0);
  });

  it("study: a weekly subject goal clearly off pace is reported once per subject and week", async () => {
    const user = await newUser();
    const german = (await st.listSubjects(user.id)).find((s) => s.slug === "german")!;
    expect(german.weeklyGoalMinutes).toBeGreaterThan(0);
    await st.logStudySession(user.id, st.studySessionSchema.parse({ subject: "alemán", durationMinutes: 5 }), TZ);
    await generateNotifications(user.id, TZ);
    const behind = (await ofKind(user.id, "study")).filter((n) => n.title.includes("behind the weekly goal"));
    const { weekRange } = await import("@/lib/dates");
    const elapsed = Math.round((new Date(today() + "T12:00:00").getTime() - weekRange(new Date(today() + "T12:00:00")).start.getTime()) / 86400e3) + 1;
    if (elapsed >= 4) {
      expect(behind).toHaveLength(1);
      expect(behind[0].body).toContain(`of ${german.weeklyGoalMinutes} min`);
      await generateNotifications(user.id, TZ);
      expect((await ofKind(user.id, "study")).filter((n) => n.title.includes("behind the weekly goal"))).toHaveLength(1);
    } else {
      expect(behind).toHaveLength(0); // too early in the week to judge the pace
    }
  });

  it("every toggle is respected: switching the three off produces none of their notifications", async () => {
    const user = await newUser();
    await alignCycle(user.id, 0);
    const food = (await fin.listCategories(user.id)).find((c) => c.name === "Food")!;
    await fin.upsertBudget(user.id, { categoryId: food.id, amount: 100, period: "monthly" });
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 120, categoryId: food.id, date: today() }), TZ);
    await updateNotificationSettings(user.id, { training: false, finance: false, study: false });
    await generateNotifications(user.id, TZ);
    const rows = await db.select().from(notifications).where(and(eq(notifications.userId, user.id), inArray(notifications.kind, ["training", "finance", "study"])));
    expect(rows).toHaveLength(0);

    // Turning them back on produces them, once.
    await updateNotificationSettings(user.id, { training: true, finance: true, study: true });
    const created = await generateNotifications(user.id, TZ);
    expect(created).toBeGreaterThan(0);
    const again = await generateNotifications(user.id, TZ);
    expect(again).toBe(0);
  });

  it("nothing to report means nothing is invented", async () => {
    const user = await newUser();
    await alignCycle(user.id, 3); // rest day
    await st.logStudySession(user.id, st.studySessionSchema.parse({ subject: "alemán", durationMinutes: 200 }), TZ);
    const rows = await db.select().from(notifications).where(and(eq(notifications.userId, user.id), inArray(notifications.kind, ["training", "finance"])));
    await generateNotifications(user.id, TZ);
    expect(rows).toHaveLength(0);
    const after = await db.select().from(notifications).where(and(eq(notifications.userId, user.id), inArray(notifications.kind, ["training", "finance"])));
    expect(after).toHaveLength(0);
  });

  it("generators never cross between users", async () => {
    const mine = await newUser();
    const theirs = await newUser();
    await alignCycle(mine.id, 0);
    await alignCycle(theirs.id, 3);
    const food = (await fin.listCategories(mine.id)).find((c) => c.name === "Food")!;
    await fin.upsertBudget(mine.id, { categoryId: food.id, amount: 50, period: "monthly" });
    await fin.createTransaction(mine.id, fin.transactionSchema.parse({ type: "expense", amount: 60, categoryId: food.id, date: today() }), TZ);
    await generateNotifications(mine.id, TZ);
    expect((await ofKind(mine.id, "finance")).length).toBeGreaterThan(0);
    expect(await ofKind(theirs.id, "finance")).toHaveLength(0);
    expect(await ofKind(theirs.id, "training")).toHaveLength(0);
    const theirList = await listNotifications(theirs.id);
    expect(theirList.every((n) => n.userId === theirs.id)).toBe(true);
  });

  it("several conditions at once are separate, actionable notices — not one lump and not spam", async () => {
    const user = await newUser();
    await alignCycle(user.id, 0);
    const food = (await fin.listCategories(user.id)).find((c) => c.name === "Food")!;
    await fin.upsertBudget(user.id, { categoryId: food.id, amount: 100, period: "monthly" });
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 150, categoryId: food.id, date: today() }), TZ);
    await tr.startSession(user.id, { date: addDaysKey(today(), -1), source: "user" }, TZ);
    await generateNotifications(user.id, TZ);
    const training = await ofKind(user.id, "training");
    const finance = await ofKind(user.id, "finance");
    const study = await ofKind(user.id, "study");
    expect(training.length).toBeGreaterThanOrEqual(2); // today's workout + the open session
    expect(finance).toHaveLength(1);
    expect(study.length).toBeGreaterThanOrEqual(1);
    for (const n of [...training, ...finance, ...study]) {
      expect(n.href).toBeTruthy();
      expect(n.dedupeKey).toBeTruthy();
    }
    expect(new Set([...training, ...finance, ...study].map((n) => n.dedupeKey)).size).toBe(training.length + finance.length + study.length);
    // Three runs in a row add nothing.
    expect(await generateNotifications(user.id, TZ)).toBe(0);
    expect(await generateNotifications(user.id, TZ)).toBe(0);
  });

  it("missing data degrades quietly: no plan, no budgets, no subjects", async () => {
    const user = await newUser();
    const plan = await tr.getPlanWithDays(user.id);
    await tr.updatePlan(user.id, plan!.id, { active: false });
    for (const s of await st.listSubjects(user.id)) await st.deleteSubject(user.id, s.id);
    await expect(generateNotifications(user.id, TZ)).resolves.toBeGreaterThanOrEqual(0);
    expect(await ofKind(user.id, "training")).toHaveLength(0);
    expect(await ofKind(user.id, "finance")).toHaveLength(0);
    expect(await ofKind(user.id, "study")).toHaveLength(0);
  });
});
