import { pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./core";

/** Every important record carries a provenance label (spec §34). */
export const dataSourceEnum = pgEnum("data_source", ["user", "ai", "import", "external", "calculated", "estimated"]);

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

export const id = () => uuid("id").primaryKey().defaultRandom();
export const userRef = () => uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" });
