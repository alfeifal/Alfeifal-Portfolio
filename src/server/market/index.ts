import type { AssetClass, NewsProvider, Quote, QuoteProvider } from "./types";
import { FinnhubProvider } from "./providers/finnhub";
import { StooqProvider } from "./providers/stooq";
import { CoinGeckoProvider } from "./providers/coingecko";
import { RssNewsProvider } from "./providers/rss";
import { YahooProvider } from "./providers/yahoo";

/** Ordered by preference; the first provider that supports the asset class and returns data wins. */
export function quoteProviders(): QuoteProvider[] {
  const list: QuoteProvider[] = [];
  if (process.env.FINNHUB_API_KEY) list.push(new FinnhubProvider(process.env.FINNHUB_API_KEY));
  list.push(new CoinGeckoProvider(), new StooqProvider(), new YahooProvider());
  return list;
}
export function newsProvider(): NewsProvider {
  return new RssNewsProvider();
}

/** Fetches quotes across providers; symbols no provider can price are simply absent (never invented). */
export async function fetchQuotes(symbols: { symbol: string; assetClass: AssetClass }[]): Promise<Quote[]> {
  const remaining = new Map(symbols.map((s) => [`${s.symbol}:${s.assetClass}`, s]));
  const out: Quote[] = [];
  for (const p of quoteProviders()) {
    const batch = [...remaining.values()].filter((s) => p.supports(s.assetClass));
    if (!batch.length) continue;
    const quotes = await p.getQuotes(batch);
    for (const q of quotes) {
      remaining.delete(`${q.symbol}:${q.assetClass}`);
      out.push(q);
    }
    if (!remaining.size) break;
  }
  return out;
}
export * from "./types";
