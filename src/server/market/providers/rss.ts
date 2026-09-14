import { XMLParser } from "fast-xml-parser";
import type { NewsItem, NewsProvider } from "../types";

interface Feed { name: string; url: string; category: string }

/** Real, public RSS feeds from reputable financial sources. Extend via EXTRA_NEWS_FEEDS="Name|url|category,...". */
export const DEFAULT_FEEDS: Feed[] = [
  { name: "CNBC Top News", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", category: "global" },
  { name: "CNBC Markets", url: "https://www.cnbc.com/id/20910258/device/rss/rss.html", category: "us" },
  { name: "CNBC Economy", url: "https://www.cnbc.com/id/20910258/device/rss/rss.html", category: "macro" },
  { name: "MarketWatch Top Stories", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", category: "us" },
  { name: "MarketWatch Market Pulse", url: "https://feeds.content.dowjones.io/public/rss/mw_marketpulse", category: "us" },
  { name: "Federal Reserve Press", url: "https://www.federalreserve.gov/feeds/press_all.xml", category: "central_banks" },
  { name: "ECB Press", url: "https://www.ecb.europa.eu/rss/press.html", category: "central_banks" },
  { name: "Investing.com Commodities", url: "https://www.investing.com/rss/news_11.rss", category: "commodities" },
  { name: "Investing.com Forex", url: "https://www.investing.com/rss/news_1.rss", category: "forex" },
  { name: "Investing.com Stock Markets", url: "https://www.investing.com/rss/news_25.rss", category: "global" },
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", category: "crypto" },
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss", category: "crypto" },
  { name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex", category: "global" },
];

export function configuredFeeds(): Feed[] {
  const extra = (process.env.EXTRA_NEWS_FEEDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, url, category] = s.split("|");
      return { name: name?.trim() ?? "Custom", url: url?.trim() ?? "", category: category?.trim() ?? "global" };
    })
    .filter((f) => f.url.startsWith("https://"));
  return [...DEFAULT_FEEDS, ...extra];
}

export class RssNewsProvider implements NewsProvider {
  readonly name = "rss";
  constructor(private feeds: Feed[] = configuredFeeds()) {}

  async getNews(opts: { limit?: number } = {}): Promise<NewsItem[]> {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const results = await Promise.allSettled(
      this.feeds.map(async (feed) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(feed.url, { headers: { "User-Agent": "PersonalOS/1.0 (+news aggregator)", accept: "application/rss+xml, application/xml, text/xml" }, signal: ctrl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const xml = await res.text();
          const doc = parser.parse(xml);
          const items: unknown[] = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
          return (Array.isArray(items) ? items : [items]).map((raw) => toItem(raw as Record<string, unknown>, feed)).filter((x): x is NewsItem => !!x);
        } finally {
          clearTimeout(t);
        }
      }),
    );
    const all: NewsItem[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") all.push(...r.value);
      else console.warn(`[rss] ${this.feeds[i].name} failed:`, (r.reason as Error)?.message);
    });
    const seen = new Set<string>();
    return all
      .filter((n) => (seen.has(n.url) ? false : (seen.add(n.url), true)))
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, opts.limit ?? 300);
  }
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "#text" in (v as object)) return String((v as { "#text": unknown })["#text"] ?? "");
  if (typeof v === "object" && v && "@_href" in (v as object)) return String((v as { "@_href": unknown })["@_href"] ?? "");
  return String(v);
}

function toItem(raw: Record<string, unknown>, feed: Feed): NewsItem | null {
  const headline = text(raw.title).trim();
  let url = text(raw.link).trim();
  if (!url && Array.isArray(raw.link)) url = text(raw.link[0]);
  if (!url) url = text(raw.guid).trim();
  const date = text(raw.pubDate) || text(raw.published) || text(raw.updated) || text(raw["dc:date"]);
  const publishedAt = date ? new Date(date) : new Date();
  if (!headline || !url.startsWith("http") || Number.isNaN(publishedAt.getTime())) return null;
  const summary = stripHtml(text(raw.description) || text(raw.summary) || text(raw.content)).slice(0, 600) || null;
  return { headline: stripHtml(headline), url, source: feed.name, publishedAt, summary, category: feed.category, provider: "rss" };
}
function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
