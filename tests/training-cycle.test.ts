/**
 * Regression for the cycle/start-date bug fixed in the previous checkpoint.
 *
 * `cycleDayIndex` wraps negative differences, so a date *before* a plan's start date still maps onto a
 * cycle day. Treating that as "the cycle placed a workout here" made a plan created today look like it
 * was already behind, and made the Analytics adherence figure wrong for any window that began before
 * the plan. `cyclePlacesWorkout` is the single guard; these tests exist so the bug cannot come back
 * through either of the two callers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, deleteTestUser } from "./helpers";
import * as tr from "@/server/services/training";
import { analyticsOverview } from "@/server/services/analytics";
import { addDaysKey, todayKey } from "@/lib/dates";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";

d("training cycle never reaches back before the plan started", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let planId: string;
  const today = () => todayKey(TZ);

  beforeAll(async () => {
    user = await createTestUser();
    planId = (await tr.getPlanWithDays(user.id))!.id;
  });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  /** Puts the plan's start date exactly `n` days in the future. */
  const startInDays = async (n: number) => {
    await tr.updatePlan(user.id, planId, { startDate: addDaysKey(today(), n) });
    return (await tr.getPlanWithDays(user.id))!;
  };

  it("a plan that starts in the future places nothing before it", async () => {
    const plan = await startInDays(3);
    for (let i = 1; i <= 20; i++) {
      const before = addDaysKey(plan.startDate, -i);
      expect(tr.cyclePlacesWorkout(plan, before), `expected nothing placed on ${before}`).toBeNull();
    }
    // The very first day of the cycle is a training day, so the guard is not simply returning null.
    expect(tr.cyclePlacesWorkout(plan, plan.startDate)).not.toBeNull();
  });

  it("the guard holds a whole cycle length back, where the modulo would have wrapped", async () => {
    const plan = await startInDays(0);
    // Exactly one and two cycles before the start: these are the dates the raw modulo mapped onto
    // real training days.
    for (const back of [plan.cycleLength, plan.cycleLength * 2]) {
      const date = addDaysKey(plan.startDate, -back);
      expect(tr.cycleDayIndex(plan, date)).toBe(0);               // the modulo still wraps…
      expect(tr.cyclePlacesWorkout(plan, date)).toBeNull();       // …and is still not counted
    }
  });

  it("trainingAdherence counts no missed day before the plan existed", async () => {
    const plan = await startInDays(2); // starts the day after tomorrow
    const from = addDaysKey(plan.startDate, -14);
    const a = await tr.trainingAdherence(user.id, { from, to: addDaysKey(plan.startDate, -1) }, TZ);
    expect(a.plannedDays).toBe(0);
    expect(a.plannedSoFar).toBe(0);
    expect(a.missedDays).toBe(0);
    // Nothing to judge means no percentage, not 0 %.
    expect(a.adherencePct).toBeNull();
    expect(a.byDay.filter((x) => x.planned)).toHaveLength(0);
  });

  it("a window straddling the start date counts only the days from the start onwards", async () => {
    const plan = await startInDays(-3); // started three days ago
    const a = await tr.trainingAdherence(user.id, { from: addDaysKey(plan.startDate, -10), to: today() }, TZ);
    const plannedBefore = a.byDay.filter((x) => x.date < plan.startDate && x.planned);
    expect(plannedBefore).toHaveLength(0);
    const plannedAfter = a.byDay.filter((x) => x.date >= plan.startDate && x.planned);
    expect(a.plannedDays).toBe(plannedAfter.length);
    expect(a.plannedDays).toBeGreaterThan(0); // the days since the start are still judged normally
  });

  it("weeklyTrainingStatus does not report a brand-new plan as already behind", async () => {
    await startInDays(0); // starts today
    const w = await tr.weeklyTrainingStatus(user.id, TZ);
    // Only today onwards can have been placed, so at most the remaining days of this week.
    expect(w.plannedSoFar).toBeLessThanOrEqual(1);
    expect(w.plannedSoFar! - w.completed).toBeLessThan(2); // below the "behind" threshold
    expect(w.plannedDays!).toBeLessThanOrEqual(6);
  });

  it("weeklyTrainingStatus is unchanged for a plan that covers the whole week", async () => {
    const plan = await startInDays(-30);
    const w = await tr.weeklyTrainingStatus(user.id, TZ);
    expect(plan.startDate < w.from).toBe(true);
    // The 3-1-3-1 cycle puts 5 or 6 training days in any fully covered 7-day window.
    expect(w.plannedDays).toBeGreaterThanOrEqual(5);
    expect(w.plannedDays).toBeLessThanOrEqual(6);
    expect(w.plannedSoFar).toBeLessThanOrEqual(w.plannedDays!);
  });

  it("Analytics reports adherence through the same corrected logic", async () => {
    await startInDays(2); // the plan has not started yet
    const a = await analyticsOverview(user.id, "month", TZ);
    // A plan that has not started cannot have missed anything, so there is no percentage to show.
    expect(a.training.adherence.adherencePct).toBeNull();
    expect(a.training.adherence.plannedSoFar ?? 0).toBe(0);
  });
});
