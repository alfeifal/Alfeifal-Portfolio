import type { AssetClass, Quote, QuoteProvider } from "../types";

/**
 * Key-less fallback using Yahoo Finance's public chart endpoint (unofficial, may change).
 * Symbols use Yahoo notation: "AAPL", "VWCE.DE", "^GSPC", "EURUSD=X", "GC=F", "BTC-USD".
 * Labelled "delayed" because Yahoo delays many non-US exchanges.
 */
export class YahooProvider implements QuoteProvider {
  readonly name = "yahoo";
  supports(assetClass: AssetClass) {
    return ["stock", "etf", "index", "forex", "commodity", "crypto"].includes(assetClass);
  }
  static toYahoo(symbol: string, assetClass: AssetClass) {
    const s = symbol.toUpperCase();
    if (s.includes("=") || s.includes("^") || s.includes("-")) return s;
    if (assetClass === "crypto") return `${s}-USD`;
    if (assetClass === "forex") return `${s}=X`;
    if (assetClass === "index") return `^${s}`;
    if (assetClass === "commodity") return s.endsWith("=F") ? s : `${s}=F`;
    // stooq-style "aapl.us" → "AAPL"
    return s.endsWith(".US") ? s.slice(0, -3) : s;
  }
  async getQuotes(symbols: { symbol: string; assetClass: AssetClass }[]): Promise<Quote[]> {
    const out: Quote[] = [];
    await Promise.all(
      symbols.map(async ({ symbol, assetClass }) => {
        const y = YahooProvider.toYahoo(symbol, assetClass);
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?range=1d&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0 (PersonalOS)", accept: "application/json" }, signal: ctrl.signal });
          clearTimeout(t);
          if (!res.ok) return;
          const j = (await res.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketChangePercent?: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number; currency?: string } }[] } };
          const meta = j.chart?.result?.[0]?.meta;
          const price = meta?.regularMarketPrice;
          if (!meta || !price || price <= 0) return;
          const prev = meta.previousClose ?? meta.chartPreviousClose ?? null;
          const changePct = meta.regularMarketChangePercent ?? (prev != null && prev > 0 ? ((price - prev) / prev) * 100 : null);
          const change = changePct != null ? price - price / (1 + changePct / 100) : null;
          out.push({ symbol, assetClass, price, change, changePct, currency: meta.currency ?? null, asOf: new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000), provider: this.name, freshness: "delayed" });
        } catch (e) {
          console.warn("[yahoo] quote failed", symbol, e);
        }
      }),
    );
    return out;
  }
}
