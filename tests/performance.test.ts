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
import { db, pool } from "@/server/db";
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

/**
 * Phase 3.25 — notification generation is bounded in both round trips and rows.
 *
 * Measured with `scripts/perf-bench.ts` against a disposable database seeded with five years of use:
 * `generateNotifications` issued **1,479 queries and ~496 ms** for one account, because it called
 * `notify()` — a SELECT and an INSERT — once per candidate, and the overdue-task query has no lower
 * bound. That was 92% of the daily cron's 4,464 queries. Now 31 and ~51 ms, and the cron 120 and
 * ~273 ms. Those are disposable-database figures, not production ones.
 *
 * These tests pin both halves: the round-trip count, counted off the driver rather than inferred,
 * and the row count, so a backlog cannot turn into an avalanche.
 */
d("notification generation stays bounded", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;

  /** Counts what the pool actually sent, so the assertion cannot be fooled by how the code reads. */
  const countingQueries = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
    const p = pool as unknown as { query: (...a: unknown[]) => Promise<unknown> };
    const original = p.query.bind(p);
    let n = 0;
    p.query = (...args: unknown[]) => { n++; return original(...args); };
    try { return [await fn(), n]; } finally { p.query = original; }
  };

  const seedOverdueTasks = async (n: number) => {
    const yesterday = addDaysKey(todayKey(TZ), -3);
    await db.insert(tasksTable).values(
      Array.from({ length: n }, (_, i) => ({ userId: user.id, title: `Overdue ${i}`, status: "todo" as const, dueDate: yesterday })),
    );
  };

  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });
  beforeEach(async () => {
    await db.delete(notifications).where(eq(notifications.userId, user.id));
    await db.delete(tasksTable).where(eq(tasksTable.userId, user.id));
  });

  it("issues a number of queries that does not grow with the backlog", async () => {
    await seedOverdueTasks(200);
    const [, queries] = await countingQueries(() => generateNotifications(user.id, TZ));
    // Two statements for the write, plus the fixed set of source queries. The old shape was ~2 per
    // candidate, so 200 overdue tasks alone would have been north of 400.
    expect(queries).toBeLessThan(80);
  });

  it("the query count is the same for 10 rows as for 400", async () => {
    await seedOverdueTasks(10);
    const [, few] = await countingQueries(() => generateNotifications(user.id, TZ));
    await db.delete(notifications).where(eq(notifications.userId, user.id));
    await db.delete(tasksTable).where(eq(tasksTable.userId, user.id));
    await seedOverdueTasks(400);
    const [, many] = await countingQueries(() => generateNotifications(user.id, TZ));
    // This is the N+1 assertion: a constant, not a ratio.
    expect(many).toBe(few);
  });

  it("caps the notices for a backlog and says how many it left out", async () => {
    await seedOverdueTasks(75);
    const created = await generateNotifications(user.id, TZ);
    const rows = await db.select().from(notifications).where(and(eq(notifications.userId, user.id), eq(notifications.kind, "task")));
    // 20 individual + 1 summary, never 75.
    expect(rows).toHaveLength(21);
    // `created` also covers the training and study notices the bootstrapped fixture produces.
    expect(created).toBeGreaterThanOrEqual(21);
    const summary = rows.find((r) => r.dedupeKey?.includes(":rest:"));
    expect(summary, "a capped category must say what it left out").toBeTruthy();
    expect(summary!.title).toContain("55 more");
  });

  it("the notices it keeps are the most overdue, not an arbitrary twenty", async () => {
    /*
     * The cap is a `slice` over the query's result, and the query had no ORDER BY — so which twenty
     * tasks got a notice was whatever order the heap returned, and could differ between runs. Caught
     * reviewing the diff, not by a failing test, which is why this one exists.
     */
    const today = todayKey(TZ);
    await db.insert(tasksTable).values(
      // 40 tasks, 1 to 40 days overdue. The notices must be for the 20 oldest.
      Array.from({ length: 40 }, (_, i) => ({ userId: user.id, title: `Overdue ${i + 1}d`, status: "todo" as const, dueDate: addDaysKey(today, -(i + 1)) })),
    );
    await generateNotifications(user.id, TZ);
    const rows = await db.select({ title: notifications.title }).from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.kind, "task")));
    const individual = rows.filter((r) => r.title.startsWith("Overdue:")).map((r) => r.title);
    expect(individual).toHaveLength(20);
    // Days 21..40 are the oldest; days 1..20 are the newest and must be the ones summarised.
    const days = individual.map((t) => Number(t.match(/(\d+)d$/)![1])).sort((a, b) => a - b);
    expect(days[0]).toBe(21);
    expect(days[19]).toBe(40);
  });

  it("does not summarise when everything fits", async () => {
    await seedOverdueTasks(5);
    await generateNotifications(user.id, TZ);
    const rows = await db.select().from(notifications).where(and(eq(notifications.userId, user.id), eq(notifications.kind, "task")));
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.dedupeKey?.includes(":rest:"))).toBe(false);
  });

  it("is still idempotent: a second run the same day creates nothing", async () => {
    await seedOverdueTasks(30);
    const first = await generateNotifications(user.id, TZ);
    expect(first).toBeGreaterThan(0);
    const second = await generateNotifications(user.id, TZ);
    expect(second).toBe(0);
    const rows = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, user.id));
    expect(rows).toHaveLength(first);
  });

  it("two overlapping runs do not double anything", async () => {
    // The batch insert still leans on notifications_dedupe_uniq (migration 0008) to decide.
    await seedOverdueTasks(12);
    const [a, b] = await Promise.all([generateNotifications(user.id, TZ), generateNotifications(user.id, TZ)]);
    const rows = await db.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.kind, "task")));
    expect(rows).toHaveLength(12);
    // Between the two runs, each notice was created exactly once.
    const all = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, user.id));
    expect(a + b).toBe(all.length);
  });

  it("never notifies one account about another's backlog", async () => {
    const other = await createTestUser();
    try {
      await seedOverdueTasks(10);
      await generateNotifications(other.id, TZ);
      // The other account has its own bootstrapped data, so it may have notices — but none of them
      // may be about the 10 overdue tasks that belong to this one.
      const theirTasks = await db.select({ title: notifications.title }).from(notifications)
        .where(and(eq(notifications.userId, other.id), eq(notifications.kind, "task")));
      expect(theirTasks).toHaveLength(0);
      const mine = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, user.id));
      expect(mine).toHaveLength(0); // and nothing was written to this account either
    } finally {
      await deleteTestUser(other.id);
    }
  });
});

/**
 * Phase 3.25 — a new account is built atomically.
 *
 * Found while auditing transaction boundaries: `bootstrapUserData` was five sequential inserts, and a
 * failure at any one left the earlier ones behind. Migration 0008 made that reachable — a category
 * name is now unique per account and kind, so a retried bootstrap throws on the categories insert.
 * Reproduced before the fix: the retry left a second "Main account" row and changed nothing else.
 *
 * A half-built account cannot be repaired from the UI, which is why this is an integrity test and not
 * a performance one, even though a performance audit is what found it.
 */
d("a new account is bootstrapped all-or-nothing", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  const structural = async (id: string) => {
    const { accounts, categories, subjects, tradingAccounts, watchlists } = await import("@/server/db/schema");
    const n = async (t: never) => (await db.select().from(t).where(eq((t as unknown as { userId: typeof notifications.userId }).userId, id))).length;
    return {
      accounts: await n(accounts as never), categories: await n(categories as never), subjects: await n(subjects as never),
      trading: await n(tradingAccounts as never), watchlists: await n(watchlists as never),
    };
  };

  it("a failed retry leaves nothing behind", async () => {
    const { bootstrapUserData } = await import("@/server/services/bootstrap");
    user = await createTestUser(); // already bootstrapped once by the helper
    const before = await structural(user.id);
    expect(before.accounts).toBeGreaterThan(0);
    expect(before.categories).toBeGreaterThan(0);

    // The second call must fail — the category names collide — and must change nothing.
    await expect(bootstrapUserData(user.id)).rejects.toThrow();
    expect(await structural(user.id)).toEqual(before);
  });

  it("the structural defaults are all present after one run", async () => {
    const fresh = await createTestUser();
    try {
      const s = await structural(fresh.id);
      // One of each, and the categories; a partial set is the failure this guards against.
      expect(s.accounts).toBe(1);
      expect(s.subjects).toBe(1);
      expect(s.trading).toBe(1);
      expect(s.watchlists).toBe(1);
      expect(s.categories).toBe(20);
    } finally {
      await deleteTestUser(fresh.id);
    }
  });
});
