import { z } from "zod";
import { defineTool } from "../registry";
import * as tr from "@/server/services/trading";
import { dateSchema } from "@/server/services/tasks";

defineTool({ name: "get_positions", module: "trading", risk: "read", description: "Open trades (positions) — real and paper are returned separately.", schema: z.object({ mode: z.enum(["real", "paper"]).optional() }), run: async (i, ctx) => ({ real: i.mode === "paper" ? [] : await tr.listTrades(ctx.user.id, { mode: "real", status: "open" }), paper: i.mode === "real" ? [] : await tr.listTrades(ctx.user.id, { mode: "paper", status: "open" }) }) });
defineTool({ name: "get_watchlist", module: "trading", risk: "read", description: "Watchlists with symbols and notes.", schema: z.object({}), run: (_i, ctx) => tr.listWatchlists(ctx.user.id) });
defineTool({ name: "add_to_watchlist", module: "trading", risk: "low", description: "Add a symbol to the default watchlist.", schema: tr.watchlistItemSchema, summarize: (i) => `add_to_watchlist — ${i.symbol}`, run: (i, ctx) => tr.addWatchlistItem(ctx.user.id, i) });
defineTool({
  name: "add_trade", module: "trading", risk: "medium",
  description: "Journal a trade. mode 'paper' (simulated) or 'real' — never mixed. P&L and R multiple are computed from entry/exit/stop/quantity when possible. Real-account trades require confirmation.",
  schema: tr.tradeSchema.omit({ source: true }),
  needsConfirmation: (i) => (i.mode === "real" ? `Record REAL trade ${i.symbol}` : false),
  summarize: (i) => `add_trade — ${i.mode ?? "paper"} — ${i.symbol} ${i.direction}`,
  run: (i, ctx) => tr.addTrade(ctx.user.id, { ...i, source: "ai" }),
});
defineTool({ name: "update_trade", module: "trading", risk: "medium", description: "Update/close a trade by id (exitPrice, exitReason, notes, emotionalState...).", schema: z.object({ id: z.string().uuid() }).extend(tr.tradeUpdateSchema.omit({ source: true }).shape), summarize: (i) => `update_trade — ${i.id.slice(0, 8)}`, run: ({ id, ...rest }, ctx) => tr.updateTrade(ctx.user.id, id, rest) });
defineTool({ name: "get_trading_statistics", module: "trading", risk: "read", description: "Win rate, expectancy, profit factor, drawdown, avg R, performance by strategy/asset/timeframe for ONE mode.", schema: z.object({ mode: z.enum(["real", "paper"]).default("paper"), from: dateSchema.optional(), to: dateSchema.optional() }), run: (i, ctx) => tr.tradingStatistics(ctx.user.id, i.mode, i) });
defineTool({ name: "get_trading_journal", module: "trading", risk: "read", description: "Recent trades with journal fields for one mode.", schema: z.object({ mode: z.enum(["real", "paper"]).default("paper"), status: z.enum(["planned", "open", "closed", "cancelled"]).optional(), limit: z.number().int().max(100).default(20) }), run: (i, ctx) => tr.listTrades(ctx.user.id, i) });
defineTool({ name: "create_price_alert", module: "trading", risk: "low", description: "Create a price alert (above/below).", schema: tr.alertSchema, summarize: (i) => `create_price_alert — ${i.symbol} ${i.condition} ${i.price}`, run: (i, ctx) => tr.createAlert(ctx.user.id, i) });

defineTool({
  name: "create_trading_account", module: "trading", risk: "medium",
  description: "Create a trading account. mode 'paper' is simulated money and 'real' is real money; the two are never mixed in positions, statistics or the journal. Creating a real account is confirmed.",
  schema: tr.tradingAccountSchema,
  needsConfirmation: (i) => (i.mode === "real" ? `Create a REAL-money trading account "${i.name}"` : false),
  summarize: (i) => `create_trading_account — ${i.name} (${i.mode})`,
  run: (i, ctx) => tr.createTradingAccount(ctx.user.id, i),
});
defineTool({
  name: "delete_trading_account", module: "trading", risk: "high",
  description: "Delete a trading account and every trade recorded in it. Always confirmed, and the account's exact name must be given so a real-money history cannot be wiped by mistake.",
  schema: z.object({ id: z.string().uuid(), name: z.string().min(1).max(100).describe("The account's exact name, for the confirmation") }),
  summarize: (i) => `delete_trading_account — "${i.name}"`,
  needsConfirmation: (i) => `Permanently delete the trading account "${i.name}" and all of its trades`,
  run: async (i, ctx) => {
    const account = (await tr.listTradingAccounts(ctx.user.id)).find((a) => a.id === i.id);
    if (!account) throw new Error("Trading account not found");
    if (account.name.trim().toLowerCase() !== i.name.trim().toLowerCase()) throw new Error(`That id belongs to "${account.name}", not "${i.name}". Nothing was deleted.`);
    await tr.deleteTradingAccount(ctx.user.id, i.id);
    return { deleted: i.id, name: account.name, mode: account.mode };
  },
});
defineTool({
  name: "create_strategy", module: "trading", risk: "low",
  description: "Create a trading strategy (name, description, rules) to tag trades with and measure separately.",
  schema: tr.strategySchema,
  summarize: (i) => `create_strategy — ${i.name}`,
  run: (i, ctx) => tr.createStrategy(ctx.user.id, i),
});
defineTool({
  name: "delete_strategy", module: "trading", risk: "medium",
  description: "Delete a trading strategy. Trades tagged with it are kept. Requires confirmation.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete strategy ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_strategy — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await tr.deleteStrategy(ctx.user.id, i.id); return { deleted: i.id }; },
});
defineTool({
  name: "update_watchlist_item", module: "trading", risk: "low",
  description: "Edit a symbol on a watchlist: its display name, notes or position in the list. Use get_watchlist for ids.",
  schema: z.object({ id: z.string().uuid(), name: z.string().max(100).nullish(), notes: z.string().max(2000).nullish(), position: z.number().int().min(0).optional() }),
  summarize: (i) => `update_watchlist_item — ${i.id.slice(0, 8)}`,
  run: ({ id, ...rest }, ctx) => tr.updateWatchlistItem(ctx.user.id, id, rest),
});
defineTool({
  name: "remove_watchlist_item", module: "trading", risk: "low",
  description: "Remove a symbol from a watchlist. Easy to undo by adding it again, so it runs directly.",
  schema: z.object({ id: z.string().uuid() }),
  summarize: (i) => `remove_watchlist_item — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await tr.removeWatchlistItem(ctx.user.id, i.id); return { removed: i.id }; },
});
defineTool({
  name: "delete_price_alert", module: "trading", risk: "low",
  description: "Delete a price alert. Nothing else is affected.",
  schema: z.object({ id: z.string().uuid() }),
  summarize: (i) => `delete_price_alert — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await tr.deleteAlert(ctx.user.id, i.id); return { deleted: i.id }; },
});
defineTool({
  name: "delete_trade", module: "trading", risk: "high",
  description: "Delete a trade from the journal. Statistics for that mode change, and a real-money record disappears, so it is always confirmed. Prefer update_trade to correct a mistake.",
  schema: z.object({ id: z.string().uuid() }),
  summarize: (i) => `delete_trade — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { const trade = await tr.getTrade(ctx.user.id, i.id); await tr.deleteTrade(ctx.user.id, i.id); return { deleted: i.id, symbol: trade.symbol, mode: trade.mode }; },
});
