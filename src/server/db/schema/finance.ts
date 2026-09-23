import { boolean, date, index, integer, numeric, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { dataSourceEnum, id, timestamps, userRef } from "./_shared";

export const accountTypeEnum = pgEnum("account_type", ["checking", "savings", "cash", "credit", "investment", "other"]);
export const txTypeEnum = pgEnum("transaction_type", ["expense", "income", "transfer"]);
export const categoryKindEnum = pgEnum("category_kind", ["expense", "income"]);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull().default("checking"),
    currency: text("currency").notNull().default("EUR"),
    /** Opening balance; current balance = opening + sum(transactions). */
    openingBalance: numeric("opening_balance", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    institution: text("institution"),
    isDefault: boolean("is_default").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const categories = pgTable(
  "categories",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    kind: categoryKindEnum("kind").notNull().default("expense"),
    icon: text("icon"),
    color: text("color"),
    parentId: uuid("parent_id"),
    archived: boolean("archived").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("categories_user_idx").on(t.userId, t.kind),
    // `resolveCategory()` looks a category up by lower(name) and creates it when missing, so two
    // concurrent AI entries used to produce two "Groceries" rows and silently split the user's
    // spending between them. The index both enforces the invariant and serves that lookup.
    uniqueIndex("categories_user_kind_name_uniq").on(t.userId, t.kind, sql`lower(${t.name})`),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    userId: userRef(),
    type: txTypeEnum("type").notNull(),
    /** Always positive. Sign is derived from type. */
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").notNull().default("EUR"),
    date: date("date").notNull(),
    description: text("description").notNull().default(""),
    merchant: text("merchant"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** For transfers: destination account. */
    toAccountId: uuid("to_account_id").references(() => accounts.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    notes: text("notes"),
    recurringId: uuid("recurring_id"),
    tags: text("tags"),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("tx_user_date_idx").on(t.userId, t.date), index("tx_user_cat_idx").on(t.userId, t.categoryId)],
);

export const recurringTransactions = pgTable(
  "recurring_transactions",
  {
    id: id(),
    userId: userRef(),
    type: txTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    description: text("description").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    /** monthly | weekly | yearly */
    frequency: text("frequency").notNull().default("monthly"),
    dayOfMonth: integer("day_of_month"),
    nextDate: date("next_date").notNull(),
    endDate: date("end_date"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("recurring_user_idx").on(t.userId, t.nextDate)],
);

export const budgets = pgTable(
  "budgets",
  {
    id: id(),
    userId: userRef(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade" }),
    /** null category = total monthly budget */
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    period: text("period").notNull().default("monthly"), // monthly | weekly
    ...timestamps,
  },
  (t) => [
    index("budgets_user_idx").on(t.userId),
    // One budget per category, and — thanks to NULLS NOT DISTINCT — a single total budget too,
    // which is the row `upsertBudget()` was duplicating under concurrent calls.
    unique("budgets_user_category_uniq").on(t.userId, t.categoryId).nullsNotDistinct(),
  ],
);

export const savingsGoals = pgTable(
  "savings_goals",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    targetAmount: numeric("target_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    currentAmount: numeric("current_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    deadline: date("deadline"),
    monthlyContribution: numeric("monthly_contribution", { precision: 14, scale: 2, mode: "number" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("savings_goals_user_idx").on(t.userId)],
);
