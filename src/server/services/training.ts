import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { exercises, personalRecords, trainingDayExercises, trainingDays, trainingPlans, workoutSessions, workoutSets } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/http";
import { ROUTINE_DAYS, ROUTINE_META } from "@/server/training/routine";
import { addDaysKey, dateKey, daysBetween, todayKey, weekRange } from "@/lib/dates";
import { round2 } from "@/lib/money";
import { dateSchema } from "./tasks";
import { emitDomainEvent } from "@/server/events/bus";
import { assertOwned } from "@/server/ownership";

// ---------- Seeding the attached routine (idempotent) ----------
export async function seedRoutine(userId: string, startDate?: string) {
  const existing = await db.select({ id: trainingPlans.id }).from(trainingPlans).where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.name, ROUTINE_META.name))).limit(1);
  if (existing[0]) return existing[0].id;
  return db.transaction(async (tx) => {
    await tx.update(trainingPlans).set({ active: false }).where(eq(trainingPlans.userId, userId));
    const [plan] = await tx
      .insert(trainingPlans)
      .values({ userId, name: ROUTINE_META.name, description: ROUTINE_META.description, cycleLength: ROUTINE_META.cycleLength, startDate: startDate ?? todayKey(), active: true, rules: { ...ROUTINE_META.rules, anatomicalMap: ROUTINE_META.anatomicalMap, bodyweightKg: ROUTINE_META.bodyweightKg, caloriesTarget: ROUTINE_META.caloriesTarget, proteinTarget: ROUTINE_META.proteinTarget }, source: "import" })
      .returning();
    const exerciseIds = new Map<string, string>();
    for (const day of ROUTINE_DAYS) {
      const [d] = await tx.insert(trainingDays).values({ userId, planId: plan.id, dayIndex: day.index, name: day.name, focus: [...day.focus], isRest: day.isRest, notes: day.notes ?? null }).returning();
      for (const [i, e] of day.exercises.entries()) {
        let exerciseId = exerciseIds.get(e.name);
        if (!exerciseId) {
          const [row] = await tx.select({ id: exercises.id }).from(exercises).where(and(eq(exercises.userId, userId), eq(exercises.name, e.name))).limit(1);
          if (row) exerciseId = row.id;
          else {
            const [created] = await tx.insert(exercises).values({ userId, name: e.name, anatomicalTarget: e.target, muscleGroup: e.muscleGroup, bodyweight: !!e.bodyweight, unit: e.timed ? "s" : "kg" }).returning();
            exerciseId = created.id;
          }
          exerciseIds.set(e.name, exerciseId);
        }
        await tx.insert(trainingDayExercises).values({ userId, dayId: d.id, exerciseId, position: i + 1, sets: e.sets, reps: e.reps, repsMin: e.repsMin, repsMax: e.repsMax, intensity: e.intensity, loadNote: e.load, loadMin: e.loadMin, loadMax: e.loadMax, restSeconds: e.restSeconds, restNote: e.rest });
      }
    }
    return plan.id;
  });
}

// ---------- Plan & days ----------
export async function activePlan(userId: string) {
  const [plan] = await db.select().from(trainingPlans).where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.active, true))).limit(1);
  return plan ?? null;
}
export async function listPlans(userId: string) {
  return db.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)).orderBy(desc(trainingPlans.active), desc(trainingPlans.createdAt));
}

export async function getPlanWithDays(userId: string, planId?: string) {
  const plan = planId ? (await db.select().from(trainingPlans).where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId))))[0] : await activePlan(userId);
  if (!plan) return null;
  const days = await db.select().from(trainingDays).where(eq(trainingDays.planId, plan.id)).orderBy(asc(trainingDays.dayIndex));
  const dayIds = days.map((d) => d.id);
  const tde = dayIds.length
    ? await db
        .select({ tde: trainingDayExercises, exercise: exercises })
        .from(trainingDayExercises)
        .innerJoin(exercises, eq(exercises.id, trainingDayExercises.exerciseId))
        .where(inArray(trainingDayExercises.dayId, dayIds))
        .orderBy(asc(trainingDayExercises.position))
    : [];
  return {
    ...plan,
    days: days.map((d) => ({ ...d, exercises: tde.filter((x) => x.tde.dayId === d.id).map((x) => ({ ...x.tde, exercise: x.exercise })) })),
  };
}

/** Which cycle day corresponds to a date (0-based). */
export function cycleDayIndex(plan: { startDate: string; cycleLength: number }, date: string) {
  const diff = daysBetween(plan.startDate, date);
  return ((diff % plan.cycleLength) + plan.cycleLength) % plan.cycleLength;
}

/**
 * Whether the cycle actually placed a training day on this date.
 *
 * `cycleDayIndex` wraps negative differences, so a date *before* the plan started still maps onto a
 * cycle day. For a lookup that is harmless, but for adherence it is not: a plan created today would
 * otherwise be credited with training days earlier in the same week and the user would be told they
 * are already behind on a plan they have not started. The cycle places nothing before its start date.
 */
export function cyclePlacesWorkout(plan: { startDate: string; cycleLength: number; days: { dayIndex: number; isRest: boolean; name?: string | null }[] }, date: string) {
  if (date < plan.startDate) return null;
  const day = plan.days.find((x) => x.dayIndex === cycleDayIndex(plan, date));
  return day && !day.isRest ? day : null;
}

export async function workoutForDate(userId: string, date: string) {
  const plan = await getPlanWithDays(userId);
  if (!plan) return null;
  const idx = cycleDayIndex(plan, date);
  const day = plan.days.find((d) => d.dayIndex === idx) ?? null;
  const session = (await db.select().from(workoutSessions).where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.date, date))).orderBy(desc(workoutSessions.startedAt)).limit(1))[0] ?? null;
  return { plan: { id: plan.id, name: plan.name, cycleLength: plan.cycleLength, startDate: plan.startDate, rules: plan.rules }, dayIndex: idx, day, session };
}

export const planPatchSchema = z.object({ startDate: dateSchema.optional(), name: z.string().min(1).max(100).optional(), description: z.string().max(1000).nullish(), active: z.boolean().optional() });
export async function updatePlan(userId: string, id: string, input: z.infer<typeof planPatchSchema>) {
  if (input.active) await db.update(trainingPlans).set({ active: false }).where(eq(trainingPlans.userId, userId));
  const [p] = await db.update(trainingPlans).set(input).where(and(eq(trainingPlans.id, id), eq(trainingPlans.userId, userId))).returning();
  if (!p) throw notFound("Plan");
  return p;
}

/** Manual routine editing (spec §17: "Allow me to manually modify the routine later"). */
export const dayExerciseSchema = z.object({
  exerciseId: z.string().uuid().optional(),
  exerciseName: z.string().min(1).max(120).optional(),
  sets: z.number().int().min(1).max(20),
  reps: z.string().min(1).max(20),
  intensity: z.enum(["PESADO", "MODERADO", "LIGERO"]).nullish(),
  loadNote: z.string().max(60).nullish(),
  restSeconds: z.number().int().min(0).max(900).nullish(),
  notes: z.string().max(500).nullish(),
  position: z.number().int().min(1).optional(),
});
export async function addDayExercise(userId: string, dayId: string, input: z.infer<typeof dayExerciseSchema>) {
  const [day] = await db.select().from(trainingDays).where(and(eq(trainingDays.id, dayId), eq(trainingDays.userId, userId)));
  if (!day) throw notFound("Training day");
  let exerciseId = input.exerciseId;
  if (!exerciseId) {
    if (!input.exerciseName) throw badRequest("exerciseId or exerciseName required");
    exerciseId = (await resolveExercise(userId, input.exerciseName, true))!.id;
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(trainingDayExercises).where(eq(trainingDayExercises.dayId, dayId));
  const m = input.reps.match(/^(\d+)(?:[–-](\d+))?/);
  const [row] = await db
    .insert(trainingDayExercises)
    .values({ userId, dayId, exerciseId, position: input.position ?? Number(n) + 1, sets: input.sets, reps: input.reps, repsMin: m ? Number(m[1]) : null, repsMax: m ? Number(m[2] ?? m[1]) : null, intensity: input.intensity, loadNote: input.loadNote, restSeconds: input.restSeconds, notes: input.notes })
    .returning();
  return row;
}
export async function updateDayExercise(userId: string, id: string, input: Partial<z.infer<typeof dayExerciseSchema>>) {
  const { exerciseName: _n, exerciseId: _e, ...rest } = input;
  const [row] = await db.update(trainingDayExercises).set(rest).where(and(eq(trainingDayExercises.id, id), eq(trainingDayExercises.userId, userId))).returning();
  if (!row) throw notFound("Routine exercise");
  return row;
}
export async function removeDayExercise(userId: string, id: string) {
  await db.delete(trainingDayExercises).where(and(eq(trainingDayExercises.id, id), eq(trainingDayExercises.userId, userId)));
}
export async function updateDay(userId: string, id: string, input: { name?: string; focus?: string[]; notes?: string | null; isRest?: boolean }) {
  const [row] = await db.update(trainingDays).set(input).where(and(eq(trainingDays.id, id), eq(trainingDays.userId, userId))).returning();
  if (!row) throw notFound("Training day");
  return row;
}

// ---------- Exercises ----------
export async function listExercises(userId: string) {
  return db.select().from(exercises).where(eq(exercises.userId, userId)).orderBy(asc(exercises.name));
}
/** Fuzzy resolution ("bench", "press banca") for AI logging. */
export async function resolveExercise(userId: string, ref: string, createIfMissing = false) {
  const all = await listExercises(userId);
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const q = norm(ref);
  const aliases: Record<string, string[]> = {
    "press banca con barra": ["bench", "bench press", "banca", "press de banca", "press banca"],
    "sentadilla trasera con barra": ["squat", "sentadilla", "back squat"],
    "peso muerto rumano": ["rdl", "romanian deadlift", "rumano"],
    "press militar barra (de pie)": ["ohp", "overhead press", "militar", "press militar"],
    "dominadas (o jalon) agarre prono": ["pull up", "pull-up", "pullups", "dominadas", "jalon", "lat pulldown"],
    "remo con barra (torso 45°)": ["barbell row", "remo barra", "remo con barra"],
    "hip thrust con barra": ["hip thrust"],
    "hack squat (pies bajos)": ["hack squat", "hack"],
    "prensa (pies bajos y juntos)": ["leg press", "prensa"],
    "farmer's carry": ["farmer", "farmers carry", "farmer carry"],
  };
  let best = all.find((e) => norm(e.name) === q);
  if (!best) best = all.find((e) => (aliases[norm(e.name)] ?? []).some((a) => norm(a) === q));
  if (!best) best = all.find((e) => norm(e.name).includes(q) || q.includes(norm(e.name)));
  if (!best) {
    const words = q.split(/\s+/).filter((w) => w.length > 2);
    best = all.map((e) => ({ e, score: words.filter((w) => norm(e.name).includes(w) || (aliases[norm(e.name)] ?? []).some((a) => norm(a).includes(w))).length })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)[0]?.e;
  }
  if (!best && createIfMissing) {
    const [created] = await db.insert(exercises).values({ userId, name: ref.trim() }).returning();
    return created;
  }
  return best ?? null;
}
export const exerciseSchema = z.object({ name: z.string().min(1).max(120), anatomicalTarget: z.string().max(200).nullish(), muscleGroup: z.string().max(40).nullish(), equipment: z.string().max(60).nullish(), bodyweight: z.boolean().default(false), unit: z.enum(["kg", "s"]).default("kg"), notes: z.string().max(1000).nullish() });
export async function createExercise(userId: string, input: z.infer<typeof exerciseSchema>) {
  const [e] = await db.insert(exercises).values({ ...input, userId }).returning();
  return e;
}

// ---------- Sessions & sets ----------
export const sessionStartSchema = z.object({ date: dateSchema.optional(), dayId: z.string().uuid().nullish(), bodyweightKg: z.number().positive().nullish(), notes: z.string().max(2000).nullish(), source: z.enum(["user", "ai"]).default("user") });
export async function startSession(userId: string, input: z.infer<typeof sessionStartSchema>, tz?: string) {
  await assertOwned(userId, { trainingDay: input.dayId });
  const date = input.date ?? todayKey(tz);
  const existing = (await db.select().from(workoutSessions).where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.date, date), sql`${workoutSessions.finishedAt} is null`)).limit(1))[0];
  if (existing) return existing;
  const plan = await activePlan(userId);
  let dayId = input.dayId ?? null;
  let dayName: string | null = null;
  if (plan) {
    if (!dayId) {
      const idx = cycleDayIndex(plan, date);
      const [d] = await db.select().from(trainingDays).where(and(eq(trainingDays.planId, plan.id), eq(trainingDays.dayIndex, idx)));
      if (d && !d.isRest) { dayId = d.id; dayName = d.name; }
    } else {
      const [d] = await db.select().from(trainingDays).where(and(eq(trainingDays.id, dayId), eq(trainingDays.userId, userId)));
      dayName = d?.name ?? null;
    }
  }
  const [s] = await db.insert(workoutSessions).values({ userId, planId: plan?.id ?? null, dayId, dayName, date, bodyweightKg: input.bodyweightKg, notes: input.notes, source: input.source }).returning();
  return s;
}
export const sessionPatchSchema = z.object({ finished: z.boolean().optional(), notes: z.string().max(2000).nullish(), rating: z.number().int().min(1).max(5).nullish(), bodyweightKg: z.number().positive().nullish(), durationMinutes: z.number().int().min(1).max(600).nullish() });
export async function updateSession(userId: string, id: string, input: z.infer<typeof sessionPatchSchema>) {
  const [cur] = await db.select().from(workoutSessions).where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)));
  if (!cur) throw notFound("Workout session");
  const { finished, ...rest } = input;
  const patch: Partial<typeof workoutSessions.$inferInsert> = { ...rest };
  if (finished) {
    patch.finishedAt = new Date();
    patch.durationMinutes = input.durationMinutes ?? Math.max(1, Math.round((Date.now() - cur.startedAt.getTime()) / 60000));
  } else if (finished === false) patch.finishedAt = null;
  const [s] = await db.update(workoutSessions).set(patch).where(eq(workoutSessions.id, id)).returning();
  if (finished && !cur.finishedAt) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(workoutSets).where(and(eq(workoutSets.sessionId, id), eq(workoutSets.isWarmup, false)));
    await emitDomainEvent(userId, { type: "workout.finished", sessionId: id, date: s.date, sets: Number(n) });
  } else if (finished === false && cur.finishedAt) {
    await emitDomainEvent(userId, { type: "workout.changed", sessionId: id, date: s.date, reason: "reopened" });
  }
  return s;
}
export async function deleteSession(userId: string, id: string) {
  const [gone] = await db.delete(workoutSessions).where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId))).returning({ date: workoutSessions.date });
  if (gone) await emitDomainEvent(userId, { type: "workout.changed", sessionId: id, date: gone.date, reason: "session_deleted" });
}

export const setSchema = z.object({
  sessionId: z.string().uuid().optional(),
  exerciseId: z.string().uuid().optional(),
  exercise: z.string().max(120).optional(),
  setNumber: z.number().int().min(1).max(30).optional(),
  weightKg: z.number().min(0).max(1000).nullish(),
  reps: z.number().int().min(0).max(500).nullish(),
  seconds: z.number().int().min(0).max(3600).nullish(),
  rpe: z.number().min(1).max(10).nullish(),
  isWarmup: z.boolean().default(false),
  notes: z.string().max(500).nullish(),
  date: dateSchema.optional(),
  source: z.enum(["user", "ai"]).default("user"),
});
export async function logSet(userId: string, input: z.infer<typeof setSchema>, tz?: string) {
  await assertOwned(userId, { exercise: input.exerciseId });
  let exerciseId = input.exerciseId;
  if (!exerciseId) {
    if (!input.exercise) throw badRequest("exerciseId or exercise name is required");
    const e = await resolveExercise(userId, input.exercise);
    if (!e) throw badRequest(`Unknown exercise "${input.exercise}"`);
    exerciseId = e.id;
  }
  const session = input.sessionId ? (await db.select().from(workoutSessions).where(and(eq(workoutSessions.id, input.sessionId), eq(workoutSessions.userId, userId))))[0] : await startSession(userId, { date: input.date, source: input.source }, tz);
  if (!session) throw notFound("Workout session");
  let setNumber = input.setNumber;
  if (!setNumber) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(workoutSets).where(and(eq(workoutSets.sessionId, session.id), eq(workoutSets.exerciseId, exerciseId)));
    setNumber = Number(n) + 1;
  }
  const [set] = await db.insert(workoutSets).values({ userId, sessionId: session.id, exerciseId, setNumber, weightKg: input.weightKg, reps: input.reps, seconds: input.seconds, rpe: input.rpe, isWarmup: input.isWarmup, notes: input.notes, source: input.source }).returning();
  const prs = input.isWarmup ? [] : await updatePersonalRecords(userId, exerciseId, set);
  if (!input.isWarmup) await emitDomainEvent(userId, { type: "workout.changed", sessionId: session.id, date: session.date, reason: "set_logged" }, { tz });
  return { set, session, newRecords: prs };
}
export async function updateSet(userId: string, id: string, input: Partial<z.infer<typeof setSchema>>) {
  const { sessionId: _s, exerciseId: _e, exercise: _x, date: _d, source: _src, ...rest } = input;
  const [s] = await db.update(workoutSets).set(rest).where(and(eq(workoutSets.id, id), eq(workoutSets.userId, userId))).returning();
  if (!s) throw notFound("Set");
  await emitDomainEvent(userId, { type: "workout.changed", sessionId: s.sessionId, date: null, reason: "set_updated" });
  return s;
}
export async function deleteSet(userId: string, id: string) {
  const [gone] = await db.delete(workoutSets).where(and(eq(workoutSets.id, id), eq(workoutSets.userId, userId))).returning({ sessionId: workoutSets.sessionId });
  if (gone) await emitDomainEvent(userId, { type: "workout.changed", sessionId: gone.sessionId, date: null, reason: "set_deleted" });
}

export async function getSession(userId: string, id: string) {
  const [s] = await db.select().from(workoutSessions).where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)));
  if (!s) throw notFound("Workout session");
  const sets = await db.select({ set: workoutSets, exerciseName: exercises.name }).from(workoutSets).innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId)).where(eq(workoutSets.sessionId, id)).orderBy(asc(workoutSets.createdAt));
  const day = s.dayId ? await getDayDetail(s.dayId) : null;
  return { ...s, sets: sets.map((x) => ({ ...x.set, exerciseName: x.exerciseName })), day, volume: round2(sets.reduce((a, x) => a + (x.set.weightKg ?? 0) * (x.set.reps ?? 0), 0)) };
}
async function getDayDetail(dayId: string) {
  const [d] = await db.select().from(trainingDays).where(eq(trainingDays.id, dayId));
  if (!d) return null;
  const list = await db.select({ tde: trainingDayExercises, exercise: exercises }).from(trainingDayExercises).innerJoin(exercises, eq(exercises.id, trainingDayExercises.exerciseId)).where(eq(trainingDayExercises.dayId, dayId)).orderBy(asc(trainingDayExercises.position));
  return { ...d, exercises: list.map((x) => ({ ...x.tde, exercise: x.exercise })) };
}

/**
 * A session row is only a container. "started" = opened without work; "in_progress" = working sets logged, not closed;
 * "completed" = closed with at least one working set; "empty" = closed without any working set (not a workout).
 * Only sessions with working sets count as workouts anywhere (Home, Analytics, Reviews).
 */
export type WorkoutStatus = "started" | "in_progress" | "completed" | "empty";
export function workoutStatus(s: { finishedAt: Date | string | null; sets: number }): WorkoutStatus {
  if (s.sets > 0) return s.finishedAt ? "completed" : "in_progress";
  return s.finishedAt ? "empty" : "started";
}

export async function workoutHistory(userId: string, opts: { limit?: number; from?: string; to?: string } = {}) {
  const conds = [eq(workoutSessions.userId, userId)];
  if (opts.from) conds.push(gte(workoutSessions.date, opts.from));
  if (opts.to) conds.push(lte(workoutSessions.date, opts.to));
  const rows = await db
    .select({
      s: workoutSessions,
      sets: sql<number>`(select count(*) from workout_sets ws where ws.session_id = workout_sessions.id and ws.user_id = workout_sessions.user_id and not ws.is_warmup)`,
      volume: sql<number>`(select coalesce(sum(coalesce(ws.weight_kg,0) * coalesce(ws.reps,0)),0) from workout_sets ws where ws.session_id = workout_sessions.id and ws.user_id = workout_sessions.user_id and not ws.is_warmup)`,
      exercisesDone: sql<number>`(select count(distinct ws.exercise_id) from workout_sets ws where ws.session_id = workout_sessions.id)`,
    })
    .from(workoutSessions)
    .where(and(...conds))
    .orderBy(desc(workoutSessions.date), desc(workoutSessions.startedAt))
    .limit(opts.limit ?? 50);
  return rows.map((r) => {
    const sets = Number(r.sets);
    const status = workoutStatus({ finishedAt: r.s.finishedAt, sets });
    return { ...r.s, sets, volume: round2(Number(r.volume)), exercisesDone: Number(r.exercisesDone), status, isWorkout: sets > 0 };
  });
}

/**
 * Adherence over any range: how many of the training days the 8-day cycle places in that window were
 * actually trained (a session with at least one working set). Without an active plan there is no target
 * to measure against, so plannedDays is null rather than an invented number.
 */
export async function trainingAdherence(userId: string, range: { from: string; to: string }, tz?: string) {
  const today = todayKey(tz);
  const [plan, sessions] = await Promise.all([getPlanWithDays(userId), workoutHistory(userId, { from: range.from, to: range.to, limit: 500 })]);
  const workouts = sessions.filter((s) => s.isWorkout);
  const trainedDays = new Set(workouts.map((s) => s.date));
  if (!plan) return { range, plannedDays: null, plannedSoFar: null, completedDays: trainedDays.size, workouts: workouts.length, emptySessions: sessions.length - workouts.length, missedDays: null, extraDays: null, adherencePct: null, byDay: [], source: "calculated" as const };
  const byDay: { date: string; planned: boolean; dayName: string | null; trained: boolean }[] = [];
  let plannedDays = 0, plannedSoFar = 0, missed = 0, extra = 0, hitSoFar = 0;
  for (let d = range.from; d <= range.to; d = addDaysKey(d, 1)) {
    const day = cyclePlacesWorkout(plan, d);
    const planned = Boolean(day);
    const trained = trainedDays.has(d);
    if (planned) {
      plannedDays++;
      if (d <= today) { plannedSoFar++; if (trained) hitSoFar++; else missed++; }
    } else if (trained) extra++;
    byDay.push({ date: d, planned, dayName: day?.name ?? null, trained });
  }
  return {
    range, plannedDays, plannedSoFar, completedDays: trainedDays.size, workouts: workouts.length,
    emptySessions: sessions.length - workouts.length, missedDays: missed, extraDays: extra,
    // Only days that have already happened can be judged; a week that has not finished is not a failure.
    adherencePct: plannedSoFar > 0 ? Math.round((hitSoFar / plannedSoFar) * 100) : null,
    byDay, source: "calculated" as const,
  };
}

/**
 * Current ISO week (Mon–Sun, user's timezone): workouts done (distinct days with working sets) vs the
 * training days the active plan's cycle places in this week. No plan → plannedDays null (no invented target).
 */
export async function weeklyTrainingStatus(userId: string, tz?: string) {
  const today = todayKey(tz);
  const { start } = weekRange(new Date(today + "T12:00:00"));
  const from = dateKey(start);
  const to = addDaysKey(from, 6);
  const [plan, sessions] = await Promise.all([getPlanWithDays(userId), workoutHistory(userId, { from, to, limit: 100 })]);
  const workouts = sessions.filter((s) => s.isWorkout);
  const completedDays = new Set(workouts.map((s) => s.date)).size;
  let plannedDays: number | null = null;
  let plannedSoFar: number | null = null;
  if (plan) {
    plannedDays = 0; plannedSoFar = 0;
    for (let d = from; d <= to; d = addDaysKey(d, 1)) {
      if (cyclePlacesWorkout(plan, d)) { plannedDays++; if (d <= today) plannedSoFar++; }
    }
  }
  return { from, to, completed: completedDays, sessions: workouts.length, emptySessions: sessions.length - workouts.length, plannedDays, plannedSoFar, source: "calculated" as const };
}

/** Last performance for each exercise of a day (to compare against previous sessions). */
export async function lastPerformance(userId: string, exerciseIds: string[], beforeSessionId?: string) {
  if (!exerciseIds.length) return {} as Record<string, { date: string; sets: { weightKg: number | null; reps: number | null; seconds: number | null }[] }>;
  const rows = await db
    .select({ set: workoutSets, date: workoutSessions.date, sessionId: workoutSessions.id })
    .from(workoutSets)
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
    .where(and(eq(workoutSets.userId, userId), inArray(workoutSets.exerciseId, exerciseIds), eq(workoutSets.isWarmup, false), beforeSessionId ? sql`${workoutSessions.id} <> ${beforeSessionId}` : sql`true`))
    .orderBy(desc(workoutSessions.date), desc(workoutSets.createdAt))
    .limit(2000);
  const out: Record<string, { date: string; sets: { weightKg: number | null; reps: number | null; seconds: number | null }[] }> = {};
  for (const r of rows) {
    const cur = out[r.set.exerciseId];
    if (!cur) out[r.set.exerciseId] = { date: r.date, sets: [{ weightKg: r.set.weightKg, reps: r.set.reps, seconds: r.set.seconds }] };
    else if (cur.date === r.date) cur.sets.unshift({ weightKg: r.set.weightKg, reps: r.set.reps, seconds: r.set.seconds });
  }
  return out;
}

export async function exerciseProgress(userId: string, exerciseId: string, limit = 30) {
  const rows = await db
    .select({ date: workoutSessions.date, weightKg: workoutSets.weightKg, reps: workoutSets.reps, seconds: workoutSets.seconds, setNumber: workoutSets.setNumber })
    .from(workoutSets)
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
    .where(and(eq(workoutSets.userId, userId), eq(workoutSets.exerciseId, exerciseId), eq(workoutSets.isWarmup, false)))
    .orderBy(asc(workoutSessions.date), asc(workoutSets.createdAt));
  const byDate = new Map<string, { date: string; topWeight: number; topReps: number; est1rm: number; volume: number; sets: { weightKg: number | null; reps: number | null; seconds: number | null }[] }>();
  for (const r of rows) {
    const d = byDate.get(r.date) ?? { date: r.date, topWeight: 0, topReps: 0, est1rm: 0, volume: 0, sets: [] };
    d.sets.push({ weightKg: r.weightKg, reps: r.reps, seconds: r.seconds });
    const w = r.weightKg ?? 0, reps = r.reps ?? 0;
    d.volume += w * reps;
    if (w > d.topWeight || (w === d.topWeight && reps > d.topReps)) { d.topWeight = w; d.topReps = reps; }
    d.est1rm = Math.max(d.est1rm, epley(w, reps));
    byDate.set(r.date, d);
  }
  const series = [...byDate.values()].slice(-limit).map((d) => ({ ...d, volume: round2(d.volume), est1rm: round2(d.est1rm) }));
  const [exercise] = await db.select().from(exercises).where(eq(exercises.id, exerciseId));
  const prs = await db.select().from(personalRecords).where(and(eq(personalRecords.userId, userId), eq(personalRecords.exerciseId, exerciseId)));
  return { exercise, series, records: prs, source: "calculated" as const };
}

export const epley = (w: number, reps: number) => (reps <= 0 || w <= 0 ? 0 : reps === 1 ? w : w * (1 + reps / 30));

async function updatePersonalRecords(userId: string, exerciseId: string, set: typeof workoutSets.$inferSelect) {
  const newRecords: { kind: string; value: number }[] = [];
  const candidates: { kind: string; value: number }[] = [];
  const w = set.weightKg ?? 0, reps = set.reps ?? 0;
  if (w > 0 && reps > 0) {
    candidates.push({ kind: "max_weight", value: w });
    candidates.push({ kind: "est_1rm", value: round2(epley(w, reps)) });
    candidates.push({ kind: "max_volume_set", value: round2(w * reps) });
  }
  if (set.seconds && set.seconds > 0) candidates.push({ kind: "max_seconds", value: set.seconds });
  if (w === 0 && reps > 0) candidates.push({ kind: "max_reps_bodyweight", value: reps });
  for (const c of candidates) {
    const [cur] = await db.select().from(personalRecords).where(and(eq(personalRecords.userId, userId), eq(personalRecords.exerciseId, exerciseId), eq(personalRecords.kind, c.kind)));
    if (!cur) {
      await db.insert(personalRecords).values({ userId, exerciseId, kind: c.kind, value: c.value, reps: set.reps, weightKg: set.weightKg, setId: set.id });
      newRecords.push(c);
    } else if (c.value > cur.value) {
      await db.update(personalRecords).set({ value: c.value, reps: set.reps, weightKg: set.weightKg, setId: set.id, achievedAt: new Date() }).where(eq(personalRecords.id, cur.id));
      newRecords.push(c);
    }
  }
  return newRecords;
}

export async function listPersonalRecords(userId: string) {
  return db
    .select({ pr: personalRecords, exerciseName: exercises.name })
    .from(personalRecords)
    .innerJoin(exercises, eq(exercises.id, personalRecords.exerciseId))
    .where(eq(personalRecords.userId, userId))
    .orderBy(asc(exercises.name), asc(personalRecords.kind))
    .then((r) => r.map((x) => ({ ...x.pr, exerciseName: x.exerciseName })));
}

export async function trainingStats(userId: string, range: { from: string; to: string }) {
  // Per-session aggregates first, so a session's duration is counted once and empty sessions can be told apart.
  const per = db
    .select({
      id: workoutSessions.id,
      date: workoutSessions.date,
      minutes: workoutSessions.durationMinutes,
      // Explicit table qualification: Drizzle leaves single-table columns unqualified, which would resolve "id" to workout_sets inside the correlated subquery.
      sets: sql<number>`(select count(*) from workout_sets ws where ws.session_id = workout_sessions.id and ws.user_id = workout_sessions.user_id and not ws.is_warmup)`.as("sets"),
      volume: sql<number>`(select coalesce(sum(coalesce(ws.weight_kg,0) * coalesce(ws.reps,0)),0) from workout_sets ws where ws.session_id = workout_sessions.id and ws.user_id = workout_sessions.user_id and not ws.is_warmup)`.as("volume"),
    })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), gte(workoutSessions.date, range.from), lte(workoutSessions.date, range.to)))
    .as("per");
  const [row] = await db
    .select({
      sessions: sql<number>`count(*) filter (where ${per.sets} > 0)`,
      emptySessions: sql<number>`count(*) filter (where ${per.sets} = 0)`,
      sets: sql<number>`coalesce(sum(${per.sets}),0)`,
      volume: sql<number>`coalesce(sum(${per.volume}),0)`,
      minutes: sql<number>`coalesce(sum(${per.minutes}) filter (where ${per.sets} > 0),0)`,
    })
    .from(per);
  const weekly = await db
    .select({ week: sql<string>`to_char(date_trunc('week', ${per.date}::date), 'IYYY-"W"IW')`, sessions: sql<number>`count(*) filter (where ${per.sets} > 0)`, volume: sql<number>`coalesce(sum(${per.volume}),0)` })
    .from(per)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return { range, sessions: Number(row.sessions), emptySessions: Number(row.emptySessions), sets: Number(row.sets), volume: round2(Number(row.volume)), minutes: Number(row.minutes), weekly: weekly.map((w) => ({ week: w.week, sessions: Number(w.sessions), volume: round2(Number(w.volume)) })), source: "calculated" as const };
}
