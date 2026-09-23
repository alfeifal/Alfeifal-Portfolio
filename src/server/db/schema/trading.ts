import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { dataSourceEnum, id, timestamps, userRef } from "./_shared";

/** REAL vs SIMULATED are never mixed (spec §13). Every trade belongs to an account with a fixed mode. */
export const tradingModeEnum = pgEnum("trading_mode", ["real", "paper"]);
export const tradeDirectionEnum = pgEnum("trade_direction", ["long", "short"]);
export const tradeStatusEnum = pgEnum("trade_status", ["planned", "open", "closed", "cancelled"]);

export const tradingAccounts = pgTable(
  "trading_accounts",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    mode: tradingModeEnum("mode").notNull(),
    broker: text("broker"),
    currency: text("currency").notNull().default("EUR"),
    startingBalance: numeric("starting_balance", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    /** Default max risk per trade in % of balance. */
    riskPerTradePct: numeric("risk_per_trade_pct", { precision: 5, scale: 2, mode: "number" }).notNull().default(1),
    ...timestamps,
  },
  (t) => [index("trading_accounts_user_idx").on(t.userId, t.mode)],
);

export const strategies = pgTable(
  "strategies",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    description: text("description"),
    rules: text("rules"),
    timeframes: text("timeframes"),
    archived: boolean("archived").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("strategies_user_idx").on(t.userId)],
);

/** Trades double as the trading journal: one row = one trade with its journal fields. */
export const trades = pgTable(
  "trades",
  {
    id: id(),
    userId: userRef(),
    accountId: uuid("account_id").notNull().references(() => tradingAccounts.id, { onDelete: "cascade" }),
    mode: tradingModeEnum("mode").notNull(), // denormalized copy of account mode for safe filtering
    symbol: text("symbol").notNull(),
    assetClass: text("asset_class").notNull().default("stock"),
    direction: tradeDirectionEnum("direction").notNull().default("long"),
    status: tradeStatusEnum("status").notNull().default("open"),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
    timeframe: text("timeframe"),
    setup: text("setup"),
    entryPrice: numeric("entry_price", { precision: 18, scale: 6, mode: "number" }),
    exitPrice: numeric("exit_price", { precision: 18, scale: 6, mode: "number" }),
    stopLoss: numeric("stop_loss", { precision: 18, scale: 6, mode: "number" }),
    target: numeric("target", { precision: 18, scale: 6, mode: "number" }),
    quantity: numeric("quantity", { precision: 18, scale: 8, mode: "number" }),
    /** Monetary risk at entry (|entry - stop| * qty) — calculated when possible. */
    riskAmount: numeric("risk_amount", { precision: 14, scale: 2, mode: "number" }),
    fees: numeric("fees", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    /** Realized P&L; calculated on close unless manually overridden. */
    pnl: numeric("pnl", { precision: 14, scale: 2, mode: "number" }),
    rMultiple: numeric("r_multiple", { precision: 8, scale: 2, mode: "number" }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    entryReason: text("entry_reason"),
    exitReason: text("exit_reason"),
    emotionalState: text("emotional_state"),
    notes: text("notes"),
    /** Screenshot URLs / data refs (attachments stored elsewhere). */
    screenshots: jsonb("screenshots").$type<string[]>().notNull().default([]),
    tags: text("tags"),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("trades_user_mode_status_idx").on(t.userId, t.mode, t.status), index("trades_user_closed_idx").on(t.userId, t.closedAt)],
);

export const watchlists = pgTable(
  "watchlists",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("watchlists_user_idx").on(t.userId)],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: id(),
    userId: userRef(),
    watchlistId: uuid("watchlist_id").notNull().references(() => watchlists.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    name: text("name"),
    assetClass: text("asset_class").notNull().default("stock"),
    notes: text("notes"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("watchlist_items_wl_idx").on(t.watchlistId),
    // addWatchlistItem() returns the existing row for a symbol already on the list; the index is
    // what makes that true when two callers add the same symbol at once.
    uniqueIndex("watchlist_items_symbol_uniq").on(t.watchlistId, t.symbol),
  ],
);

export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: id(),
    userId: userRef(),
    symbol: text("symbol").notNull(),
    assetClass: text("asset_class").notNull().default("stock"),
    condition: text("condition").notNull(), // above | below
    price: numeric("price", { precision: 18, scale: 6, mode: "number" }).notNull(),
    note: text("note"),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("alerts_user_active_idx").on(t.userId, t.active)],
);

/** Cached quotes from the market-data provider (never hand-written). */
export const marketQuotes = pgTable(
  "market_quotes",
  {
    id: id(),
    symbol: text("symbol").notNull(),
    assetClass: text("asset_class").notNull().default("stock"),
    price: numeric("price", { precision: 18, scale: 6, mode: "number" }).notNull(),
    change: numeric("change", { precision: 18, scale: 6, mode: "number" }),
    changePct: numeric("change_pct", { precision: 10, scale: 4, mode: "number" }),
    currency: text("currency"),
    provider: text("provider").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quotes_symbol_idx").on(t.symbol, t.fetchedAt)],
);

/** Aggregated real market news; url is the dedupe key. AI fields are clearly separated. */
export const marketNews = pgTable(
  "market_news",
  {
    id: id(),
    headline: text("headline").notNull(),
    source: text("source").notNull(),
    url: text("url").notNull().unique(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    category: text("category").notNull().default("global"),
    summary: text("summary"), // provider-supplied description (external)
    symbols: jsonb("symbols").$type<string[]>().notNull().default([]),
    aiSummary: text("ai_summary"), // AI interpretation (labelled)
    aiWhyItMatters: text("ai_why_it_matters"),
    provider: text("provider").notNull().default("rss"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("news_published_idx").on(t.publishedAt), index("news_category_idx").on(t.category, t.publishedAt)],
);

export const economicEvents = pgTable(
  "economic_events",
  {
    id: id(),
    userId: userRef(),
    title: text("title").notNull(),
    country: text("country"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    importance: text("importance").notNull().default("medium"), // low|medium|high
    category: text("category").notNull().default("macro"),
    notes: text("notes"),
    source: dataSourceEnum("source").notNull().default("user"),
    externalId: text("external_id"),
    ...timestamps,
  },
  (t) => [index("econ_events_user_at_idx").on(t.userId, t.at)],
);

// ---------- Trading Academy ----------
export const academyLessons = pgTable(
  "academy_lessons",
  {
    id: id(),
    userId: userRef(),
    topic: text("topic").notNull(), // technical|fundamental|macro|structure|risk|psychology|portfolio|strategies
    title: text("title").notNull(),
    content: text("content").notNull(), // markdown
    position: integer("position").notNull().default(0),
    quiz: jsonb("quiz").$type<{ q: string; options: string[]; answer: number; explanation?: string }[]>().notNull().default([]),
    source: dataSourceEnum("source").notNull().default("user"), // user-authored or ai-generated (labelled)
    ...timestamps,
  },
  (t) => [index("academy_lessons_user_idx").on(t.userId, t.topic, t.position)],
);

export const academyProgress = pgTable(
  "academy_progress",
  {
    id: id(),
    userId: userRef(),
    lessonId: uuid("lesson_id").notNull().references(() => academyLessons.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    bestScore: integer("best_score"),
    attempts: integer("attempts").notNull().default(0),
    notes: text("notes"),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("academy_progress_user_lesson_idx").on(t.userId, t.lessonId)],
);
