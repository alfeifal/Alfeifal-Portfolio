import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dataSourceEnum, id, timestamps, userRef } from "./_shared";

export const priorityEnum = pgEnum("priority", ["low", "medium", "high", "urgent"]);
export const taskStatusEnum = pgEnum("task_status", ["todo", "in_progress", "done", "cancelled"]);
export const goalStatusEnum = pgEnum("goal_status", ["active", "paused", "completed", "abandoned"]);
export const projectStatusEnum = pgEnum("project_status", ["idea", "planning", "active", "on_hold", "completed", "archived"]);
export const eventKindEnum = pgEnum("event_kind", ["event", "work", "training", "study", "german", "personal", "deadline", "reminder", "meal", "market"]);

export const goals = pgTable(
  "goals",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull().default("personal"), // personal|finance|training|study|german|career|trading|project|health
    status: goalStatusEnum("status").notNull().default("active"),
    priority: priorityEnum("priority").notNull().default("medium"),
    deadline: date("deadline"),
    /** Progress 0-100. Either manual or computed from metric (current/target). */
    progress: integer("progress").notNull().default(0),
    metricName: text("metric_name"),
    metricUnit: text("metric_unit"),
    metricTarget: numeric("metric_target", { precision: 14, scale: 2, mode: "number" }),
    metricCurrent: numeric("metric_current", { precision: 14, scale: 2, mode: "number" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("goals_user_status_idx").on(t.userId, t.status)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    userId: userRef(),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("milestones_goal_idx").on(t.goalId), index("milestones_project_idx").on(t.projectId)],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind").notNull().default("personal"), // business|personal|learning|financial|technical
    status: projectStatusEnum("status").notNull().default("active"),
    priority: priorityEnum("priority").notNull().default("medium"),
    deadline: date("deadline"),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    notes: text("notes"),
    progress: integer("progress").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("projects_user_status_idx").on(t.userId, t.status)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    userId: userRef(),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: priorityEnum("priority").notNull().default("medium"),
    category: text("category"), // work|study|german|training|finance|personal|project|trading
    dueDate: date("due_date"),
    dueTime: text("due_time"), // HH:MM optional
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
    /** RRULE-lite: daily | weekly:MO,WE | monthly:15 */
    recurrence: text("recurrence"),
    recurrenceParentId: uuid("recurrence_parent_id"),
    estimatedMinutes: integer("estimated_minutes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("tasks_user_status_due_idx").on(t.userId, t.status, t.dueDate), index("tasks_project_idx").on(t.projectId)],
);

export const events = pgTable(
  "events",
  {
    id: id(),
    userId: userRef(),
    title: text("title").notNull(),
    description: text("description"),
    kind: eventKindEnum("kind").notNull().default("event"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    location: text("location"),
    /** Links to other modules so the calendar is interconnected (spec §44). */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    /** Generic link: e.g. { type: "training_day", id } */
    link: jsonb("link").$type<{ type: string; id: string } | null>(),
    recurrence: text("recurrence"),
    reminderMinutes: integer("reminder_minutes"),
    color: text("color"),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("events_user_start_idx").on(t.userId, t.startAt)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: id(),
    userId: userRef(),
    date: date("date").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    kind: text("kind").notNull().default("entry"), // entry|note|reflection|event|achievement|problem|idea
    mood: integer("mood"), // 1-5
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("journal_user_date_idx").on(t.userId, t.date)],
);
