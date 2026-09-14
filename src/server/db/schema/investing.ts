import { date, index, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dataSourceEnum, id, timestamps, userRef } from "./_shared";

export const assetClassEnum = pgEnum("asset_class", ["etf", "stock", "bond", "commodity", "crypto", "cash", "fund", "real_estate", "other"]);
export const invTxTypeEnum = pgEnum("investment_tx_type", ["buy", "sell", "contribution", "withdrawal", "dividend", "fee", "interest"]);

export const investmentAccounts = pgTable(
  "investment_accounts",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    broker: text("broker"),
    currency: text("currency").notNull().default("EUR"),
    /** Uninvested cash held in the account (computed from contributions/withdrawals/buys/sells + manual adjustment). */
    cashBalance: numeric("cash_balance", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    ...timestamps,
  },
  (t) => [index("inv_accounts_user_idx").on(t.userId)],
);

export const investmentAssets = pgTable(
  "investment_assets",
  {
    id: id(),
    userId: userRef(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    assetClass: assetClassEnum("asset_class").notNull().default("etf"),
    currency: text("currency").notNull().default("EUR"),
    /** Provider symbol mapping, e.g. { finnhub: "VWCE.DE", stooq: "vwce.de" } */
    providerSymbols: jsonb("provider_symbols").$type<Record<string, string>>().notNull().default({}),
    /** Last known price, its source and timestamp; never fabricated. */
    lastPrice: numeric("last_price", { precision: 18, scale: 6, mode: "number" }),
    lastPriceAt: timestamp("last_price_at", { withTimezone: true }),
    lastPriceSource: text("last_price_source"),
    manualPrice: numeric("manual_price", { precision: 18, scale: 6, mode: "number" }),
    ...timestamps,
  },
  (t) => [index("inv_assets_user_idx").on(t.userId, t.symbol)],
);

export const investmentTransactions = pgTable(
  "investment_transactions",
  {
    id: id(),
    userId: userRef(),
    accountId: uuid("account_id").notNull().references(() => investmentAccounts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => investmentAssets.id, { onDelete: "set null" }),
    type: invTxTypeEnum("type").notNull(),
    date: date("date").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 8, mode: "number" }),
    price: numeric("price", { precision: 18, scale: 6, mode: "number" }),
    /** Total cash amount of the transaction (positive). */
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    fees: numeric("fees", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    notes: text("notes"),
    source: dataSourceEnum("source").notNull().default("user"),
    ...timestamps,
  },
  (t) => [index("inv_tx_user_date_idx").on(t.userId, t.date), index("inv_tx_asset_idx").on(t.assetId)],
);

export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: id(),
    userId: userRef(),
    date: date("date").notNull(),
    totalValue: numeric("total_value", { precision: 14, scale: 2, mode: "number" }).notNull(),
    totalCost: numeric("total_cost", { precision: 14, scale: 2, mode: "number" }).notNull(),
    cash: numeric("cash", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    breakdown: jsonb("breakdown").$type<Record<string, unknown>>(),
    source: dataSourceEnum("source").notNull().default("calculated"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("snapshots_user_date_idx").on(t.userId, t.date)],
);
