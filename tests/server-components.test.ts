/**
 * Phase 3.10 — Server Components.
 *
 * Two pages now load their data on the server instead of fetching it after hydration. The risk that
 * introduces is not performance, it is correctness: a server page reads the session itself, so
 * ownership has to be enforced there too, and the data it hands to a client tree has to be the same
 * shape the client gets when it later refetches over HTTP — otherwise a refresh silently changes how
 * values render.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { tasks as tasksTable } from "@/server/db/schema";
import { asJson } from "@/server/page-data";
import { dashboardData } from "@/server/services/dashboard";
import { listPersonalRecords } from "@/server/services/training";
import * as tasks from "@/server/services/tasks";
import * as tr from "@/server/services/training";
import { addDaysKey, todayKey } from "@/lib/dates";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

describe("asJson: the server hands over what the API would return", () => {
  it("turns Dates into the strings a JSON response carries", () => {
    const when = new Date("2026-09-16T10:30:00.000Z");
    const out = asJson({ at: when, nested: { list: [{ at: when }] } });
    expect(typeof out.at).toBe("string");
    expect(out.at).toBe("2026-09-16T10:30:00.000Z");
    expect(typeof out.nested.list[0].at).toBe("string");
  });

  it("leaves everything else exactly as it was", () => {
    const value = { n: 0, neg: -4.5, s: "", t: true, f: false, nul: null, arr: [1, "a"], deep: { x: { y: 2 } } };
    expect(asJson(value)).toEqual(value);
  });

  it("produces the same bytes an HTTP response would", () => {
    const payload = { date: new Date("2026-01-02T03:04:05.000Z"), n: 7, s: "x" };
    expect(JSON.stringify(asJson(payload))).toBe(JSON.stringify(payload));
  });
});

d("Home's server-loaded data", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    user = await createTestUser();
    other = await createTestUser();
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "Mine on home", dueDate: todayKey(TZ) }));
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "Mine overdue", dueDate: addDaysKey(todayKey(TZ), -2) }));
    await tasks.createTask(other.id, tasks.taskCreateSchema.parse({ title: "Theirs on home", dueDate: todayKey(TZ) }));
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });

  it("is the same payload the API route returns, for the same user", async () => {
    // The route is `json(await dashboardData(user))`; the page is `asJson(await dashboardData(user))`.
    const viaService = await dashboardData(user as never);
    const viaPage = asJson(viaService);
    const viaHttpShape = JSON.parse(JSON.stringify(viaService));
    expect(viaPage).toEqual(viaHttpShape);
    expect(Object.keys(viaPage).sort()).toEqual(Object.keys(viaHttpShape).sort());
  });

  it("carries real content, so the first paint is not an empty shell", async () => {
    const data = asJson(await dashboardData(user as never));
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const titles = [...data.tasks.today, ...data.tasks.overdue].map((t) => t.title);
    expect(titles).toContain("Mine on home");
    expect(titles).toContain("Mine overdue");
    expect(data.tasks.counts.overdue).toBeGreaterThan(0);
  });

  it("contains only the signed-in user's rows", async () => {
    const data = asJson(await dashboardData(user as never));
    const titles = [...data.tasks.today, ...data.tasks.overdue].map((t) => t.title);
    expect(titles.some((t) => t.includes("Theirs"))).toBe(false);

    const theirs = asJson(await dashboardData(other as never));
    const theirTitles = [...theirs.tasks.today, ...theirs.tasks.overdue].map((t) => t.title);
    expect(theirTitles).toContain("Theirs on home");
    expect(theirTitles.some((t) => t.includes("Mine"))).toBe(false);
  });

  it("dates arrive as strings, the way the client component already reads them", async () => {
    const data = asJson(await dashboardData(user as never));
    for (const t of [...data.tasks.today, ...data.tasks.overdue]) {
      if (t.completedAt != null) expect(typeof t.completedAt).toBe("string");
      expect(typeof t.createdAt).toBe("string");
    }
    for (const e of data.events) expect(typeof e.startAt).toBe("string");
  });

  it("a mutation afterwards is reflected on the next load — the seed is not a frozen snapshot", async () => {
    const before = asJson(await dashboardData(user as never));
    const target = before.tasks.today.find((t) => t.title === "Mine on home")!;
    await tasks.completeTask(user.id, target.id, TZ);
    const after = asJson(await dashboardData(user as never));
    expect(after.tasks.today.map((t) => t.title)).not.toContain("Mine on home");
    const [row] = await db.select().from(tasksTable).where(eq(tasksTable.id, target.id));
    expect(row.status).toBe("done");
  });
});

d("the records page's server data", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    user = await createTestUser();
    other = await createTestUser();
    const s = await tr.logSet(user.id, tr.setSchema.parse({ exercise: "press banca", weightKg: 90, reps: 5, date: todayKey(TZ) }));
    await tr.updateSession(user.id, s.session.id, { finished: true, durationMinutes: 45 });
    const t = await tr.logSet(other.id, tr.setSchema.parse({ exercise: "sentadilla", weightKg: 120, reps: 3, date: todayKey(TZ) }));
    await tr.updateSession(other.id, t.session.id, { finished: true, durationMinutes: 45 });
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); if (other) await deleteTestUser(other.id); });

  it("returns this user's records, with the exercise name the page prints", async () => {
    const prs = await listPersonalRecords(user.id);
    expect(prs.length).toBeGreaterThan(0);
    for (const p of prs) {
      expect(p.exerciseName, "the page groups by this").toBeTruthy();
      expect(p.userId).toBe(user.id);
      expect(Number.isFinite(p.value)).toBe(true);
    }
  });

  it("never returns another user's records", async () => {
    const mine = await listPersonalRecords(user.id);
    const theirs = await listPersonalRecords(other.id);
    expect(mine.every((p) => p.userId === user.id)).toBe(true);
    expect(theirs.every((p) => p.userId === other.id)).toBe(true);
    const theirIds = new Set(theirs.map((p) => p.id));
    expect(mine.filter((p) => theirIds.has(p.id))).toEqual([]);
  });

  it("an account with nothing logged gets an empty list, not someone else's", async () => {
    const empty = await createTestUser();
    try {
      expect(await listPersonalRecords(empty.id)).toEqual([]);
    } finally { await deleteTestUser(empty.id); }
  });
});

describe("the server/client split is wired the way it claims", () => {
  it("Home is a Server Component that delegates to a client tree", async () => {
    const fs = await import("node:fs");
    const page = fs.readFileSync("src/app/(app)/page.tsx", "utf8");
    expect(page).not.toMatch(/^"use client"/m);
    expect(page).toContain("requireUser");
    expect(page).toContain("dashboardData");
    expect(page).toContain("HomeClient");
    // It goes through the domain service, never straight to the database.
    expect(page).not.toMatch(/from "@\/server\/db"/);
    expect(page).not.toMatch(/drizzle-orm/);

    const client = fs.readFileSync("src/app/(app)/home-client.tsx", "utf8");
    expect(client).toMatch(/^"use client"/m);
    // Seeded, and still bound to the path so invalidation and refresh keep working.
    expect(client).toContain('useApi<DashboardData>("/api/dashboard", [], initial)');
  });

  it("the records page is a Server Component with no client entry point", async () => {
    const fs = await import("node:fs");
    const page = fs.readFileSync("src/app/(app)/training/records/page.tsx", "utf8");
    expect(page).not.toMatch(/^"use client"/m);
    expect(page).toContain("listPersonalRecords");
    expect(page).not.toContain("useApi");
    expect(page).not.toMatch(/from "@\/server\/db"/);
  });

  it("every server page takes its user from the session, never from a parameter", async () => {
    const fs = await import("node:fs");
    const helper = fs.readFileSync("src/server/page-data.ts", "utf8");
    expect(helper).toContain("getCurrentUser");
    expect(helper).toContain("redirect(\"/login\")");
    // No way to ask for a different user.
    expect(helper).not.toMatch(/function requireUser\([^)]+\)/);
  });

  it("the API routes the client still uses are untouched", async () => {
    const fs = await import("node:fs");
    for (const route of ["src/app/api/dashboard/route.ts", "src/app/api/training/records/route.ts"]) {
      const src = fs.readFileSync(route, "utf8");
      expect(src, route).toContain("withAuth");
    }
  });
});
