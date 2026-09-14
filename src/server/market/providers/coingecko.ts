import type { AssetClass, Quote, QuoteProvider } from "../types";

const IDS: Record<string, string> = { btc: "bitcoin", eth: "ethereum", sol: "solana", bnb: "binancecoin", xrp: "ripple", ada: "cardano", doge: "dogecoin", dot: "polkadot", avax: "avalanche-2", link: "chainlink", ltc: "litecoin", matic: "matic-network" };

/** Free key-less crypto prices from CoinGecko (public API, rate limited). */
export class CoinGeckoProvider implements QuoteProvider {
  readonly name = "coingecko";
  supports(assetClass: AssetClass) {
    return assetClass === "crypto";
  }
  async getQuotes(symbols: { symbol: string; assetClass: AssetClass }[]): Promise<Quote[]> {
    const wanted = symbols.map((s) => ({ ...s, id: IDS[s.symbol.toLowerCase().replace(/-?usd[t]?$/, "")] ?? s.symbol.toLowerCase() }));
    if (!wanted.length) return [];
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${wanted.map((w) => w.id).join(",")}&vs_currencies=usd,eur&include_24hr_change=true&include_last_updated_at=true`, { headers: { accept: "application/json" } });
      if (!res.ok) return [];
      const d = (await res.json()) as Record<string, { usd?: number; eur?: number; usd_24h_change?: number; last_updated_at?: number }>;
      return wanted
        .filter((w) => d[w.id]?.usd)
        .map((w) => {
          const x = d[w.id];
          const price = x.usd!;
          const pct = x.usd_24h_change ?? null;
          return { symbol: w.symbol, assetClass: "crypto" as const, price, change: pct != null ? price - price / (1 + pct / 100) : null, changePct: pct, currency: "USD", asOf: new Date((x.last_updated_at ?? Date.now() / 1000) * 1000), provider: this.name, freshness: "realtime" as const };
        });
    } catch (e) {
      console.warn("[coingecko] failed", e);
      return [];
    }
  }
}
