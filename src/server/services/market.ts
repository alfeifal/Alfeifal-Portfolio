import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { economicEvents, marketNews, marketQuotes, notifications, priceAlerts } from "@/server/db/schema";
import { fetchQuotes, newsProvider, type AssetClass, type Quote } from "@/server/market";
import { dateSchema } from "./tasks";

const QUOTE_TTL_MS = 5 * 60 * 1000;
const NEWS_TTL_MS = 15 * 60 * 1000;
let lastNewsRefresh = 0;

/** Cached quotes; refreshes from providers when stale. Missing symbols are reported, never faked. */
export async function getQuotes(symbols: { symbol: string; assetClass: AssetClass }[], opts: { maxAgeMs?: number } = {}) {
  if (!symbols.length) return { quotes: [] as Quote[], missing: [] as string[] };
  const maxAge = opts.maxAgeMs ?? QUOTE_TTL_MS;
  const syms = [...new Set(symbols.map((s) => s.symbol.toUpperCase()))];
  const cached = await db.select().from(marketQuotes).where(and(inArray(marketQuotes.symbol, syms), gte(marketQuotes.fetchedAt, new Date(Date.now() - maxAge)))).orderBy(desc(marketQuotes.fetchedAt));
  const fresh = new Map<string, Quote>();
  for (const c of cached) if (!fresh.has(c.symbol)) fresh.set(c.symbol, { symbol: c.symbol, assetClass: c.assetClass as AssetClass, price: c.price, change: c.change, changePct: c.changePct, currency: c.currency, asOf: c.asOf, provider: c.provider, freshness: c.provider === "stooq" || c.provider === "yahoo" ? "delayed" : "realtime" });
  const toFetch = symbols.filter((s) => !fresh.has(s.symbol.toUpperCase()));
  if (toFetch.length) {
    const quotes = await fetchQuotes(toFetch.map((s) => ({ symbol: s.symbol.toUpperCase(), assetClass: s.assetClass })));
    for (const q of quotes) {
      fresh.set(q.symbol, q);
      await db.insert(marketQuotes).values({ symbol: q.symbol, assetClass: q.assetClass, price: q.price, change: q.change, changePct: q.changePct, currency: q.currency, provider: q.provider, asOf: q.asOf });
    }
  }
  const missing = syms.filter((s) => !fresh.has(s));
  return { quotes: [...fresh.values()], missing };
}

export async function refreshNews(force = false) {
  if (!force && Date.now() - lastNewsRefresh < NEWS_TTL_MS) return 0;
  lastNewsRefresh = Date.now();
  const items = await newsProvider().getNews({ limit: 400 });
  let inserted = 0;
  for (const n of items) {
    const r = await db
      .insert(marketNews)
      .values({ headline: n.headline, source: n.source, url: n.url, publishedAt: n.publishedAt, category: n.category, summary: n.summary ?? null, symbols: n.symbols ?? [], provider: n.provider })
      .onConflictDoNothing({ target: marketNews.url })
      .returning({ id: marketNews.id });
    inserted += r.length;
  }
  // keep the table bounded
  await db.delete(marketNews).where(lte(marketNews.publishedAt, new Date(Date.now() - 30 * 24 * 3600e3)));
  return inserted;
}

export async function listNews(opts: { category?: string; limit?: number; symbols?: string[]; q?: string; sinceHours?: number } = {}) {
  const conds = [];
  if (opts.category && opts.category !== "all") conds.push(eq(marketNews.category, opts.category));
  if (opts.sinceHours) conds.push(gte(marketNews.publishedAt, new Date(Date.now() - opts.sinceHours * 3600e3)));
  if (opts.q) conds.push(sql`(${marketNews.headline} ilike ${"%" + opts.q + "%"} or ${marketNews.summary} ilike ${"%" + opts.q + "%"})`);
  if (opts.symbols?.length) conds.push(sql`(${sql.join(opts.symbols.map((s) => sql`${marketNews.headline} ilike ${"%" + s + "%"}`), sql` or `)})`);
  return db.select().from(marketNews).where(conds.length ? and(...conds) : undefined).orderBy(desc(marketNews.publishedAt)).limit(opts.limit ?? 100);
}
export async function setNewsAi(id: string, ai: { aiSummary: string; aiWhyItMatters: string }) {
  await db.update(marketNews).set(ai).where(eq(marketNews.id, id));
}

export const econEventSchema = z.object({ title: z.string().min(1).max(200), country: z.string().max(50).nullish(), at: z.coerce.date(), importance: z.enum(["low", "medium", "high"]).default("medium"), category: z.string().max(40).default("macro"), notes: z.string().max(2000).nullish() });
export async function listEconomicEvents(userId: string, range: { from: Date; to: Date }) {
  return db.select().from(economicEvents).where(and(eq(economicEvents.userId, userId), gte(economicEvents.at, range.from), lte(economicEvents.at, range.to))).orderBy(economicEvents.at);
}
export async function createEconomicEvent(userId: string, input: z.infer<typeof econEventSchema>) {
  const [e] = await db.insert(economicEvents).values({ ...input, userId }).returning();
  return e;
}
export async function deleteEconomicEvent(userId: string, id: string) {
  await db.delete(economicEvents).where(and(eq(economicEvents.id, id), eq(economicEvents.userId, userId)));
}

/** Evaluate active price alerts against fresh quotes and turn hits into notifications. */
export async function checkAlerts(userId: string) {
  const alerts = await db.select().from(priceAlerts).where(and(eq(priceAlerts.userId, userId), eq(priceAlerts.active, true)));
  if (!alerts.length) return 0;
  const { quotes } = await getQuotes(alerts.map((a) => ({ symbol: a.symbol, assetClass: a.assetClass as AssetClass })));
  let fired = 0;
  for (const a of alerts) {
    const q = quotes.find((x) => x.symbol === a.symbol);
    if (!q) continue;
    const hit = a.condition === "above" ? q.price >= a.price : q.price <= a.price;
    if (!hit) continue;
    await db.update(priceAlerts).set({ triggeredAt: new Date(), active: false }).where(eq(priceAlerts.id, a.id));
    await db.insert(notifications).values({ userId, kind: "market", title: `${a.symbol} is ${a.condition} ${a.price}`, body: `Current price ${q.price} (${q.provider}, ${q.freshness}).${a.note ? " " + a.note : ""}`, href: "/trading", dedupeKey: `alert:${a.id}` });
    fired++;
  }
  return fired;
}
export { dateSchema as _d };
