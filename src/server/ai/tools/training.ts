import { z } from "zod";
import { defineTool } from "../registry";
import * as tr from "@/server/services/training";
import { dateSchema } from "@/server/services/tasks";
import { todayKey } from "@/lib/dates";

defineTool({ name: "get_training_plan", module: "training", risk: "read", description: "The user's active routine: all cycle days with exercises, sets, reps, intensity, load ranges, rest, and progression rules.", schema: z.object({}), run: (_i, ctx) => tr.getPlanWithDays(ctx.user.id) });
defineTool({
  name: "get_today_workout", module: "training", risk: "read",
  description: "Workout for a date (default today): cycle day, exercises in order, and last performance per exercise for comparison.",
  schema: z.object({ date: dateSchema.optional() }),
  run: async (i, ctx) => {
    const w = await tr.workoutForDate(ctx.user.id, i.date ?? todayKey(ctx.user.timezone));
    if (!w) return null;
    const last = w.day ? await tr.lastPerformance(ctx.user.id, w.day.exercises.map((e) => e.exerciseId), w.session?.id) : {};
    const session = w.session ? await tr.getSession(ctx.user.id, w.session.id) : null;
    return { ...w, lastPerformance: last, session };
  },
});
defineTool({
  name: "log_workout", module: "training", risk: "low",
  description: "Start or finish a workout session for a date. finished=true closes the session and records duration.",
  schema: z.object({ date: dateSchema.optional(), finished: z.boolean().default(false), notes: z.string().optional(), rating: z.number().int().min(1).max(5).optional(), bodyweightKg: z.number().optional(), durationMinutes: z.number().int().optional() }),
  summarize: (i) => `log_workout — ${i.finished ? "finished" : "started"}${i.date ? " — " + i.date : ""}`,
  run: async (i, ctx) => {
    const s = await tr.startSession(ctx.user.id, { date: i.date, bodyweightKg: i.bodyweightKg, notes: i.notes, source: "ai" }, ctx.user.timezone);
    return tr.updateSession(ctx.user.id, s.id, { finished: i.finished, notes: i.notes, rating: i.rating, durationMinutes: i.durationMinutes });
  },
});
defineTool({
  name: "log_set", module: "training", risk: "low",
  description: "Log one set: exercise name (fuzzy, e.g. 'bench', 'press banca'), weightKg, reps (or seconds for timed holds). Creates today's session if needed. Returns new personal records if any.",
  schema: z.object({ exercise: z.string(), weightKg: z.number().min(0).optional(), reps: z.number().int().min(0).optional(), seconds: z.number().int().optional(), rpe: z.number().optional(), isWarmup: z.boolean().default(false), notes: z.string().optional(), date: dateSchema.optional() }),
  summarize: (i) => `log_set — ${i.exercise} — ${i.weightKg ?? 0} kg × ${i.reps ?? i.seconds + "s"}`,
  run: (i, ctx) => tr.logSet(ctx.user.id, { ...i, source: "ai" }, ctx.user.timezone),
});
defineTool({
  name: "log_sets", module: "training", risk: "low",
  description: "Log several sets of one exercise at once (e.g. '80x6, 80x6, 77.5x7').",
  schema: z.object({ exercise: z.string(), sets: z.array(z.object({ weightKg: z.number().min(0).optional(), reps: z.number().int().optional(), seconds: z.number().int().optional() })).min(1).max(15), date: dateSchema.optional() }),
  summarize: (i) => `log_sets — ${i.exercise} — ${i.sets.length} sets`,
  run: async (i, ctx) => { const out = []; for (const s of i.sets) out.push(await tr.logSet(ctx.user.id, { exercise: i.exercise, ...s, date: i.date, isWarmup: false, source: "ai" }, ctx.user.timezone)); return { logged: out.length, newRecords: out.flatMap((o) => o.newRecords), sessionId: out[0]?.session.id }; },
});
defineTool({ name: "get_workout_history", module: "training", risk: "read", description: "Past workout sessions with volume and set counts.", schema: z.object({ limit: z.number().int().max(100).default(20), from: dateSchema.optional(), to: dateSchema.optional() }), run: (i, ctx) => tr.workoutHistory(ctx.user.id, i) });
defineTool({ name: "get_workout_session", module: "training", risk: "read", description: "Full detail of one session (all sets).", schema: z.object({ id: z.string().uuid() }), run: (i, ctx) => tr.getSession(ctx.user.id, i.id) });
defineTool({
  name: "get_exercise_progress", module: "training", risk: "read",
  description: "Progression for one exercise (by name): top set, estimated 1RM and volume per session, and personal records.",
  schema: z.object({ exercise: z.string(), limit: z.number().int().max(100).default(30) }),
  run: async (i, ctx) => { const e = await tr.resolveExercise(ctx.user.id, i.exercise); if (!e) throw new Error(`Unknown exercise "${i.exercise}"`); return tr.exerciseProgress(ctx.user.id, e.id, i.limit); },
});
defineTool({ name: "get_personal_records", module: "training", risk: "read", description: "All personal records.", schema: z.object({}), run: (_i, ctx) => tr.listPersonalRecords(ctx.user.id) });
defineTool({ name: "get_training_stats", module: "training", risk: "read", description: "Training volume/frequency stats for a date range.", schema: z.object({ from: dateSchema, to: dateSchema }), run: (i, ctx) => tr.trainingStats(ctx.user.id, i) });
defineTool({
  name: "modify_routine", module: "training", risk: "medium",
  description: "Modify the routine: add an exercise to a cycle day (dayId from get_training_plan) or update/remove a routine exercise (routineExerciseId). Requires confirmation.",
  schema: z.object({ action: z.enum(["add", "update", "remove"]), dayId: z.string().uuid().optional(), routineExerciseId: z.string().uuid().optional(), exerciseName: z.string().optional(), sets: z.number().int().optional(), reps: z.string().optional(), intensity: z.enum(["PESADO", "MODERADO", "LIGERO"]).optional(), loadNote: z.string().optional(), restSeconds: z.number().int().optional(), notes: z.string().optional() }),
  needsConfirmation: (i) => `Modify routine: ${i.action} ${i.exerciseName ?? i.routineExerciseId?.slice(0, 8) ?? ""}`,
  summarize: (i) => `modify_routine — ${i.action}`,
  run: async (i, ctx) => {
    if (i.action === "add") { if (!i.dayId || !i.exerciseName || !i.sets || !i.reps) throw new Error("dayId, exerciseName, sets, reps required"); return tr.addDayExercise(ctx.user.id, i.dayId, { exerciseName: i.exerciseName, sets: i.sets, reps: i.reps, intensity: i.intensity, loadNote: i.loadNote, restSeconds: i.restSeconds, notes: i.notes }); }
    if (!i.routineExerciseId) throw new Error("routineExerciseId required");
    if (i.action === "remove") { await tr.removeDayExercise(ctx.user.id, i.routineExerciseId); return { removed: i.routineExerciseId }; }
    return tr.updateDayExercise(ctx.user.id, i.routineExerciseId, { sets: i.sets, reps: i.reps, intensity: i.intensity, loadNote: i.loadNote, restSeconds: i.restSeconds, notes: i.notes });
  },
});

defineTool({
  name: "update_training_plan", module: "training", risk: "medium",
  description:
    "Change the training plan's own settings: the date the 8-day cycle is anchored to (startDate — this shifts which day of the cycle every date falls on), its name or description, or make it the active plan. It does NOT touch the exercises: use modify_routine for those. Requires confirmation when the cycle is shifted, because every past and future day changes meaning.",
  schema: z.object({ planId: z.string().uuid().optional(), startDate: dateSchema.optional(), name: z.string().max(100).optional(), description: z.string().max(1000).optional(), active: z.boolean().optional() }),
  needsConfirmation: (i) => (i.startDate ? `Shift the training cycle to start on ${i.startDate}` : false),
  summarize: (i) => `update_training_plan — ${i.startDate ? "start " + i.startDate : i.name ?? "settings"}`,
  run: async ({ planId, ...rest }, ctx) => {
    const plan = planId ? { id: planId } : await tr.activePlan(ctx.user.id);
    if (!plan) throw new Error("No training plan found");
    return tr.updatePlan(ctx.user.id, plan.id, rest);
  },
});
defineTool({
  name: "delete_workout_set", module: "training", risk: "medium",
  description: "Delete one logged set (a mistyped weight, a duplicate). Requires confirmation. Find set ids with get_workout_session.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete set ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_workout_set — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await tr.deleteSet(ctx.user.id, i.id); return { deleted: i.id }; },
});
