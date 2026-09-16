import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { investmentAccounts, investmentAssets, investmentTransactions, portfolioSnapshots } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/http";
import { dateSchema } from "./tasks";
import { round2 } from "@/lib/money";
import { fetchQuotes, type AssetClass } from "@/server/market";
import { todayKey } from "@/lib/dates";
import { assertOwned } from "@/server/ownership";

export const invAccountSchema = z.object({ name: z.string().min(1).max(100), broker: z.string().max(100).nullish(), currency: z.string().length(3).default("EUR"), cashBalance: z.number().default(0) });
export const invAssetSchema = z.object({
  symbol: z.string().min(1).max(20).transform((s) => s.toUpperCase()),
  name: z.string().min(1).max(150),
  assetClass: z.enum(["etf", "stock", "bond", "commodity", "crypto", "cash", "fund", "real_estate", "other"]).default("etf"),
  currency: z.string().length(3).default("EUR"),
  providerSymbols: z.record(z.string(), z.string()).default({}),
  manualPrice: z.number().positive().nullish(),
});
export const invTxSchema = z.object({
  accountId: z.string().uuid(),
  assetId: z.string().uuid().nullish(),
  type: z.enum(["buy", "sell", "contribution", "withdrawal", "dividend", "fee", "interest"]),
  date: dateSchema.optional(),
  quantity: z.number().positive().nullish(),
  price: z.number().positive().nullish(),
  amount: z.number().min(0).optional(),
  fees: z.number().min(0).default(0),
  notes: z.string().max(2000).nullish(),
  source: z.enum(["user", "ai", "import"]).default("user"),
});

export async function listInvestmentAccounts(userId: string) {
  return db.select().from(investmentAccounts).where(eq(investmentAccounts.userId, userId)).orderBy(asc(investmentAccounts.name));
}
export async function createInvestmentAccount(userId: string, input: z.infer<typeof invAccountSchema>) {
  const [a] = await db.insert(investmentAccounts).values({ ...input, userId }).returning();
  return a;
}
export async function deleteInvestmentAccount(userId: string, id: string) {
  await db.delete(investmentAccounts).where(and(eq(investmentAccounts.id, id), eq(investmentAccounts.userId, userId)));
}
export async function listAssets(userId: string) {
  return db.select().from(investmentAssets).where(eq(investmentAssets.userId, userId)).orderBy(asc(investmentAssets.symbol));
}
export async function createAsset(userId: string, input: z.infer<typeof invAssetSchema>) {
  const [a] = await db.insert(investmentAssets).values({ ...input, userId }).returning();
  return a;
}
export async function updateAsset(userId: string, id: string, input: Partial<z.infer<typeof invAssetSchema>>) {
  const [a] = await db.update(investmentAssets).set(input).where(and(eq(investmentAssets.id, id), eq(investmentAssets.userId, userId))).returning();
  if (!a) throw notFound("Asset");
  return a;
}
export async function deleteAsset(userId: string, id: string) {
  await db.delete(investmentAssets).where(and(eq(investmentAssets.id, id), eq(investmentAssets.userId, userId)));
}

export async function listInvestmentTransactions(userId: string, limit = 200) {
  return db
    .select({ tx: investmentTransactions, symbol: investmentAssets.symbol, accountName: investmentAccounts.name })
    .from(investmentTransactions)
    .leftJoin(investmentAssets, eq(investmentAssets.id, investmentTransactions.assetId))
    .leftJoin(investmentAccounts, eq(investmentAccounts.id, investmentTransactions.accountId))
    .where(eq(investmentTransactions.userId, userId))
    .orderBy(desc(investmentTransactions.date), desc(investmentTransactions.createdAt))
    .limit(limit)
    .then((r) => r.map((x) => ({ ...x.tx, symbol: x.symbol, accountName: x.accountName })));
}
export async function createInvestmentTransaction(userId: string, input: z.infer<typeof invTxSchema>, tz?: string) {
  const [acct] = await db.select().from(investmentAccounts).where(and(eq(investmentAccounts.id, input.accountId), eq(investmentAccounts.userId, userId)));
  if (!acct) throw notFound("Investment account");
  if ((input.type === "buy" || input.type === "sell") && (!input.assetId || !input.quantity || !input.price)) throw badRequest("Buy/sell need assetId, quantity and price");
  await assertOwned(userId, { investmentAsset: input.assetId });
  const amount = input.amount ?? (input.quantity && input.price ? round2(input.quantity * input.price) : 0);
  const [t] = await db.insert(investmentTransactions).values({ ...input, userId, amount, date: input.date ?? todayKey(tz) }).returning();
  // cash movement
  const delta = { buy: -(amount + input.fees), sell: amount - input.fees, contribution: amount, withdrawal: -amount, dividend: amount, interest: amount, fee: -amount }[input.type];
  await db.update(investmentAccounts).set({ cashBalance: round2(acct.cashBalance + delta) }).where(eq(investmentAccounts.id, acct.id));
  return t;
}
export async function deleteInvestmentTransaction(userId: string, id: string) {
  const [t] = await db.select().from(investmentTransactions).where(and(eq(investmentTransactions.id, id), eq(investmentTransactions.userId, userId)));
  if (!t) throw notFound("Transaction");
  const delta = { buy: -(t.amount + t.fees), sell: t.amount - t.fees, contribution: t.amount, withdrawal: -t.amount, dividend: t.amount, interest: t.amount, fee: -t.amount }[t.type];
  await db.update(investmentAccounts).set({ cashBalance: sql`${investmentAccounts.cashBalance} - ${delta}` }).where(eq(investmentAccounts.id, t.accountId));
  await db.delete(investmentTransactions).where(eq(investmentTransactions.id, id));
}

/** Positions with average cost basis; current value uses the latest provider price (or manual price) when available. */
export async function portfolio(userId: string, opts: { refreshPrices?: boolean } = {}) {
  const assets = await listAssets(userId);
  const txs = await db.select().from(investmentTransactions).where(and(eq(investmentTransactions.userId, userId), inArray(investmentTransactions.type, ["buy", "sell"]))).orderBy(asc(investmentTransactions.date), asc(investmentTransactions.createdAt));
  const pos = new Map<string, { quantity: number; cost: number; realized: number }>();
  for (const t of txs) {
    if (!t.assetId) continue;
    const p = pos.get(t.assetId) ?? { quantity: 0, cost: 0, realized: 0 };
    if (t.type === "buy") { p.quantity += t.quantity ?? 0; p.cost += t.amount + t.fees; }
    else {
      const avg = p.quantity > 0 ? p.cost / p.quantity : 0;
      const q = t.quantity ?? 0;
      p.realized += t.amount - t.fees - avg * q;
      p.cost -= avg * q;
      p.quantity -= q;
    }
    pos.set(t.assetId, p);
  }
  if (opts.refreshPrices) await refreshAssetPrices(userId, assets.filter((a) => (pos.get(a.id)?.quantity ?? 0) > 0));
  const fresh = opts.refreshPrices ? await listAssets(userId) : assets;
  const positions = fresh
    .map((a) => {
      const p = pos.get(a.id) ?? { quantity: 0, cost: 0, realized: 0 };
      const price = a.manualPrice ?? a.lastPrice ?? null;
      const value = price != null ? round2(p.quantity * price) : null;
      return { asset: a, quantity: round2(p.quantity), costBasis: round2(p.cost), avgCost: p.quantity > 0 ? round2(p.cost / p.quantity) : null, price, priceSource: a.manualPrice != null ? "manual" : a.lastPriceSource, priceAt: a.manualPrice != null ? null : a.lastPriceAt, value, unrealized: value != null ? round2(value - p.cost) : null, unrealizedPct: value != null && p.cost > 0 ? round2(((value - p.cost) / p.cost) * 100) : null, realized: round2(p.realized) };
    })
    .filter((p) => p.quantity > 0 || p.realized !== 0);
  const accounts = await listInvestmentAccounts(userId);
  const cash = round2(accounts.reduce((a, b) => a + b.cashBalance, 0));
  const valued = positions.filter((p) => p.value != null);
  const totalValue = round2(valued.reduce((a, b) => a + (b.value ?? 0), 0));
  const totalCost = round2(positions.reduce((a, b) => a + b.costBasis, 0));
  const allocation = valued.map((p) => ({ symbol: p.asset.symbol, assetClass: p.asset.assetClass, value: p.value!, pct: totalValue > 0 ? round2(((p.value ?? 0) / totalValue) * 100) : 0 }));
  const contributions = await db.select({ total: sql<number>`coalesce(sum(case when type='contribution' then amount when type='withdrawal' then -amount else 0 end),0)` }).from(investmentTransactions).where(eq(investmentTransactions.userId, userId));
  return { positions, accounts, cash, totalValue, totalCost, unpriced: positions.filter((p) => p.value == null && p.quantity > 0).map((p) => p.asset.symbol), unrealized: round2(totalValue - valued.reduce((a, b) => a + b.costBasis, 0)), allocation, netContributions: round2(Number(contributions[0].total)), source: "calculated" as const };
}

export async function refreshAssetPrices(userId: string, assets?: (typeof investmentAssets.$inferSelect)[]) {
  const list = assets ?? (await listAssets(userId));
  const wanted = list.filter((a) => a.manualPrice == null && a.assetClass !== "cash").map((a) => ({ symbol: a.providerSymbols.stooq ?? a.providerSymbols.finnhub ?? a.symbol, assetClass: (a.assetClass === "crypto" ? "crypto" : a.assetClass === "commodity" ? "commodity" : a.assetClass === "stock" ? "stock" : "etf") as AssetClass, asset: a }));
  if (!wanted.length) return 0;
  const quotes = await fetchQuotes(wanted.map((w) => ({ symbol: w.symbol, assetClass: w.assetClass })));
  let n = 0;
  for (const w of wanted) {
    const q = quotes.find((x) => x.symbol === w.symbol);
    if (!q) continue;
    await db.update(investmentAssets).set({ lastPrice: q.price, lastPriceAt: q.asOf, lastPriceSource: `${q.provider} (${q.freshness})` }).where(eq(investmentAssets.id, w.asset.id));
    n++;
  }
  return n;
}

export async function snapshotPortfolio(userId: string, tz?: string) {
  const p = await portfolio(userId);
  const date = todayKey(tz);
  const existing = await db.select({ id: portfolioSnapshots.id }).from(portfolioSnapshots).where(and(eq(portfolioSnapshots.userId, userId), eq(portfolioSnapshots.date, date)));
  const values = { userId, date, totalValue: p.totalValue, totalCost: p.totalCost, cash: p.cash, breakdown: { allocation: p.allocation, unpriced: p.unpriced } };
  if (existing[0]) await db.update(portfolioSnapshots).set(values).where(eq(portfolioSnapshots.id, existing[0].id));
  else await db.insert(portfolioSnapshots).values(values);
  return p;
}
export async function portfolioHistory(userId: string, limit = 90) {
  return db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.userId, userId)).orderBy(desc(portfolioSnapshots.date)).limit(limit).then((r) => r.reverse());
}
