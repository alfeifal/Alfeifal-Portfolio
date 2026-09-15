import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dataSourceEnum, id, timestamps, userRef } from "./_shared";
import { conversations } from "./core";
import { eventKindEnum, events, goals, priorityEnum, projects, tasks } from "./planning";

/**
 * Persistent planner (phase 3.2b).
 *
 * A plan is the assistant's *proposal*, kept strictly apart from the application's real data: producing
 * one never touches tasks or events. The user accepts it explicitly and only then each accepted item is
 * materialised through the normal services, with the created row's id stored back on the item — which is
 * what makes acceptance idempotent (an item that already produced a task or event is never processed
 * again). Conversations expire after 24 h (phase 3.2a), so the link to one is ON DELETE SET NULL: the
 * plan outlives the chat that produced it.
 */
export const planHorizonEnum = pgEnum("plan_horizon", ["day", "week"]);
export const planStatusEnum = pgEnum("plan_status", ["draft", "accepted", "partially_accepted", "rejected", "superseded"]);
export const planItemKindEnum = pgEnum("plan_item_kind", ["event", "task", "note"]);
export const planItemStatusEnum = pgEnum("plan_item_status", ["proposed", "accepted", "rejected", "skipped"]);

export const plans = pgTable(
  "plans",
  {
    id: id(),
    userId: userRef(),
    horizon: planHorizonEnum("horizon").notNull().default("day"),
    /** 2026-09-15 for a day, 2026-W38 for a week. */
    periodKey: text("period_key").notNull(),
    status: planStatusEnum("status").notNull().default("draft"),
    title: text("title"),
    /** The assistant's narrative for the plan (markdown). */
    content: text("content").notNull().default(""),
    /** Raw proposal payload and the context digest it was built from. */
    data: jsonb("data").$type<Record<string, unknown> | null>(),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    source: dataSourceEnum("source").notNull().default("ai"),
    ...timestamps,
  },
  (t) => [index("plans_user_period_idx").on(t.userId, t.horizon, t.periodKey), index("plans_user_status_idx").on(t.userId, t.status)],
);

export const planItems = pgTable(
  "plan_items",
  {
    id: id(),
    userId: userRef(),
    planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    kind: planItemKindEnum("kind").notNull().default("task"),
    status: planItemStatusEnum("status").notNull().default("proposed"),
    title: text("title").notNull(),
    notes: text("notes"),
    /** Day the item belongs to (task due date, or the day of an event). */
    date: date("date"),
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    estimatedMinutes: integer("estimated_minutes"),
    /** Reuses the calendar and task vocabularies instead of inventing new ones. */
    eventKind: eventKindEnum("event_kind"),
    priority: priorityEnum("priority"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    /** Generic link, same convention as events/study_sessions: { type: "training_day" | "subject" | ..., id }. */
    link: jsonb("link").$type<{ type: string; id: string } | null>(),
    /** Set when the item was materialised. Their presence is the idempotency guard. */
    createdTaskId: uuid("created_task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdEventId: uuid("created_event_id").references(() => events.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("plan_items_plan_idx").on(t.planId, t.position), index("plan_items_user_idx").on(t.userId, t.status)],
);
