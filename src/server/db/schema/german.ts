import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id, timestamps, userRef } from "./_shared";

/**
 * The German learning module keeps its own (serializable) Zustand state, exactly as the original
 * project does. It is persisted here per user instead of in the browser's IndexedDB, so it follows
 * the user across devices and is backed up with everything else.
 */
export const germanProgress = pgTable(
  "german_progress",
  {
    id: id(),
    userId: userRef().unique(),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    /** Monotonic revision to detect concurrent writers from two devices. */
    revision: integer("revision").notNull().default(0),
    ...timestamps,
  },
);

/** Learning events emitted by the German module; feed Studies, Goals and Analytics. */
export const germanEvents = pgTable(
  "german_events",
  {
    id: id(),
    userId: userRef(),
    kind: text("kind").notNull(), // session | unit_test | exam | daily_challenge | section
    unitId: text("unit_id"),
    label: text("label"),
    score: integer("score"),
    durationSec: integer("duration_sec"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("german_events_user_at_idx").on(t.userId, t.at)],
);
