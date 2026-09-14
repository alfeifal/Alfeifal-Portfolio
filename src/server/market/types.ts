/**
 * Provider abstraction (spec §35). The rest of the app only depends on these interfaces;
 * concrete providers live in ./providers and are selected in ./index.ts.
 */
export type AssetClass = "stock" | "etf" | "crypto" | "forex" | "commodity" | "index" | "other";

export interface Quote {
  symbol: string;
  assetClass: AssetClass;
  price: number;
  change: number | null;
  changePct: number | null;
  currency: string | null;
  /** When the price was valid (exchange time), as reported by the provider. */
  asOf: Date;
  provider: string;
  /** "realtime" | "delayed" | "eod" — always shown to the user. */
  freshness: "realtime" | "delayed" | "eod";
}

export interface NewsItem {
  headline: string;
  url: string;
  source: string;
  publishedAt: Date;
  summary?: string | null;
  category: string;
  symbols?: string[];
  provider: string;
}

export interface EconomicEvent {
  externalId: string;
  title: string;
  country?: string | null;
  at: Date;
  importance: "low" | "medium" | "high";
  category: string;
}

export interface QuoteProvider {
  readonly name: string;
  supports(assetClass: AssetClass): boolean;
  getQuotes(symbols: { symbol: string; assetClass: AssetClass }[]): Promise<Quote[]>;
}
export interface NewsProvider {
  readonly name: string;
  getNews(opts?: { limit?: number }): Promise<NewsItem[]>;
}
export interface EconomicCalendarProvider {
  readonly name: string;
  getEvents(range: { from: Date; to: Date }): Promise<EconomicEvent[]>;
}
