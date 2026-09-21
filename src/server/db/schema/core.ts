import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/**
 * Two roles, and they are about *administration*, not about data.
 *
 * `admin` may manage accounts under /admin. It grants no access whatsoever to another user's
 * finance, training, journal, memory or anything else: every user-scoped query is still filtered by
 * the session's own user id. Support access / impersonation is deliberately not implemented.
 */
export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("user"),
  /** A deactivated account keeps all its data but cannot log in, and its live sessions stop resolving. */
  isActive: boolean("is_active").notNull().default(true),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /**
   * Set when an administrator creates the account: the password they handed over is a shared secret
   * by construction, so it has to be replaced before the account can be used for anything else.
   * Existing accounts are never flagged, so nobody is locked out by the migration that adds this.
   */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  timezone: text("timezone").notNull().default("Europe/Madrid"),
  currency: text("currency").notNull().default("EUR"),
  locale: text("locale").notNull().default("es-ES"),
  /** Free-form structured preferences: dashboard layout, notification settings, theme, nutrition goals... */
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the opaque cookie token; the raw token is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const auditActorEnum = pgEnum("audit_actor", ["user", "ai", "system"]);

/** Security/audit trail for every state-changing operation (spec §4, §10). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    actor: auditActorEnum("actor").notNull(),
    action: text("action").notNull(), // e.g. finance.transaction.create
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_user_created_idx").on(t.userId, t.createdAt)],
);

export const notificationKindEnum = pgEnum("notification_kind", [
  "task", "deadline", "event", "study", "training", "goal", "finance", "market", "system", "ai",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    /** Stable key to avoid duplicates for generated notifications (e.g. task:overdue:<id>:<date>). */
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt), index("notifications_dedupe_idx").on(t.userId, t.dedupeKey)],
);

// ---------------- AI ----------------
export const conversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New conversation"),
    /** e.g. assistant | quick_entry | daily_review | weekly_review | planner | market_brief | german_tutor */
    kind: text("kind").notNull().default("assistant"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Chat transcripts are temporary: a conversation lives 24 h from its last message (sliding) and is
     * then hard-deleted with its messages by the cron. Durable outcomes live elsewhere — ai_action_logs
     * (unlinked by ON DELETE SET NULL, never deleted), ai_memory, ai_reports and the modules' own tables.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '24 hours'`),
  },
  (t) => [index("ai_conv_user_idx").on(t.userId, t.updatedAt), index("ai_conv_expires_idx").on(t.expiresAt)],
);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "tool", "system"]);

export const messages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    /** Plain text for user/assistant; structured content blocks kept in `content` for faithful replay. */
    text: text("text").notNull().default(""),
    content: jsonb("content").$type<unknown>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_msg_conv_idx").on(t.conversationId, t.createdAt)],
);

export const actionStatusEnum = pgEnum("ai_action_status", ["success", "failed", "pending_confirmation", "confirmed", "rejected", "expired"]);
export const riskLevelEnum = pgEnum("ai_risk_level", ["read", "low", "medium", "high"]);

/** Every AI tool invocation (read or write) is logged (spec §10). */
export const aiActionLogs = pgTable(
  "ai_action_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    tool: text("tool").notNull(),
    risk: riskLevelEnum("risk").notNull(),
    params: jsonb("params").$type<unknown>(),
    result: jsonb("result").$type<unknown>(),
    status: actionStatusEnum("status").notNull(),
    error: text("error"),
    summary: text("summary"),
    /** Pending medium/high-risk actions can be confirmed by the user from the UI. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_actions_user_idx").on(t.userId, t.createdAt), index("ai_actions_status_idx").on(t.userId, t.status)],
);

export const memoryKindEnum = pgEnum("ai_memory_kind", ["fact", "preference", "context", "goal", "routine", "person", "note"]);

/** Structured long-term memory, inspectable and editable by the user (spec §8). */
export const aiMemory = pgTable(
  "ai_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: memoryKindEnum("kind").notNull().default("fact"),
    key: text("key"),
    content: text("content").notNull(),
    importance: integer("importance").notNull().default(3), // 1-5
    source: text("source").notNull().default("ai"), // user | ai
    pinned: boolean("pinned").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_memory_user_idx").on(t.userId, t.importance)],
);

/** Generated documents: daily review, weekly review, daily market brief (spec §15, §28, §29). */
export const aiReports = pgTable(
  "ai_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // daily_review | weekly_review | market_brief | plan
    periodKey: text("period_key").notNull(), // 2026-09-13 | 2026-W37
    content: text("content").notNull(),
    data: jsonb("data").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_reports_user_kind_idx").on(t.userId, t.kind, t.periodKey)],
);

/**
 * Shared rate-limit counters.
 *
 * The limiter used to be a `Map` in one process, which on a serverless platform means every instance
 * keeps its own tally: the real ceiling was the configured limit multiplied by however many instances
 * happened to be warm, which is neither knowable nor stable. This table is the shared tally.
 *
 * A row is one bucket in one fixed window. The limiter reads the previous window too and weights it
 * by how far the current one has advanced, so a burst straddling a boundary is not forgiven — see
 * `src/server/security/rate-limit.ts`. Rows are disposable: nothing reads them after their window has
 * rolled past, and the daily maintenance job deletes them.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    bucket: text("bucket").notNull(),
    /** Start of the fixed window this row counts, truncated to the window length. */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.windowStart] }), index("rate_limits_window_idx").on(t.windowStart)],
);

/**
 * Durable record of what each account spends on the assistant.
 *
 * It exists because the obvious source cannot be one. `ai_messages` carries the token counts, but it
 * has no `user_id` — it hangs off `ai_conversations` — and a conversation is hard-deleted 24 h after
 * its last message, taking its messages with it. Any total computed from there silently loses every
 * period older than a day. This table hangs off `users` instead, so it outlives the transcripts it
 * describes, and it is the only place that survives the purge.
 *
 * It also records what `ai_messages` never had room for: cache reads and cache writes are separate
 * columns because they are priced differently from ordinary input, so a total that folds them in is
 * wrong in both directions.
 *
 * One row per account, per day, per conversation kind. Counts only — no prompt, no reply, no title,
 * nothing anybody wrote. An administrator can see that an account spent 40k tokens on Tuesday and
 * still cannot see a single word of it.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Local calendar day for the account's own timezone, `YYYY-MM-DD`. Grouped by prefix for a month. */
    day: text("day").notNull(),
    /** assistant | quick_entry | planner | daily_review | … — the conversation kind, never its content. */
    kind: text("kind").notNull(),
    /** Provider round trips, which is what a quota would most naturally be expressed in. */
    requests: integer("requests").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull().default(0),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_usage_user_day_kind_idx").on(t.userId, t.day, t.kind),
    index("ai_usage_day_idx").on(t.day),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({ sessions: many(sessions) }));
export const conversationsRelations = relations(conversations, ({ many }) => ({ messages: many(messages) }));
export const messagesRelations = relations(messages, ({ one }) => ({ conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }) }));
