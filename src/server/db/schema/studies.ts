import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dataSourceEnum, id, timestamps, userRef } from "./_shared";

/** A subject or course (German, Bachillerato subjects, University courses, Programming, Trading Academy...). */
export const subjects = pgTable(
  "subjects",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("subject"), // subject | course | language | certification
    /** Stable slug for system-linked subjects (e.g. "german" for the integrated module). */
    slug: text("slug"),
    color: text("color"),
    description: text("description"),
    weeklyGoalMinutes: integer("weekly_goal_minutes"),
    archived: boolean("archived").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("subjects_user_idx").on(t.userId, t.slug)],
);

export const studySessions = pgTable(
  "study_sessions",
  {
    id: id(),
    userId: userRef(),
    subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes").notNull(),
    topic: text("topic"),
    notes: text("notes"),
    /** Link to the origin, e.g. { type: "german_unit", id: "u12" } */
    link: jsonb("link").$type<{ type: string; id: string } | null>(),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("study_sessions_user_date_idx").on(t.userId, t.date), index("study_sessions_subject_idx").on(t.subjectId)],
);

export const assignments = pgTable(
  "assignments",
  {
    id: id(),
    userId: userRef(),
    subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    grade: text("grade"),
    ...timestamps,
  },
  (t) => [index("assignments_user_due_idx").on(t.userId, t.dueDate)],
);

export const exams = pgTable(
  "exams",
  {
    id: id(),
    userId: userRef(),
    subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    date: date("date").notNull(),
    location: text("location"),
    notes: text("notes"),
    result: text("result"),
    ...timestamps,
  },
  (t) => [index("exams_user_date_idx").on(t.userId, t.date)],
);
