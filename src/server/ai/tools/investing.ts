import { z } from "zod";
import { defineTool } from "../registry";
import * as inv from "@/server/services/investing";

defineTool({ name: "get_portfolio", module: "investing", risk: "read", description: "Long-term investment portfolio: positions, cost basis, current value (when a price is available), allocation, cash.", schema: z.object({ refreshPrices: z.boolean().default(false) }), run: (i, ctx) => inv.portfolio(ctx.user.id, i) });
defineTool({ name: "get_investment_transactions", module: "investing", risk: "read", description: "Investment transactions (buys, sells, contributions, dividends...).", schema: z.object({ limit: z.number().int().max(200).default(50) }), run: (i, ctx) => inv.listInvestmentTransactions(ctx.user.id, i.limit) });
defineTool({
  name: "add_investment_transaction", module: "investing", risk: "high",
  description: "Record a long-term portfolio transaction (buy/sell/contribution/withdrawal/dividend/fee/interest) in an investment account. Not add_trade, which journals a short-term trade with entry/exit/stop in a trading account, and not add_expense. Financial transaction → always requires confirmation.",
  schema: inv.invTxSchema.omit({ source: true }),
  summarize: (i) => `add_investment_transaction — ${i.type} — ${i.amount ?? (i.quantity && i.price ? i.quantity * i.price : "")}`,
  run: (i, ctx) => inv.createInvestmentTransaction(ctx.user.id, { ...i, source: "ai" }, ctx.user.timezone),
});

defineTool({
  name: "create_investment_account", module: "investing", risk: "low",
  description: "Create an investment account (a broker or pension plan) with its currency and starting cash. Investing is kept apart from day-to-day finance and from trading.",
  schema: inv.invAccountSchema,
  summarize: (i) => `create_investment_account — ${i.name}`,
  run: (i, ctx) => inv.createInvestmentAccount(ctx.user.id, i),
});
defineTool({
  name: "update_investment_account", module: "investing", risk: "low",
  description: "Edit an investment account by id: name, broker or currency. The cash balance is derived from its transactions and cannot be set here.",
  schema: z.object({ id: z.string().uuid() }).extend(inv.invAccountUpdateSchema.shape),
  summarize: (i) => `update_investment_account — ${i.name ?? i.id.slice(0, 8)}`,
  run: ({ id, ...rest }, ctx) => inv.updateInvestmentAccount(ctx.user.id, id, rest),
});
defineTool({
  name: "delete_investment_account", module: "investing", risk: "high",
  description: "Delete an investment account. Every transaction inside it is deleted with it and the portfolio changes. Always confirmed, and the account's exact name must be given.",
  schema: z.object({ id: z.string().uuid(), name: z.string().min(1).max(100).describe("The account's exact name, for the confirmation") }),
  summarize: (i) => `delete_investment_account — "${i.name}"`,
  needsConfirmation: (i) => `Permanently delete the investment account "${i.name}" and all of its transactions`,
  run: async (i, ctx) => {
    const account = (await inv.listInvestmentAccounts(ctx.user.id)).find((a) => a.id === i.id);
    if (!account) throw new Error("Investment account not found");
    if (account.name.trim().toLowerCase() !== i.name.trim().toLowerCase()) throw new Error(`That id belongs to "${account.name}", not "${i.name}". Nothing was deleted.`);
    await inv.deleteInvestmentAccount(ctx.user.id, i.id);
    return { deleted: i.id, name: account.name };
  },
});
defineTool({
  name: "create_investment_asset", module: "investing", risk: "low",
  description: "Add an asset to follow (symbol, name, class: etf | stock | bond | commodity | crypto | cash | fund | real_estate | other). Prices come from the market providers; nothing is invented.",
  schema: inv.invAssetSchema,
  summarize: (i) => `create_investment_asset — ${i.symbol}`,
  run: (i, ctx) => inv.createAsset(ctx.user.id, i),
});
defineTool({
  name: "update_investment_asset", module: "investing", risk: "medium",
  description: "Correct an asset's symbol, name, class, currency or target allocation. It does not change your holdings, only how the asset is described.",
  schema: z.object({ id: z.string().uuid() }).extend(inv.invAssetSchema.partial().shape),
  summarize: (i) => `update_investment_asset — ${i.id.slice(0, 8)}`,
  run: ({ id, ...rest }, ctx) => inv.updateAsset(ctx.user.id, id, rest),
});
defineTool({
  name: "delete_investment_asset", module: "investing", risk: "medium",
  description: "Remove an asset. Requires confirmation. Its transactions lose their asset, so the portfolio changes.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete investment asset ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_investment_asset — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await inv.deleteAsset(ctx.user.id, i.id); return { deleted: i.id }; },
});
defineTool({
  name: "delete_investment_transaction", module: "investing", risk: "high",
  description: "Delete an investment transaction (a buy, sell, contribution...). It changes the account's cash and the portfolio, so it is always confirmed. Use get_investment_transactions for ids.",
  schema: z.object({ id: z.string().uuid() }),
  summarize: (i) => `delete_investment_transaction — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await inv.deleteInvestmentTransaction(ctx.user.id, i.id); return { deleted: i.id }; },
});
