import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { priceAlerts, strategies, trades, tradingAccounts, watchlistItems, watchlists } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/http";
import { round2 } from "@/lib/money";
import { assertOwned } from "@/server/ownership";

export const tradingAccountSchema = z.object({ name: z.string().min(1).max(100), mode: z.enum(["real", "paper"]), broker: z.string().max(100).nullish(), currency: z.string().length(3).default("EUR"), startingBalance: z.number().min(0).default(0), riskPerTradePct: z.number().min(0).max(100).default(1) });
export const strategySchema = z.object({ name: z.string().min(1).max(100), description: z.string().max(5000).nullish(), rules: z.string().max(10000).nullish(), timeframes: z.string().max(100).nullish() });
export const tradeSchema = z.object({
  accountId: z.string().uuid().optional(),
  /** Convenience for the AI: pick the account by mode when accountId is missing. */
  mode: z.enum(["real", "paper"]).optional(),
  symbol: z.string().min(1).max(20).transform((s) => s.toUpperCase()),
  assetClass: z.string().max(20).default("stock"),
  direction: z.enum(["long", "short"]).default("long"),
  status: z.enum(["planned", "open", "closed", "cancelled"]).default("open"),
  strategyId: z.string().uuid().nullish(),
  strategy: z.string().max(100).nullish(),
  timeframe: z.string().max(20).nullish(),
  setup: z.string().max(200).nullish(),
  entryPrice: z.number().positive().nullish(),
  exitPrice: z.number().positive().nullish(),
  stopLoss: z.number().positive().nullish(),
  target: z.number().positive().nullish(),
  quantity: z.number().positive().nullish(),
  fees: z.number().min(0).default(0),
  pnl: z.number().nullish(),
  openedAt: z.coerce.date().nullish(),
  closedAt: z.coerce.date().nullish(),
  entryReason: z.string().max(5000).nullish(),
  exitReason: z.string().max(5000).nullish(),
  emotionalState: z.string().max(200).nullish(),
  notes: z.string().max(10000).nullish(),
  screenshots: z.array(z.string().url().max(500)).max(10).default([]),
  tags: z.string().max(200).nullish(),
  source: z.enum(["user", "ai", "import"]).default("user"),
});
export const tradeUpdateSchema = tradeSchema.partial();

export async function listTradingAccounts(userId: string) {
  return db.select().from(tradingAccounts).where(eq(tradingAccounts.userId, userId)).orderBy(asc(tradingAccounts.mode), asc(tradingAccounts.name));
}
export async function createTradingAccount(userId: string, input: z.infer<typeof tradingAccountSchema>) {
  const [a] = await db.insert(tradingAccounts).values({ ...input, userId }).returning();
  return a;
}
export async function deleteTradingAccount(userId: string, id: string) {
  await db.delete(tradingAccounts).where(and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)));
}
export async function listStrategies(userId: string) {
  return db.select().from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.archived, false))).orderBy(asc(strategies.name));
}
export async function createStrategy(userId: string, input: z.infer<typeof strategySchema>) {
  const [s] = await db.insert(strategies).values({ ...input, userId }).returning();
  return s;
}
export async function deleteStrategy(userId: string, id: string) {
  await db.update(strategies).set({ archived: true }).where(and(eq(strategies.id, id), eq(strategies.userId, userId)));
}
async function resolveStrategy(userId: string, ref: { strategyId?: string | null; strategy?: string | null }) {
  if (ref.strategyId) { await assertOwned(userId, { strategy: ref.strategyId }); return ref.strategyId; }
  if (!ref.strategy) return null;
  const [s] = await db.select({ id: strategies.id }).from(strategies).where(and(eq(strategies.userId, userId), sql`lower(${strategies.name}) = lower(${ref.strategy})`)).limit(1);
  if (s) return s.id;
  return (await createStrategy(userId, { name: ref.strategy })).id;
}

/** Derived numbers are only computed when the inputs exist; nothing is guessed. */
export function computeTradeMetrics(t: { direction: "long" | "short"; entryPrice?: number | null; exitPrice?: number | null; stopLoss?: number | null; quantity?: number | null; fees?: number | null; pnl?: number | null }) {
  const dir = t.direction === "long" ? 1 : -1;
  const riskAmount = t.entryPrice != null && t.stopLoss != null && t.quantity != null ? round2(Math.abs(t.entryPrice - t.stopLoss) * t.quantity) : null;
  let pnl = t.pnl ?? null;
  if (pnl == null && t.entryPrice != null && t.exitPrice != null && t.quantity != null) pnl = round2((t.exitPrice - t.entryPrice) * dir * t.quantity - (t.fees ?? 0));
  const rMultiple = pnl != null && riskAmount != null && riskAmount > 0 ? round2(pnl / riskAmount) : null;
  return { riskAmount, pnl, rMultiple };
}

export async function listTrades(userId: string, filter: { mode?: "real" | "paper"; status?: string; accountId?: string; from?: string; to?: string; limit?: number } = {}) {
  const conds = [eq(trades.userId, userId)];
  if (filter.mode) conds.push(eq(trades.mode, filter.mode));
  if (filter.status) conds.push(eq(trades.status, filter.status as "open"));
  if (filter.accountId) conds.push(eq(trades.accountId, filter.accountId));
  if (filter.from) conds.push(gte(trades.closedAt, new Date(filter.from)));
  if (filter.to) conds.push(lte(trades.closedAt, new Date(filter.to + "T23:59:59Z")));
  return db
    .select({ t: trades, strategyName: strategies.name, accountName: tradingAccounts.name })
    .from(trades)
    .leftJoin(strategies, eq(strategies.id, trades.strategyId))
    .leftJoin(tradingAccounts, eq(tradingAccounts.id, trades.accountId))
    .where(and(...conds))
    .orderBy(desc(sql`coalesce(${trades.closedAt}, ${trades.openedAt}, ${trades.createdAt})`))
    .limit(filter.limit ?? 200)
    .then((r) => r.map((x) => ({ ...x.t, strategyName: x.strategyName, accountName: x.accountName })));
}
export async function getTrade(userId: string, id: string) {
  const [t] = await db.select().from(trades).where(and(eq(trades.id, id), eq(trades.userId, userId)));
  if (!t) throw notFound("Trade");
  return t;
}
export async function addTrade(userId: string, input: z.infer<typeof tradeSchema>) {
  let accountId = input.accountId;
  if (!accountId) {
    const [a] = await db.select().from(tradingAccounts).where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.mode, input.mode ?? "paper"))).limit(1);
    if (!a) throw badRequest(`No ${input.mode ?? "paper"} trading account exists`);
    accountId = a.id;
  }
  const [acct] = await db.select().from(tradingAccounts).where(and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, userId)));
  if (!acct) throw notFound("Trading account");
  const strategyId = await resolveStrategy(userId, input);
  const metrics = computeTradeMetrics(input);
  const { strategy: _s, mode: _m, ...rest } = input;
  const status = input.status === "open" && input.exitPrice != null ? "closed" : input.status;
  const [t] = await db
    .insert(trades)
    .values({ ...rest, userId, accountId, mode: acct.mode, strategyId, ...metrics, status, openedAt: input.openedAt ?? (status !== "planned" ? new Date() : null), closedAt: input.closedAt ?? (status === "closed" ? new Date() : null) })
    .returning();
  return t;
}
export async function updateTrade(userId: string, id: string, input: z.infer<typeof tradeUpdateSchema>) {
  const cur = await getTrade(userId, id);
  const strategyId = input.strategyId !== undefined || input.strategy ? await resolveStrategy(userId, input) : undefined;
  const merged = { ...cur, ...input };
  const metrics = computeTradeMetrics({ direction: merged.direction, entryPrice: merged.entryPrice, exitPrice: merged.exitPrice, stopLoss: merged.stopLoss, quantity: merged.quantity, fees: merged.fees, pnl: input.pnl ?? (input.exitPrice != null || input.entryPrice != null || input.quantity != null ? null : cur.pnl) });
  const { strategy: _s, mode: _m, accountId: _a, ...rest } = input;
  const status = input.status ?? (merged.exitPrice != null && cur.status === "open" ? "closed" : cur.status);
  const [t] = await db
    .update(trades)
    .set({ ...rest, ...(strategyId !== undefined ? { strategyId } : {}), ...metrics, status, closedAt: status === "closed" ? input.closedAt ?? cur.closedAt ?? new Date() : status === "open" ? null : cur.closedAt })
    .where(and(eq(trades.id, id), eq(trades.userId, userId)))
    .returning();
  return t;
}
export async function deleteTrade(userId: string, id: string) {
  await getTrade(userId, id);
  await db.delete(trades).where(and(eq(trades.id, id), eq(trades.userId, userId)));
}

/** Analytics are always computed for a single mode; real and paper are never mixed (spec §13). */
export async function tradingStatistics(userId: string, mode: "real" | "paper", range?: { from?: string; to?: string }) {
  const conds = [eq(trades.userId, userId), eq(trades.mode, mode), eq(trades.status, "closed"), isNotNull(trades.pnl)];
  if (range?.from) conds.push(gte(trades.closedAt, new Date(range.from)));
  if (range?.to) conds.push(lte(trades.closedAt, new Date(range.to + "T23:59:59Z")));
  const rows = await db.select({ t: trades, strategyName: strategies.name }).from(trades).leftJoin(strategies, eq(strategies.id, trades.strategyId)).where(and(...conds)).orderBy(asc(trades.closedAt));
  const closed = rows.map((r) => ({ ...r.t, strategyName: r.strategyName ?? "No strategy" }));
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0), losses = closed.filter((t) => (t.pnl ?? 0) < 0);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const grossWin = sum(wins.map((t) => t.pnl!)), grossLoss = Math.abs(sum(losses.map((t) => t.pnl!)));
  const avgWin = wins.length ? grossWin / wins.length : 0, avgLoss = losses.length ? grossLoss / losses.length : 0;
  const winRate = closed.length ? wins.length / closed.length : 0;
  const expectancy = closed.length ? winRate * avgWin - (1 - winRate) * avgLoss : 0;
  let equity = 0, peak = 0, maxDrawdown = 0;
  const curve = closed.map((t) => { equity += t.pnl!; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); return { at: t.closedAt, equity: round2(equity) }; });
  const rs = closed.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const group = (key: (t: (typeof closed)[number]) => string) => {
    const m = new Map<string, { key: string; trades: number; wins: number; pnl: number }>();
    for (const t of closed) { const k = key(t); const g = m.get(k) ?? { key: k, trades: 0, wins: 0, pnl: 0 }; g.trades++; if (t.pnl! > 0) g.wins++; g.pnl = round2(g.pnl + t.pnl!); m.set(k, g); }
    return [...m.values()].map((g) => ({ ...g, winRate: round2((g.wins / g.trades) * 100) })).sort((a, b) => b.pnl - a.pnl);
  };
  const open = await db.select({ n: sql<number>`count(*)` }).from(trades).where(and(eq(trades.userId, userId), eq(trades.mode, mode), eq(trades.status, "open")));
  return {
    mode, trades: closed.length, wins: wins.length, losses: losses.length, breakeven: closed.length - wins.length - losses.length, openTrades: Number(open[0].n),
    winRate: round2(winRate * 100), avgWin: round2(avgWin), avgLoss: round2(avgLoss), expectancy: round2(expectancy),
    profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : grossWin > 0 ? null : 0, totalPnl: round2(grossWin - grossLoss), maxDrawdown: round2(maxDrawdown),
    avgR: rs.length ? round2(sum(rs) / rs.length) : null, equityCurve: curve,
    byStrategy: group((t) => t.strategyName), bySymbol: group((t) => t.symbol), byTimeframe: group((t) => t.timeframe ?? "n/a"),
    source: "calculated" as const,
  };
}

// ---------- Watchlists & alerts ----------
export async function listWatchlists(userId: string) {
  const wls = await db.select().from(watchlists).where(eq(watchlists.userId, userId)).orderBy(desc(watchlists.isDefault), asc(watchlists.name));
  const items = await db.select().from(watchlistItems).where(eq(watchlistItems.userId, userId)).orderBy(asc(watchlistItems.position), asc(watchlistItems.createdAt));
  return wls.map((w) => ({ ...w, items: items.filter((i) => i.watchlistId === w.id) }));
}
export const watchlistItemSchema = z.object({ watchlistId: z.string().uuid().optional(), symbol: z.string().min(1).max(20).transform((s) => s.toUpperCase()), name: z.string().max(100).nullish(), assetClass: z.enum(["stock", "etf", "crypto", "forex", "commodity", "index", "other"]).default("stock"), notes: z.string().max(2000).nullish() });
export async function addWatchlistItem(userId: string, input: z.infer<typeof watchlistItemSchema>) {
  // Without this check a caller could pass someone else's watchlist id: the duplicate lookup below
  // would then find *their* row and hand it back, symbol and notes included.
  await assertOwned(userId, { watchlist: input.watchlistId });
  let watchlistId = input.watchlistId;
  if (!watchlistId) {
    const [w] = await db.select().from(watchlists).where(eq(watchlists.userId, userId)).orderBy(desc(watchlists.isDefault)).limit(1);
    watchlistId = w ? w.id : (await db.insert(watchlists).values({ userId, name: "Watchlist", isDefault: true }).returning())[0].id;
  }
  const [dup] = await db.select().from(watchlistItems).where(and(eq(watchlistItems.watchlistId, watchlistId), eq(watchlistItems.userId, userId), eq(watchlistItems.symbol, input.symbol)));
  if (dup) return dup;
  const [i] = await db.insert(watchlistItems).values({ ...input, watchlistId, userId }).returning();
  return i;
}
export async function updateWatchlistItem(userId: string, id: string, input: { notes?: string | null; name?: string | null; position?: number }) {
  const [i] = await db.update(watchlistItems).set(input).where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, userId))).returning();
  if (!i) throw notFound("Watchlist item");
  return i;
}
export async function removeWatchlistItem(userId: string, id: string) {
  await db.delete(watchlistItems).where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, userId)));
}
export const alertSchema = z.object({ symbol: z.string().min(1).max(20).transform((s) => s.toUpperCase()), assetClass: z.enum(["stock", "etf", "crypto", "forex", "commodity", "index", "other"]).default("stock"), condition: z.enum(["above", "below"]), price: z.number().positive(), note: z.string().max(500).nullish() });
export async function listAlerts(userId: string) {
  return db.select().from(priceAlerts).where(eq(priceAlerts.userId, userId)).orderBy(desc(priceAlerts.active), asc(priceAlerts.symbol));
}
export async function createAlert(userId: string, input: z.infer<typeof alertSchema>) {
  const [a] = await db.insert(priceAlerts).values({ ...input, userId }).returning();
  return a;
}
export async function deleteAlert(userId: string, id: string) {
  await db.delete(priceAlerts).where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, userId)));
}
export async function triggerAlert(userId: string, id: string) {
  await db.update(priceAlerts).set({ triggeredAt: new Date(), active: false }).where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, userId)));
}
