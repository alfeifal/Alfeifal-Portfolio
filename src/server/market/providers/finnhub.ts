import type { AssetClass, Quote, QuoteProvider } from "../types";

/** Real-time US quotes (and many global tickers) from https://finnhub.io — requires FINNHUB_API_KEY. */
export class FinnhubProvider implements QuoteProvider {
  readonly name = "finnhub";
  constructor(private apiKey: string) {}
  supports(assetClass: AssetClass) {
    return ["stock", "etf", "index", "forex", "crypto"].includes(assetClass);
  }
  async getQuotes(symbols: { symbol: string; assetClass: AssetClass }[]): Promise<Quote[]> {
    const out: Quote[] = [];
    await Promise.all(
      symbols.map(async ({ symbol, assetClass }) => {
        try {
          const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${this.apiKey}`, { next: { revalidate: 0 } });
          if (!res.ok) return;
          const d = (await res.json()) as { c: number; d: number | null; dp: number | null; t: number };
          if (!d.c || d.c === 0) return; // unknown symbol → no fake data
          out.push({ symbol, assetClass, price: d.c, change: d.d, changePct: d.dp, currency: null, asOf: new Date((d.t || Date.now() / 1000) * 1000), provider: this.name, freshness: "realtime" });
        } catch (e) {
          console.warn("[finnhub] quote failed", symbol, e);
        }
      }),
    );
    return out;
  }
}
