import { z } from "zod";
import { defineTool } from "../registry";
import * as m from "@/server/services/market";
import { untrusted } from "../untrusted";

defineTool({
  name: "get_market_news", module: "market", risk: "read",
  description: "Real aggregated market news (RSS from CNBC, MarketWatch, Fed, ECB, Investing.com, CoinDesk...). Filter by category: global | us | macro | central_banks | commodities | forex | crypto, or by symbols/search. Never invent news; cite source and time.",
  schema: z.object({ category: z.string().optional(), q: z.string().optional(), symbols: z.array(z.string()).optional(), sinceHours: z.number().int().max(720).default(48), limit: z.number().int().max(60).default(20), refresh: z.boolean().default(false) }),
  // The headline and summary come straight from third-party feeds; see ../untrusted.ts for why they
  // are handed over labelled rather than bare. Nothing is altered or dropped — only wrapped.
  run: async (i, ctx) => { void ctx; await m.refreshNews(i.refresh).catch(() => 0); return untrusted((await m.listNews(i)).map((n) => ({ id: n.id, headline: n.headline, source: n.source, publishedAt: n.publishedAt, url: n.url, category: n.category, summary: n.summary }))); },
});
defineTool({
  name: "get_quotes", module: "market", risk: "read",
  description: "Latest prices for symbols (from the configured provider; freshness is reported: realtime/delayed/eod). Missing symbols are listed, never guessed. assetClass: stock | etf | crypto | forex | commodity | index.",
  schema: z.object({ symbols: z.array(z.object({ symbol: z.string(), assetClass: z.enum(["stock", "etf", "crypto", "forex", "commodity", "index", "other"]).default("stock") })).min(1).max(20) }),
  run: (i) => m.getQuotes(i.symbols),
});
defineTool({ name: "get_economic_events", module: "market", risk: "read", description: "User-registered economic calendar events for the next N days.", schema: z.object({ days: z.number().int().max(60).default(7) }), run: (i, ctx) => m.listEconomicEvents(ctx.user.id, { from: new Date(), to: new Date(Date.now() + i.days * 86400e3) }) });
defineTool({ name: "add_economic_event", module: "market", risk: "low", description: "Register an important upcoming economic event (FOMC, CPI, earnings...).", schema: m.econEventSchema, summarize: (i) => `add_economic_event — ${i.title}`, run: (i, ctx) => m.createEconomicEvent(ctx.user.id, i) });
