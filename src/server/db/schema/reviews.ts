import { date, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { id, timestamps, userRef } from "./_shared";

/**
 * Periodic reviews (phase 3.7).
 *
 * A review keeps five things apart on purpose, because they carry different authority:
 *
 *   facts        — numbers computed from the user's rows, via Analytics. Never estimated.
 *   trends       — the same numbers against the previous comparable period.
 *   observations — statements derived from facts by explicit rules in code, not by a model.
 *   aiInsights   — a model's reading of facts and trends, always labelled as such and always optional.
 *   userNotes    — what the user wrote. The model may read it; nothing ever rewrites it.
 *
 * The base review therefore needs no API key: generation computes facts, trends and observations, and
 * enriching it with AI is a separate, later step that can fail without costing the review.
 *
 * `ai_reports` is deliberately left alone — it stores the free-text daily review and market brief, whose
 * whole content *is* the model's prose. That table has no period bounds and appends a row per run, which
 * is exactly what a review must not do.
 */
export const reviewTypeEnum = pgEnum("review_type", ["weekly", "monthly"]);
/** `generated` has facts; `reviewed` means the user has been through it and left their notes. */
export const reviewStatusEnum = pgEnum("review_status", ["generated", "reviewed"]);

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    userId: userRef(),
    type: reviewTypeEnum("type").notNull(),
    /** Inclusive bounds, in the user's timezone at generation time. */
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: reviewStatusEnum("status").notNull().default("generated"),
    /** Structured metrics per module, plus how much data each one had. */
    facts: jsonb("facts").$type<unknown>().notNull(),
    /** Period-over-period changes. Null entries mean "nothing to compare against", never zero. */
    trends: jsonb("trends").$type<unknown>().notNull(),
    /** Rule-derived statements, each carrying the metric it came from. */
    observations: jsonb("observations").$type<unknown>().notNull(),
    /** Set only when the model ran. Kept separate so it can be regenerated or dropped on its own. */
    aiInsights: jsonb("ai_insights").$type<unknown>(),
    aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
    aiModel: text("ai_model"),
    /** The user's own words. Regeneration never touches this. */
    userNotes: text("user_notes"),
    /** When the facts were last computed (distinct from createdAt, which is the first generation). */
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    // One review per user, type and period: regenerating updates that row instead of adding another.
    uniqueIndex("reviews_user_period_idx").on(t.userId, t.type, t.periodStart, t.periodEnd),
    index("reviews_user_recent_idx").on(t.userId, t.periodEnd),
  ],
);
