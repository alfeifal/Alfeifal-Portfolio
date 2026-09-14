import type { AssetClass, Quote, QuoteProvider } from "../types";

/**
 * Free, key-less delayed/EOD quotes from https://stooq.com (CSV). Symbols use stooq notation:
 * US stocks "aapl.us", ETFs on Xetra "vwce.de", indices "^spx", forex "eurusd", gold "xauusd".
 * The user-facing symbol is mapped with `toStooq`.
 */
export class StooqProvider implements QuoteProvider {
  readonly name = "stooq";
  supports(assetClass: AssetClass) {
    return ["stock", "etf", "index", "forex", "commodity"].includes(assetClass);
  }
  static toStooq(symbol: string, assetClass: AssetClass) {
    const s = symbol.toLowerCase();
    if (s.includes(".") || s.startsWith("^")) return s;
    if (assetClass === "forex" || assetClass === "commodity") return s;
    if (assetClass === "index") return `^${s}`;
    return `${s}.us`;
  }
  async getQuotes(symbols: { symbol: string; assetClass: AssetClass }[]): Promise<Quote[]> {
    if (!symbols.length) return [];
    const map = new Map(symbols.map((s) => [StooqProvider.toStooq(s.symbol, s.assetClass), s]));
    const url = `https://stooq.com/q/l/?s=${[...map.keys()].join("+")}&f=sd2t2ohlcvpn&h&e=csv`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "PersonalOS/1.0" } });
      if (!res.ok) return [];
      const text = await res.text();
      const lines = text.trim().split("\n").slice(1);
      const out: Quote[] = [];
      for (const line of lines) {
        const [sym, date, time, open, _h, _l, close, _v, prevClose] = line.split(",");
        const orig = map.get(sym.toLowerCase());
        const price = Number(close);
        if (!orig || !Number.isFinite(price) || price <= 0 || close === "N/D") continue;
        const prev = Number(prevClose);
        const change = Number.isFinite(prev) && prev > 0 ? price - prev : Number.isFinite(Number(open)) ? price - Number(open) : null;
        const base = Number.isFinite(prev) && prev > 0 ? prev : Number(open);
        const asOf = date && time && date !== "N/D" ? new Date(`${date}T${time}Z`) : new Date();
        out.push({ symbol: orig.symbol, assetClass: orig.assetClass, price, change, changePct: change != null && base > 0 ? (change / base) * 100 : null, currency: null, asOf, provider: this.name, freshness: "delayed" });
      }
      return out;
    } catch (e) {
      console.warn("[stooq] failed", e);
      return [];
    }
  }
}
