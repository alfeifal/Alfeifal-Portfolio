import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dataSourceEnum, id, timestamps, userRef } from "./_shared";

export const exercises = pgTable(
  "exercises",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    /** Anatomical target, kept verbatim from the routine ("Pecho · porción esternal (medio)"). */
    anatomicalTarget: text("anatomical_target"),
    muscleGroup: text("muscle_group"), // chest|back|shoulders|biceps|triceps|forearms|quads|hamstrings|glutes|calves|abs|adductors
    equipment: text("equipment"),
    /** true for bodyweight / timed exercises where "weight" is optional. */
    bodyweight: boolean("bodyweight").notNull().default(false),
    unit: text("unit").notNull().default("kg"), // kg | s (timed holds)
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("exercises_user_idx").on(t.userId, t.name)],
);

export const trainingPlans = pgTable(
  "training_plans",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    description: text("description"),
    /** Cycle length in days (8 for the 3-1-3-1 routine). Day index = daysSince(startDate) mod cycleLength. */
    cycleLength: integer("cycle_length").notNull().default(7),
    startDate: date("start_date").notNull(),
    active: boolean("active").notNull().default(true),
    /** Structured metadata captured from the source document: progression rules, rest rules, intensity legend... */
    rules: jsonb("rules").$type<Record<string, unknown>>().notNull().default({}),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("plans_user_active_idx").on(t.userId, t.active)],
);

export const trainingDays = pgTable(
  "training_days",
  {
    id: id(),
    userId: userRef(),
    planId: uuid("plan_id").notNull().references(() => trainingPlans.id, { onDelete: "cascade" }),
    /** 0-based position inside the cycle. */
    dayIndex: integer("day_index").notNull(),
    name: text("name").notNull(), // "Push", "Pull", "Descanso"
    focus: jsonb("focus").$type<string[]>().notNull().default([]),
    isRest: boolean("is_rest").notNull().default(false),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("training_days_plan_idx").on(t.planId, t.dayIndex)],
);

export const trainingDayExercises = pgTable(
  "training_day_exercises",
  {
    id: id(),
    userId: userRef(),
    dayId: uuid("day_id").notNull().references(() => trainingDays.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id").notNull().references(() => exercises.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    sets: integer("sets").notNull(),
    /** Verbatim rep prescription: "6", "8–10", "12/pierna", "30–45 s". */
    reps: text("reps").notNull(),
    repsMin: integer("reps_min"),
    repsMax: integer("reps_max"),
    intensity: text("intensity"), // PESADO | MODERADO | LIGERO
    loadNote: text("load_note"), // "65–75 kg", "Corporal (+5 kg si >12)"
    loadMin: numeric("load_min", { precision: 8, scale: 2, mode: "number" }),
    loadMax: numeric("load_max", { precision: 8, scale: 2, mode: "number" }),
    restSeconds: integer("rest_seconds"),
    restNote: text("rest_note"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("tde_day_idx").on(t.dayId, t.position)],
);

export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: id(),
    userId: userRef(),
    planId: uuid("plan_id").references(() => trainingPlans.id, { onDelete: "set null" }),
    dayId: uuid("day_id").references(() => trainingDays.id, { onDelete: "set null" }),
    dayName: text("day_name"),
    date: date("date").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),
    bodyweightKg: numeric("bodyweight_kg", { precision: 6, scale: 2, mode: "number" }),
    notes: text("notes"),
    rating: integer("rating"), // 1-5 perceived quality
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("sessions_user_date_idx").on(t.userId, t.date)],
);

export const workoutSets = pgTable(
  "workout_sets",
  {
    id: id(),
    userId: userRef(),
    sessionId: uuid("session_id").notNull().references(() => workoutSessions.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id").notNull().references(() => exercises.id, { onDelete: "cascade" }),
    setNumber: integer("set_number").notNull(),
    weightKg: numeric("weight_kg", { precision: 8, scale: 2, mode: "number" }),
    reps: integer("reps"),
    /** For timed sets (plank, farmer's carry). */
    seconds: integer("seconds"),
    rpe: numeric("rpe", { precision: 4, scale: 1, mode: "number" }),
    isWarmup: boolean("is_warmup").notNull().default(false),
    completed: boolean("completed").notNull().default(true),
    notes: text("notes"),
    source: dataSourceEnum("source").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sets_session_idx").on(t.sessionId), index("sets_user_exercise_idx").on(t.userId, t.exerciseId, t.createdAt)],
);

/** Materialized personal records (also recomputable from workout_sets). */
export const personalRecords = pgTable(
  "personal_records",
  {
    id: id(),
    userId: userRef(),
    exerciseId: uuid("exercise_id").notNull().references(() => exercises.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // max_weight | max_reps_at_weight | est_1rm | max_volume_set
    value: numeric("value", { precision: 10, scale: 2, mode: "number" }).notNull(),
    reps: integer("reps"),
    weightKg: numeric("weight_kg", { precision: 8, scale: 2, mode: "number" }),
    setId: uuid("set_id").references(() => workoutSets.id, { onDelete: "set null" }),
    achievedAt: timestamp("achieved_at", { withTimezone: true }).notNull().defaultNow(),
    source: dataSourceEnum("source").notNull().default("calculated"),
  },
  (t) => [index("prs_user_exercise_idx").on(t.userId, t.exerciseId, t.kind)],
);
