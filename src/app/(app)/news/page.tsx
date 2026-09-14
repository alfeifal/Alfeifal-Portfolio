"use client";
import { useState } from "react";
import { Badge, Empty, ErrorBox, PageHeader, Tabs, SkeletonList } from "@/components/ui";
import { Stagger, StaggerItem } from "@/components/motion";
import { api, fmtDate, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";

interface News { id: string; headline: string; source: string; url: string; publishedAt: string; category: string; summary: string | null; aiSummary: string | null; aiWhyItMatters: string | null; provider: string }
const CATS = [["all", "All"], ["global", "Global"], ["us", "US"], ["macro", "Macro"], ["central_banks", "Central banks"], ["commodities", "Commodities"], ["forex", "Forex"], ["crypto", "Crypto"], ["watchlist", "My watchlist"]] as const;

/** Market News (spec §14): real RSS headlines with source, time and link. AI interpretation is on demand and labelled. */
export default function NewsPage() {
  const { aiConfigured } = useShell();
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const [refresh, setRefresh] = useState(0);
  const wl = useApi<{ items: { symbol: string }[] }[]>("/api/trading/watchlist");
  const symbols = cat === "watchlist" ? (wl.data?.flatMap((w) => w.items.map((i) => i.symbol)) ?? []) : [];
  const news = useApi<{ refreshed: number; items: News[] }>(`/api/market/news?category=${cat === "watchlist" ? "all" : cat}&limit=120${q ? "&q=" + encodeURIComponent(q) : ""}${symbols.length ? "&symbols=" + symbols.join(",") : ""}${refresh ? "&refresh=1" : ""}`, [cat, q, refresh, symbols.join(",")]);
  const [ai, setAi] = useState<Record<string, { aiSummary: string; aiWhyItMatters: string } | "loading">>({});
  const explain = async (n: News) => { setAi((s) => ({ ...s, [n.id]: "loading" })); try { setAi((s) => ({ ...s, [n.id]: {} as never })); const r = await api<{ aiSummary: string; aiWhyItMatters: string }>("/api/ai/news-explain", { method: "POST", json: { id: n.id } }); setAi((s) => ({ ...s, [n.id]: r })); } catch (e) { setAi((s) => ({ ...s, [n.id]: { aiSummary: "Failed: " + (e as Error).message, aiWhyItMatters: "" } })); } };
  return (
    <div className="space-y-3">
      <PageHeader title="Market News" subtitle="Aggregated from public RSS feeds (CNBC, MarketWatch, Fed, ECB, Investing.com, CoinDesk, Yahoo…). Headlines are verified external data; AI notes are interpretation." action={<><input className="field !w-48 !py-1.5 text-sm" placeholder="Search headlines" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn-ghost btn-sm" onClick={() => setRefresh((n) => n + 1)} disabled={news.loading}>Refresh feeds</button></>} />
      <Tabs value={cat} onChange={setCat} options={CATS.map(([v, l]) => ({ value: v, label: l }))} />
      {news.error && <ErrorBox error={news.error} retry={news.reload} />}
      {news.loading && !news.data && <SkeletonList rows={8} />}
      {news.data && news.data.items.length === 0 && <Empty>{cat === "watchlist" && !symbols.length ? "Your watchlist is empty." : "No headlines match. Try Refresh feeds."}</Empty>}
      {news.data && news.data.items.length > 0 && (
        <Stagger as="ul" className="card divide-y divide-border" gap={0.02}>
          {news.data.items.map((n) => { const a = ai[n.id] ?? (n.aiSummary ? { aiSummary: n.aiSummary, aiWhyItMatters: n.aiWhyItMatters ?? "" } : undefined); return (
            <StaggerItem as="li" key={n.id} className="row px-3 py-2.5">
              <a href={n.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">{n.headline}</a>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs muted"><Badge>{n.category.replace("_", " ")}</Badge><span>{n.source}</span><span>· {fmtDate(n.publishedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><Badge tone="muted" className="!text-[10px]">external</Badge>{aiConfigured && !a && <button className="link" onClick={() => explain(n)}>AI: why it matters</button>}</p>
              {n.summary && <p className="mt-1 text-xs muted line-clamp-2">{n.summary}</p>}
              {a === "loading" && <p className="mt-1 text-xs muted">Interpreting…</p>}
              {a && a !== "loading" && a.aiSummary && <div className="mt-1 rounded-lg bg-surface-2 p-2 text-xs"><p><Badge tone="accent" className="!text-[10px]">AI interpretation</Badge> {a.aiSummary}</p>{a.aiWhyItMatters && <p className="mt-1"><span className="font-medium">Why it matters:</span> {a.aiWhyItMatters}</p>}</div>}
            </StaggerItem>); })}
        </Stagger>
      )}
    </div>
  );
}
