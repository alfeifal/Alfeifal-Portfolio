/**
 * Concurrency regression suite (phase 3.21).
 *
 * Every job below used to be described as "idempotent", but that had only ever been checked by
 * calling it twice in a row. Both schedulers this app runs on document *duplicate delivery*
 * (Vercel cron is best-effort; GitHub Actions can overlap a slow run with the next one), and the
 * app itself can issue the same write from two requests at once. These tests call each entry point
 * N times concurrently against a real Postgres and assert the table ends up with exactly one row.
 *
 * They fail against check-then-insert code. They pass once the write is guarded by a unique index
 * and an ON CONFLICT clause (migration 0008).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { notifications, categories, budgets, watchlists, watchlistItems } from "@/server/db/schema";
import { notify } from "@/server/services/notifications";
import { createCategory, resolveCategory, updateCategory, upsertBudget } from "@/server/services/finance";
import { AppError } from "@/server/http";
import { addWatchlistItem } from "@/server/services/trading";
import { createTestUser, deleteTestUser } from "./helpers";

/** Kept under the pool size (10) so the calls really do overlap instead of queueing behind it. */
const N = 8;
const fanOut = <T>(fn: (i: number) => Promise<T>) => Promise.allSettled(Array.from({ length: N }, (_, i) => fn(i)));

let userId: string;
beforeAll(async () => {
  userId = (await createTestUser()).id;
  // A cold pool serialises the fan-out while it opens connections, which hides the race: with an
  // empty pool `notify` lands a single row even though the code is unguarded. Open N connections
  // first so the calls below genuinely overlap.
  for (let i = 0; i < 3; i++) await Promise.all(Array.from({ length: N }, () => db.execute(sql`select pg_sleep(0.05)`)));
});
afterAll(async () => { if (userId) await deleteTestUser(userId); });

describe("concurrent writes settle on a single row", () => {
  it("notify() with the same dedupeKey inserts once", async () => {
    const dedupeKey = `concurrency:notify:${Date.now()}`;
    const results = await fanOut(() => notify(userId, { kind: "task", title: "Overdue", dedupeKey }));

    const rows = await db.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.dedupeKey, dedupeKey)));
    expect(rows).toHaveLength(1);
    // Exactly one caller may claim it created the notification; the rest must see the dedupe.
    const created = results.filter((r) => r.status === "fulfilled" && r.value !== null);
    expect(created).toHaveLength(1);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("notify() without a dedupeKey is still allowed to insert every time", async () => {
    // The guard must key off dedupe_key, not suppress ordinary notifications.
    const title = `Plain ${Date.now()}`;
    await fanOut(() => notify(userId, { kind: "task", title }));
    const rows = await db.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.title, title)));
    expect(rows).toHaveLength(N);
  });

  it("resolveCategory() with the same name creates one category", async () => {
    const name = `Concurrency ${Date.now()}`;
    const results = await fanOut(() => resolveCategory(userId, name, "expense"));

    const rows = await db.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.kind, "expense"), sql`lower(${categories.name}) = lower(${name})`));
    expect(rows).toHaveLength(1);
    // Every caller must end up holding that same row — resolving must never fail or return null.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
    expect(ids.size).toBe(1);
  });

  it("resolveCategory() is case-insensitive under concurrency", async () => {
    const base = `Mixed ${Date.now()}`;
    const spellings = [base.toLowerCase(), base.toUpperCase(), base];
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) => resolveCategory(userId, spellings[i % spellings.length], "expense")),
    );
    const rows = await db.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.kind, "expense"), sql`lower(${categories.name}) = lower(${base})`));
    expect(rows).toHaveLength(1);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("upsertBudget() for the total budget (null category) keeps one row", async () => {
    const results = await fanOut((i) => upsertBudget(userId, { amount: 100 + i, period: "monthly" }));

    const rows = await db.select({ id: budgets.id }).from(budgets)
      .where(and(eq(budgets.userId, userId), isNull(budgets.categoryId)));
    expect(rows).toHaveLength(1);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("upsertBudget() for a category keeps one row", async () => {
    const category = await resolveCategory(userId, `Budgeted ${Date.now()}`, "expense");
    const results = await fanOut((i) => upsertBudget(userId, { categoryId: category.id, amount: 50 + i, period: "monthly" }));

    const rows = await db.select({ id: budgets.id }).from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.categoryId, category.id)));
    expect(rows).toHaveLength(1);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("addWatchlistItem() with the same symbol adds it once", async () => {
    const [wl] = await db.insert(watchlists).values({ userId, name: `WL ${Date.now()}` }).returning();
    const symbol = "AAPL";
    const results = await fanOut(() => addWatchlistItem(userId, { watchlistId: wl.id, symbol, assetClass: "stock" }));

    const rows = await db.select({ id: watchlistItems.id }).from(watchlistItems)
      .where(and(eq(watchlistItems.watchlistId, wl.id), eq(watchlistItems.symbol, symbol)));
    expect(rows).toHaveLength(1);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });
});

describe("the constraints behind those writes, seen from the API", () => {
  it("rejects a second category with the same name as a clean 400, not a driver error", async () => {
    const name = `Duplicate ${Date.now()}`;
    await createCategory(userId, { name, kind: "expense" });
    // Different case and padding: the index matches on lower(name) over the trimmed value.
    const err = await createCategory(userId, { name: `  ${name.toUpperCase()}  `, kind: "expense" }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(400);
    expect((err as AppError).message).toMatch(/already have/i);
  });

  it("rejects renaming a category onto one that already exists", async () => {
    const taken = `Taken ${Date.now()}`;
    await createCategory(userId, { name: taken, kind: "expense" });
    const other = await createCategory(userId, { name: `Other ${Date.now()}`, kind: "expense" });
    const err = await updateCategory(userId, other.id, { name: taken }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(400);
  });

  it("still allows the same name for the other kind, and for another user", async () => {
    const name = `Shared ${Date.now()}`;
    await createCategory(userId, { name, kind: "expense" });
    await expect(createCategory(userId, { name, kind: "income" })).resolves.toBeTruthy();
    const other = await createTestUser();
    try {
      await expect(createCategory(other.id, { name, kind: "expense" })).resolves.toBeTruthy();
    } finally {
      await deleteTestUser(other.id);
    }
  });

  it("keeps a budget per category and a separate total budget", async () => {
    // A user of its own: the concurrency cases above already left budgets on the shared one.
    const owner = await createTestUser();
    try {
      const a = await resolveCategory(owner.id, "Budget A", "expense");
      const b = await resolveCategory(owner.id, "Budget B", "expense");
      await upsertBudget(owner.id, { categoryId: a.id, amount: 10, period: "monthly" });
      await upsertBudget(owner.id, { categoryId: b.id, amount: 20, period: "monthly" });
      await upsertBudget(owner.id, { amount: 30, period: "monthly" });
      // Re-running the upsert must update in place rather than add a fourth row.
      const again = await upsertBudget(owner.id, { categoryId: a.id, amount: 15, period: "monthly" });
      expect(again.amount).toBe(15);
      const rows = await db.select({ categoryId: budgets.categoryId }).from(budgets).where(eq(budgets.userId, owner.id));
      expect(rows).toHaveLength(3);
      expect(rows.filter((r) => r.categoryId === null)).toHaveLength(1);
    } finally {
      await deleteTestUser(owner.id);
    }
  });
});
