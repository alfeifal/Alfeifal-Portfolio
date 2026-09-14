import { z } from "zod";
import { defineTool } from "../registry";
import * as inv from "@/server/services/investing";

defineTool({ name: "get_portfolio", module: "investing", risk: "read", description: "Long-term investment portfolio: positions, cost basis, current value (when a price is available), allocation, cash.", schema: z.object({ refreshPrices: z.boolean().default(false) }), run: (i, ctx) => inv.portfolio(ctx.user.id, i) });
defineTool({ name: "get_investment_transactions", module: "investing", risk: "read", description: "Investment transactions (buys, sells, contributions, dividends...).", schema: z.object({ limit: z.number().int().max(200).default(50) }), run: (i, ctx) => inv.listInvestmentTransactions(ctx.user.id, i.limit) });
defineTool({
  name: "add_investment_transaction", module: "investing", risk: "high",
  description: "Record an investment transaction (buy/sell/contribution/withdrawal/dividend/fee/interest). Financial transaction → always requires confirmation.",
  schema: inv.invTxSchema.omit({ source: true }),
  summarize: (i) => `add_investment_transaction — ${i.type} — ${i.amount ?? (i.quantity && i.price ? i.quantity * i.price : "")}`,
  run: (i, ctx) => inv.createInvestmentTransaction(ctx.user.id, { ...i, source: "ai" }, ctx.user.timezone),
});
