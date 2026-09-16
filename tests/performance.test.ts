/**
 * Phase 3.9 — performance regressions.
 *
 * The measured bottleneck on Home was `generateNotifications`: 51 ms of the endpoint's 72 ms, run
 * awaited and *before* the parallel data load. It is now throttled and overlapped. These tests exist so
 * that the throttle cannot quietly become a correctness bug: notices must still be generated, must
 * still be deduped, must never leak between users, and the endpoint must still return the same data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { notifications, tasks as tasksTable } from "@/server/db/schema";
import { MAINTENANCE_INTERVAL_MS, dashboardData, __resetMaintenanceThrottle } from "@/server/services/dashboard";
import * as tasks from "@/server/services/tasks";
import { generateNotifications, unreadCount } from "@/server/services/notifications";
import { addDaysKey, todayKey } from "@/lib/dates";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

d("the Home maintenance throttle", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    user = await createTestUser();
    other = await createTestUser();
    // An overdue task on each account: a condition the generator will report.
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "Mine is overdue", dueDate: addDaysKey(todayKey(TZ), -3) }));
    await tasks.createTask(other.id, tasks.taskCreateSchema.parse({ title: "Theirs is overdue", dueDate: addDaysKey(todayKey(TZ), -3) }));
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });
  beforeEach(() => __resetMaintenanceThrottle());

  const mine = () => db.select().from(notifications).where(eq(notifications.userId, user.id));

  it("the interval is a real throttle, not effectively disabled", () => {
    expect(MAINTENANCE_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);
    expect(MAINTENANCE_INTERVAL_MS).toBeLessThanOrEqual(60 * 60_000);
  });

  it("the first Home load still generates the user's notifications", async () => {
    expect(await mine()).toHaveLength(0);
    await dashboardData(user as never);
    const rows = await mine();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((n) => n.title.includes("Mine is overdue"))).toBe(true);
  });

  it("a second load inside the window generates nothing new — and nothing is lost", async () => {
    await dashboardData(user as never);
    const after1 = await mine();
    await dashboardData(user as never);
    await dashboardData(user as never);
    const after3 = await mine();
    expect(after3.map((n) => n.id).sort()).toEqual(after1.map((n) => n.id).sort());
  });

  it("running again after the window still creates nothing duplicate — dedupe keys hold", async () => {
    await dashboardData(user as never);
    const before = await mine();
    __resetMaintenanceThrottle();          // as if the interval had elapsed
    await dashboardData(user as never);
    const after = await mine();
    expect(after).toHaveLength(before.length);
  });

  it("the unread count returned by Home includes a notice written by that same request", async () => {
    const fresh = await createTestUser();
    try {
      await tasks.createTask(fresh.id, tasks.taskCreateSchema.parse({ title: "Fresh overdue", dueDate: addDaysKey(todayKey(TZ), -2) }));
      const data = await dashboardData(fresh as never);
      // The maintenance pass runs alongside the queries; the count is taken after it settles.
      expect(data.unreadNotifications).toBe(await unreadCount(fresh.id));
      expect(data.unreadNotifications).toBeGreaterThan(0);
    } finally { await deleteTestUser(fresh.id); }
  });

  it("one user's throttle never suppresses another user's generation", async () => {
    await dashboardData(user as never);                       // consumes only this user's window
    const theirs = await db.select().from(notifications).where(eq(notifications.userId, other.id));
    expect(theirs).toHaveLength(0);
    await dashboardData(other as never);
    const theirsAfter = await db.select().from(notifications).where(eq(notifications.userId, other.id));
    expect(theirsAfter.length).toBeGreaterThan(0);
    expect(theirsAfter.every((n) => n.userId === other.id)).toBe(true);
    // And nothing of theirs landed on the first user.
    expect((await mine()).every((n) => n.userId === user.id)).toBe(true);
  });

  it("the cron path is unaffected: it still generates directly", async () => {
    const fresh = await createTestUser();
    try {
      await tasks.createTask(fresh.id, tasks.taskCreateSchema.parse({ title: "Cron overdue", dueDate: addDaysKey(todayKey(TZ), -2) }));
      const created = await generateNotifications(fresh.id, TZ);
      expect(created).toBeGreaterThan(0);
      // Immediately again: deduped, so still no duplicates regardless of the Home throttle.
      expect(await generateNotifications(fresh.id, TZ)).toBe(0);
    } finally { await deleteTestUser(fresh.id); }
  });

  it("Home still returns the whole payload, with its data intact", async () => {
    const data = await dashboardData(user as never);
    for (const key of ["today", "widgets", "unreadNotifications", "tasks", "events", "training", "finance", "goals", "projects", "studies", "nutrition"]) {
      expect(data, `missing ${key}`).toHaveProperty(key);
    }
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The overdue task really is in there — not an empty shell returned quickly.
    const overdueTitles = data.tasks.overdue.map((t) => t.title);
    expect(overdueTitles).toContain("Mine is overdue");
    const rows = await db.select().from(tasksTable).where(and(eq(tasksTable.userId, user.id), eq(tasksTable.title, "Mine is overdue")));
    expect(rows).toHaveLength(1);
  });

  it("Home reads only its own user's rows", async () => {
    const data = await dashboardData(user as never);
    const titles = [...data.tasks.today, ...data.tasks.overdue].map((t) => t.title);
    expect(titles.some((t) => t.includes("Theirs"))).toBe(false);
  });
});

describe("charts are split out of the first load", () => {
  it("the chart wrapper defers the library instead of importing it eagerly", async () => {
    const fs = await import("node:fs");
    const wrapper = fs.readFileSync("src/components/charts.tsx", "utf8");
    // The wrapper must not pull recharts into the module graph of every page that shows a chart.
    expect(wrapper).not.toMatch(/from "recharts"/);
    expect(wrapper).toContain("next/dynamic");
    expect(wrapper).toMatch(/import\("\.\/charts-impl"\)/);
    // The implementation still owns the real components, so call sites are unchanged.
    const impl = fs.readFileSync("src/components/charts-impl.tsx", "utf8");
    expect(impl).toMatch(/from "recharts"/);
    expect(impl).toContain("export function MiniBars");
    expect(impl).toContain("export function MiniLine");
  });

  it("every page still imports charts from the same place", async () => {
    const fs = await import("node:fs");
    const pages = ["finance", "training", "nutrition", "studies", "analytics"];
    for (const p of pages) {
      const src = fs.readFileSync(`src/app/(app)/${p}/page.tsx`, "utf8");
      expect(src, p).toMatch(/from "@\/components\/charts"/);
      expect(src, p).not.toMatch(/charts-impl/);
    }
  });
});
