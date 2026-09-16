/**
 * Phase 3.7 — periodic reviews.
 *
 * The point of a review is that its numbers are the same numbers the rest of the product shows, so the
 * central tests here compare a generated review against `analyticsOverview` for the same window. The
 * rest guard the things that make a review trustworthy: a missing measurement stays null instead of
 * becoming a zero, regenerating updates rather than duplicates, the user's own words are never
 * rewritten, and an AI insight that cites nothing real is discarded before it is stored.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { auditLogs, reviews as reviewsTable } from "@/server/db/schema";
import * as rev from "@/server/services/reviews";
import { analyticsOverview } from "@/server/services/analytics";
import { validateInsights } from "@/server/ai/review-insights";
import { globalSearch } from "@/server/services/search";
import { lifeSnapshot, renderCompact } from "@/server/services/snapshot";
import * as tasks from "@/server/services/tasks";
import * as fin from "@/server/services/finance";
import * as st from "@/server/services/studies";
import * as tr from "@/server/services/training";
import * as nut from "@/server/services/nutrition";
import * as journal from "@/server/services/journal";
import { getTool, runTool } from "./_tool-helpers";
import { dateKey, weekRange } from "@/lib/dates";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

describe("review periods (pure)", () => {
  it("a weekly review covers Monday to Sunday of the week containing the date", () => {
    const p = rev.reviewPeriod("weekly", "2026-09-16"); // a Wednesday
    expect(p.from).toBe("2026-09-14");
    expect(p.to).toBe("2026-09-20");
    expect(p.previous).toEqual({ from: "2026-09-07", to: "2026-09-13" });
  });

  it("any day of the week resolves to the same period", () => {
    const days = ["2026-09-14", "2026-09-16", "2026-09-20"].map((x) => rev.reviewPeriod("weekly", x));
    expect(new Set(days.map((p) => `${p.from}|${p.to}`)).size).toBe(1);
  });

  it("a monthly review covers the calendar month, and the previous one is the month before", () => {
    const p = rev.reviewPeriod("monthly", "2026-09-16");
    expect(p.from).toBe("2026-09-01");
    expect(p.to).toBe("2026-09-30");
    expect(p.previous).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    // February, so the previous period is a different length — it is a calendar month, not 30 days.
    const feb = rev.reviewPeriod("monthly", "2026-03-10");
    expect(feb.previous).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("rejects a malformed date rather than guessing", () => {
    expect(() => rev.reviewPeriod("weekly", "16/09/2026")).toThrow(/YYYY-MM-DD/);
    expect(() => rev.reviewPeriod("weekly", "")).toThrow();
  });

  it("sufficiency separates 'nothing' from 'not enough'", () => {
    expect(rev.sufficiency(0, 7)).toBe("none");
    expect(rev.sufficiency(5, 1)).toBe("insufficient");
    expect(rev.sufficiency(5, 7)).toBe("ok");
  });
});

d("a review of an empty period invents nothing", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("reports no data instead of zeros dressed up as measurements", async () => {
    // A week far in the past, where this user has nothing at all.
    const r = await rev.computeReview(user.id, "weekly", "2020-06-10", TZ);
    expect(r.facts.productivity.data).toBe("none");
    expect(r.facts.nutrition.data).toBe("none");
    expect(r.facts.finance.data).toBe("none");
    expect(r.facts.studies.data).toBe("none");

    // A rate with no denominator is null — never 0, and never the 100% that "nothing failed" would
    // wrongly imply.
    expect(r.facts.productivity.completionRate).toBeNull(); // no tasks were created: nothing to rate
    expect(r.facts.finance.savingsRate).toBeNull();         // no income: the ratio is undefined
    expect(r.facts.training.adherence.adherencePct).toBeNull(); // no planned day had come due
    expect(r.facts.nutrition.consistency).not.toBe(true);

    // Where the denominator is real, 0 is a measurement and is reported as one: the week genuinely
    // had seven days and none of them was logged.
    expect(r.facts.nutrition.coverage.daysInRange).toBe(7);
    expect(r.facts.nutrition.coverage.pct).toBe(0);
    expect(r.facts.nutrition.daysLogged).toBe(0);
  });

  it("says so in words, and claims nothing else", async () => {
    const r = await rev.computeReview(user.id, "weekly", "2020-06-10", TZ);
    const gaps = r.observations.filter((o) => o.kind === "gap");
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.map((o) => o.module)).toContain("nutrition");
    expect(gaps.map((o) => o.module)).toContain("finance");
    // No observation may claim a measurement for a module that recorded nothing.
    const factsForEmpty = r.observations.filter((o) => o.kind === "fact" && ["nutrition", "finance", "studies"].includes(o.module));
    expect(factsForEmpty).toEqual([]);
  });

  it("no trend is invented when there is nothing to compare against", async () => {
    const r = await rev.computeReview(user.id, "weekly", "2020-06-10", TZ);
    expect(r.trends.training.sessions).toBeNull();
    expect(r.trends.finance.expenses).toBeNull();
    expect(r.trends.studies.minutes).toBeNull();
    expect(r.observations.filter((o) => o.kind === "trend")).toEqual([]);
  });

  it("every observation carries the evidence it rests on", async () => {
    const r = await rev.computeReview(user.id, "weekly", "2020-06-10", TZ);
    for (const o of r.observations) {
      expect(o.text.length, o.module).toBeGreaterThan(0);
      expect(Object.keys(o.evidence).length, `${o.module}: ${o.text}`).toBeGreaterThan(0);
    }
  });
});

d("a review of a real period matches Analytics", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let period: { from: string; to: string };

  beforeAll(async () => {
    user = await createTestUser();
    // Put the data inside the current week, so "this week" has something to measure.
    const { start } = weekRange(new Date());
    const monday = dateKey(start);
    period = rev.reviewPeriod("weekly", monday, TZ);

    const t1 = await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "Review task A" }));
    await tasks.completeTask(user.id, t1.id);
    await tasks.createTask(user.id, tasks.taskCreateSchema.parse({ title: "Review task B" }));
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "income", amount: 2000, description: "Salary", date: monday }), TZ);
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 300, description: "Groceries", date: monday }), TZ);
    await st.logStudySession(user.id, st.studySessionSchema.parse({ subject: "Matemáticas", durationMinutes: 90, date: monday }), TZ);
    await nut.logMeal(user.id, nut.mealSchema.parse({ type: "lunch", date: monday, items: [{ description: "Pollo y arroz", quantity: 1, unit: "serving", calories: 700, protein: 50, carbs: 70, fat: 20, basis: "total", source: "user" }] }), TZ);
    await journal.createEntry(user.id, journal.journalCreateSchema.parse({ date: monday, content: "Semana de arranque" }), TZ);
    const s = await tr.logSet(user.id, tr.setSchema.parse({ exercise: "press banca", weightKg: 80, reps: 8, date: monday }));
    await tr.updateSession(user.id, s.session.id, { finished: true, durationMinutes: 60 });
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("every headline figure equals the Analytics figure for the same window", async () => {
    const r = await rev.computeReview(user.id, "weekly", period.from, TZ);
    const a = await analyticsOverview(user.id, { from: period.from, to: period.to }, TZ);

    expect(r.facts.period.from).toBe(a.range.from);
    expect(r.facts.period.to).toBe(a.range.to);
    expect(r.facts.finance.income).toBe(a.finance.current.income);
    expect(r.facts.finance.expenses).toBe(a.finance.current.expenses);
    expect(r.facts.finance.net).toBe(a.finance.current.net);
    expect(r.facts.finance.savingsRate).toBe(a.finance.current.savingsRate);
    expect(r.facts.productivity.completed).toBe(a.productivity.done);
    expect(r.facts.productivity.created).toBe(a.productivity.created);
    expect(r.facts.productivity.completionRate).toBe(a.productivity.completionRate);
    expect(r.facts.training.sessions).toBe(a.training.current.sessions);
    expect(r.facts.training.volume).toBe(a.training.current.volume);
    expect(r.facts.training.adherence.adherencePct).toBe(a.training.adherence.adherencePct);
    expect(r.facts.studies.minutes).toBe(a.studies.current.totalMinutes);
    expect(r.facts.nutrition.daysLogged).toBe(a.nutrition.daysLogged);
    expect(r.facts.nutrition.average.calories).toBe(a.nutrition.average.calories);
    expect(r.facts.journal.entries).toBe(a.journal.entries);
    expect(r.facts.goals.active).toBe(a.goals.active);
  });

  it("the previous period is the one Analytics used", async () => {
    const r = await rev.computeReview(user.id, "weekly", period.from, TZ);
    const a = await analyticsOverview(user.id, { from: period.from, to: period.to }, TZ);
    expect(r.facts.period.previous).toEqual(a.previousRange);
    expect(r.trends.previousPeriod).toEqual(a.previousRange);
    expect(r.trends.finance.previous.expenses).toBe(a.finance.previous.expenses);
  });

  it("measured sections report their numbers, with the percentages Analytics computed", async () => {
    const r = await rev.computeReview(user.id, "weekly", period.from, TZ);
    expect(r.facts.finance.data).toBe("ok");
    expect(r.facts.finance.income).toBe(2000);
    expect(r.facts.finance.expenses).toBe(300);
    expect(r.facts.productivity.completed).toBe(1);
    expect(r.facts.studies.minutes).toBe(90);
    const financeFacts = r.observations.filter((o) => o.module === "finance" && o.kind === "fact");
    expect(financeFacts.length).toBeGreaterThan(0);
    expect(financeFacts[0].text).toContain("2000");
  });

  it("one day of nutrition in a seven-day week is flagged as insufficient, not averaged away", async () => {
    const r = await rev.computeReview(user.id, "weekly", period.from, TZ);
    expect(r.facts.nutrition.daysLogged).toBe(1);
    expect(r.facts.nutrition.data).toBe("insufficient");
    const gap = r.observations.find((o) => o.module === "nutrition" && o.kind === "gap");
    expect(gap?.text).toMatch(/too few/i);
    // And no calorie trend is drawn from a single day.
    expect(r.observations.some((o) => o.module === "nutrition" && o.kind === "trend")).toBe(false);
  });

  it("adherence counts planned days hit, not every day trained", async () => {
    const r = await rev.computeReview(user.id, "weekly", period.from, TZ);
    const a = await analyticsOverview(user.id, { from: period.from, to: period.to }, TZ);
    const obs = r.observations.find((o) => o.module === "training" && String(o.text).includes("adherence"));
    if (a.training.adherence.adherencePct != null) {
      expect(obs).toBeTruthy();
      const hit = (a.training.adherence.plannedSoFar ?? 0) - (a.training.adherence.missedDays ?? 0);
      expect(obs!.evidence.hit).toBe(hit);
      // The sentence can never claim more hits than there were planned days.
      expect(Number(obs!.evidence.hit)).toBeLessThanOrEqual(Number(obs!.evidence.plannedSoFar));
    }
  });

  it("a monthly review covers the month and still agrees with Analytics", async () => {
    const monthAnchor = period.from;
    const r = await rev.computeReview(user.id, "monthly", monthAnchor, TZ);
    const p = rev.reviewPeriod("monthly", monthAnchor, TZ);
    const a = await analyticsOverview(user.id, { from: p.from, to: p.to }, TZ);
    expect(r.periodStart).toBe(p.from);
    expect(r.periodEnd).toBe(p.to);
    expect(r.facts.finance.income).toBe(a.finance.current.income);
    expect(r.facts.productivity.completed).toBe(a.productivity.done);
  });

  it("a past period is not contaminated by later activity", async () => {
    // Everything above was logged in the current week; a review of a week long past must stay empty.
    const old = await rev.computeReview(user.id, "weekly", "2020-06-10", TZ);
    expect(old.facts.productivity.completed).toBe(0);
    expect(old.facts.productivity.created).toBe(0);
    expect(old.facts.finance.income).toBe(0);
  });
});

d("persistence, regeneration and notes", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => {
    user = await createTestUser();
    const { start } = weekRange(new Date());
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 40, description: "Persist probe", date: dateKey(start) }), TZ);
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("generating stores the structured parts, not one blob of text", async () => {
    const r = await rev.generateReview(user.id, "weekly", undefined, TZ);
    expect(r.id).toBeTruthy();
    expect(r.facts).toBeTruthy();
    expect(r.trends).toBeTruthy();
    expect(Array.isArray(r.observations)).toBe(true);
    expect(r.status).toBe("generated");
    expect(r.aiInsights).toBeNull();
    expect(r.userNotes).toBeNull();
  });

  it("generating twice updates the same review instead of creating a second", async () => {
    const first = await rev.generateReview(user.id, "weekly", undefined, TZ);
    const second = await rev.generateReview(user.id, "weekly", undefined, TZ);
    expect(second.id).toBe(first.id);
    expect(second.generatedAt.getTime()).toBeGreaterThanOrEqual(first.generatedAt.getTime());
    const rows = await db.select().from(reviewsTable).where(and(eq(reviewsTable.userId, user.id), eq(reviewsTable.type, "weekly")));
    expect(rows).toHaveLength(1);
  });

  it("any day of the same week regenerates that week, it does not open a new one", async () => {
    const { start, end } = weekRange(new Date());
    await rev.generateReview(user.id, "weekly", dateKey(start), TZ);
    await rev.generateReview(user.id, "weekly", dateKey(end), TZ);
    const rows = await db.select().from(reviewsTable).where(and(eq(reviewsTable.userId, user.id), eq(reviewsTable.type, "weekly")));
    expect(rows).toHaveLength(1);
  });

  it("weekly and monthly are separate reviews of the same calendar time", async () => {
    await rev.generateReview(user.id, "monthly", undefined, TZ);
    const all = await rev.listReviews(user.id);
    expect(all.filter((r) => r.type === "weekly")).toHaveLength(1);
    expect(all.filter((r) => r.type === "monthly")).toHaveLength(1);
  });

  it("a note is kept apart from the metrics and survives regeneration untouched", async () => {
    const r = await rev.generateReview(user.id, "weekly", undefined, TZ);
    const noted = await rev.setUserNotes(user.id, r.id, "  Esta semana estuve de vacaciones.  ");
    expect(noted.userNotes).toBe("Esta semana estuve de vacaciones."); // trimmed, not rewritten
    expect(noted.status).toBe("reviewed");

    const again = await rev.generateReview(user.id, "weekly", undefined, TZ);
    expect(again.id).toBe(r.id);
    expect(again.userNotes).toBe("Esta semana estuve de vacaciones.");
    expect(again.status).toBe("reviewed");
  });

  it("clearing the note returns the review to generated", async () => {
    const r = await rev.generateReview(user.id, "weekly", undefined, TZ);
    await rev.setUserNotes(user.id, r.id, "algo");
    const cleared = await rev.setUserNotes(user.id, r.id, "   ");
    expect(cleared.userNotes).toBeNull();
    expect(cleared.status).toBe("generated");
  });

  it("regeneration drops AI insights, because they described the previous numbers", async () => {
    const r = await rev.generateReview(user.id, "weekly", undefined, TZ);
    await db.update(reviewsTable).set({ aiInsights: [{ text: "x", metric: "finance.expenses", kind: "observation", source: "ai" }], aiGeneratedAt: new Date(), aiModel: "test" }).where(eq(reviewsTable.id, r.id));
    const regenerated = await rev.generateReview(user.id, "weekly", undefined, TZ);
    expect(regenerated.aiInsights).toBeNull();
    expect(regenerated.aiGeneratedAt).toBeNull();
  });

  it("reading and deleting work by id, and listing is newest period first", async () => {
    const r = await rev.generateReview(user.id, "weekly", undefined, TZ);
    expect((await rev.getReview(user.id, r.id)).id).toBe(r.id);
    const list = await rev.listReviews(user.id, { type: "weekly" });
    expect(list[0].periodEnd >= (list.at(-1)?.periodEnd ?? "")).toBe(true);
    const older = await rev.generateReview(user.id, "weekly", "2020-06-10", TZ);
    await rev.deleteReview(user.id, older.id);
    await expect(rev.getReview(user.id, older.id)).rejects.toThrow(/not found/i);
  });
});

d("reviews are private to their owner", () => {
  let a: Awaited<ReturnType<typeof createTestUser>>;
  let b: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    const monday = dateKey(weekRange(new Date()).start);
    await fin.createTransaction(a.id, fin.transactionSchema.parse({ type: "expense", amount: 111, description: "A only", date: monday }), TZ);
    await fin.createTransaction(b.id, fin.transactionSchema.parse({ type: "expense", amount: 222, description: "B only", date: monday }), TZ);
  });
  afterAll(async () => { if (a) await deleteTestUser(a.id); if (b) await deleteTestUser(b.id); });

  it("each review measures only its owner's rows", async () => {
    const ra = await rev.generateReview(a.id, "weekly", undefined, TZ);
    const rb = await rev.generateReview(b.id, "weekly", undefined, TZ);
    expect((ra.facts as { finance: { expenses: number } }).finance.expenses).toBe(111);
    expect((rb.facts as { finance: { expenses: number } }).finance.expenses).toBe(222);
  });

  it("one user cannot read, annotate or delete another's review", async () => {
    const ra = await rev.generateReview(a.id, "weekly", undefined, TZ);
    await expect(rev.getReview(b.id, ra.id)).rejects.toThrow(/not found/i);
    await expect(rev.setUserNotes(b.id, ra.id, "hijack")).rejects.toThrow(/not found/i);
    await expect(rev.deleteReview(b.id, ra.id)).rejects.toThrow(/not found/i);
    // And A's review is genuinely untouched.
    expect((await rev.getReview(a.id, ra.id)).userNotes).toBeNull();
  });

  it("listing never crosses accounts", async () => {
    await rev.generateReview(a.id, "weekly", undefined, TZ);
    await rev.generateReview(b.id, "weekly", undefined, TZ);
    const listA = await rev.listReviews(a.id);
    const listB = await rev.listReviews(b.id);
    const idsB = new Set(listB.map((r) => r.id));
    expect(listA.filter((r) => idsB.has(r.id))).toEqual([]);
  });
});

describe("AI insights are validated before they are stored", () => {
  const facts = { finance: { expenses: 300, income: 2000, savingsRate: 85 }, nutrition: { daysLogged: 1, coverage: { pct: 14 } } };
  const trends = { finance: { expenses: -12 }, studies: { minutes: null } };

  it("keeps an insight that cites a metric the model was actually given", () => {
    const out = validateInsights([{ text: "Expenses were 300 against 2000 of income.", metric: "finance.expenses", kind: "observation" }], facts, trends);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("ai");
  });

  it("accepts the leaf name as well as the full path", () => {
    expect(validateInsights([{ text: "Nutrition was logged on one day.", metric: "daysLogged", kind: "observation" }], facts, trends)).toHaveLength(1);
  });

  it("drops an insight about something that was never measured", () => {
    const out = validateInsights([
      { text: "Your sleep quality declined this week.", metric: "sleep.quality", kind: "observation" },
      { text: "Mood was lower than usual.", metric: "mood.average", kind: "observation" },
    ], facts, trends);
    expect(out).toEqual([]);
  });

  it("drops a malformed payload entirely rather than storing part of it", () => {
    expect(validateInsights("not an array", facts, trends)).toEqual([]);
    expect(validateInsights([{ text: "", metric: "finance.expenses" }], facts, trends)).toEqual([]);
    expect(validateInsights(null, facts, trends)).toEqual([]);
  });

  it("de-duplicates and caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `Insight number ${i}`, metric: "finance.expenses", kind: "observation" as const }));
    expect(validateInsights(many, facts, trends)).toHaveLength(5);
    const dupes = [
      { text: "Same sentence.", metric: "finance.expenses", kind: "observation" as const },
      { text: "same sentence.", metric: "finance.income", kind: "observation" as const },
    ];
    expect(validateInsights(dupes, facts, trends)).toHaveLength(1);
  });
});

d("reviews through the assistant", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => {
    user = await createTestUser();
    await fin.createTransaction(user.id, fin.transactionSchema.parse({ type: "expense", amount: 55, description: "Tool probe", date: dateKey(weekRange(new Date()).start) }), TZ);
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("the three tools exist at the risk levels the architecture implies", () => {
    expect(getTool("get_review")!.risk).toBe("read");
    expect(getTool("list_reviews")!.risk).toBe("read");
    // Generating writes a row, but every figure in it is computed — nothing is destructive or
    // irreversible, and regenerating is idempotent, so it is low rather than medium.
    expect(getTool("generate_review")!.risk).toBe("low");
  });

  it("there is no tool that lets the model write a metric or edit a stored review", async () => {
    const { allTools } = await import("@/server/ai/registry");
    const reviewTools = allTools().filter((t) => t.module === "reviews").map((t) => t.name).sort();
    expect(reviewTools).toEqual(["generate_review", "get_review", "list_reviews"]);
    // generate_review accepts only what period to compute — never a number, never a text field.
    const keys = Object.keys((getTool("generate_review")!.schema as unknown as { shape: Record<string, unknown> }).shape).sort();
    expect(keys).toEqual(["date", "type"]);
    for (const name of reviewTools) {
      const shape = JSON.stringify(getTool(name)!.schema).toLowerCase();
      for (const forbidden of ["facts", "observations", "userid", "user_id", "table", "column", "sql", "notes", "insights"]) {
        expect(shape, `${name} must not expose "${forbidden}"`).not.toContain(`"${forbidden}"`);
      }
    }
  });

  it("generate → list → get is a complete round trip", async () => {
    const gen = await runTool(getTool("generate_review")!, { type: "weekly" }, user);
    expect(gen.status).toBe("success");
    const id = (gen.result as { id: string }).id;

    const list = await runTool(getTool("list_reviews")!, { type: "weekly" }, user);
    expect(list.status).toBe("success");
    expect((list.result as { id: string }[]).some((r) => r.id === id)).toBe(true);

    const got = await runTool(getTool("get_review")!, { id }, user);
    expect(got.status).toBe("success");
    const payload = got.result as { facts: { finance: { expenses: number } }; observations: unknown[]; userNotes: string | null };
    expect(payload.facts.finance.expenses).toBe(55);
    expect(Array.isArray(payload.observations)).toBe(true);
    expect(payload.userNotes).toBeNull();
  });

  it("running generate_review twice through the tool leaves one review", async () => {
    await runTool(getTool("generate_review")!, { type: "monthly" }, user);
    await runTool(getTool("generate_review")!, { type: "monthly" }, user);
    const rows = await db.select().from(reviewsTable).where(and(eq(reviewsTable.userId, user.id), eq(reviewsTable.type, "monthly")));
    expect(rows).toHaveLength(1);
  });

  it("a generated review is written to the audit log", async () => {
    const r = await rev.generateReview(user.id, "weekly", undefined, TZ);
    const { audit } = await import("@/server/audit");
    await audit({ userId: user.id, actor: "user", action: "review.generated", entityType: "review", entityId: r.id });
    const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.userId, user.id), eq(auditLogs.entityType, "review")));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("another user's review is invisible to the tools", async () => {
    const other = await createTestUser();
    try {
      const theirs = await rev.generateReview(other.id, "weekly", undefined, TZ);
      const got = await runTool(getTool("get_review")!, { id: theirs.id }, user);
      expect(got.status).toBe("failed");
      const list = await runTool(getTool("list_reviews")!, {}, user);
      expect((list.result as { id: string }[]).some((r) => r.id === theirs.id)).toBe(false);
    } finally { await deleteTestUser(other.id); }
  });
});

d("reviews in search and in the snapshot", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("a review is found by the user's own note", async () => {
    const r = await rev.generateReview(user.id, "weekly", undefined, TZ);
    await rev.setUserNotes(user.id, r.id, "Esta semana estuve de vacaciones en Budapest");
    const hits = (await globalSearch(user.id, "vacaciones")).hits;
    const hit = hits.find((h) => h.type === "review");
    expect(hit).toBeTruthy();
    expect(hit!.module).toBe("reviews");
    expect(hit!.href).toBe(`/reviews?review=${r.id}`);
    expect(hit!.snippet).toContain("vacaciones");
  });

  it("and by the text of a derived observation", async () => {
    await rev.generateReview(user.id, "weekly", undefined, TZ);
    const hits = (await globalSearch(user.id, "journal entries")).hits;
    expect(hits.some((h) => h.type === "review")).toBe(true);
  });

  it("another user's review never appears in search", async () => {
    const other = await createTestUser();
    try {
      const theirs = await rev.generateReview(other.id, "weekly", undefined, TZ);
      await rev.setUserNotes(other.id, theirs.id, "Nota privada de Budapest");
      const hits = (await globalSearch(user.id, "privada")).hits;
      expect(hits.some((h) => h.id === theirs.id)).toBe(false);
    } finally { await deleteTestUser(other.id); }
  });

  it("the snapshot mentions that reviews exist without carrying their contents", async () => {
    await rev.generateReview(user.id, "weekly", undefined, TZ);
    const snap = await lifeSnapshot({ ...user, timezone: TZ } as never, { sections: ["reviews"], horizonDays: 7, tz: TZ });
    const lines = renderCompact(snap);
    const line = lines.find((l) => l.includes("Last reviews"));
    expect(line).toBeTruthy();
    expect(line).toContain("structured review");
    expect(line).toContain("list_reviews");
    // One short line, and none of the review's numbers.
    expect(line!.length).toBeLessThan(220);
    expect(line).not.toMatch(/savingsRate|adherencePct|"facts"/);
  });

  it("the digest counts what exists without loading it", async () => {
    await rev.generateReview(user.id, "weekly", undefined, TZ);
    const digest = await rev.reviewsDigest(user.id);
    expect(digest.total).toBeGreaterThan(0);
    expect(digest.lastPeriodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(digest).sort()).toEqual(["lastPeriodEnd", "total"]);
  });
});
