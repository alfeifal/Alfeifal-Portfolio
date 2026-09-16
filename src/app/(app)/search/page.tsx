"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, m } from "motion/react";
import { Search as SearchIcon, X } from "lucide-react";
import { Card, Empty, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { T, V } from "@/components/motion";
import { api, fmtDate } from "@/lib/client";
import { cn } from "@/lib/utils";
import { groupByModule, moduleMeta, typeLabel, type SearchResponse } from "@/components/search/results";

/** How long to wait after the last keystroke. Typing a word never costs one request per letter. */
const DEBOUNCE_MS = 250;
const MIN_LENGTH = 2;

function SearchPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [module, setModule] = useState<string | null>(null);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const search = useCallback(async (term: string) => {
    const id = ++seq.current;
    if (term.trim().length < MIN_LENGTH) { setData(null); setError(""); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const r = await api<SearchResponse>(`/api/search?q=${encodeURIComponent(term)}&limit=60`);
      if (id === seq.current) { setData(r); setLoading(false); }   // a stale response never overwrites a newer one
    } catch (e) {
      if (id === seq.current) { setError((e as Error).message); setData(null); setLoading(false); }
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, search]);

  // Keep the URL shareable without re-rendering on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search";
      router.replace(next, { scroll: false });
    }, 600);
    return () => clearTimeout(t);
  }, [q, router]);

  const hits = data?.hits ?? [];
  const modules = [...new Set(hits.map((h) => h.module))];
  const shown = module ? hits.filter((h) => h.module === module) : hits;
  const groups = groupByModule(shown);
  const short = q.trim().length > 0 && q.trim().length < MIN_LENGTH;

  return (
    <div className="space-y-4">
      <PageHeader title="Search" subtitle="Everything in your Personal OS" />

      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3">
        <SearchIcon size={17} className="muted shrink-0" />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          aria-label="Search your Personal OS"
          className="min-w-0 flex-1 bg-transparent py-3 text-[15px] outline-none placeholder:text-muted/70"
          placeholder="entrecot, Velsoma, Budapest, entrenamiento pecho…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); inputRef.current?.focus(); } }}
        />
        {loading && <Spinner />}
        {q && !loading && <button aria-label="Clear search" className="muted transition-colors hover:text-fg" onClick={() => { setQ(""); inputRef.current?.focus(); }}><X size={16} /></button>}
      </div>

      {modules.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button className={cn("pill transition-colors", !module ? "bg-accent text-accent-fg" : "hover:bg-border")} onClick={() => setModule(null)}>All {hits.length}</button>
          {modules.map((mo) => {
            const meta = moduleMeta(mo);
            const n = hits.filter((h) => h.module === mo).length;
            return <button key={mo} className={cn("pill inline-flex items-center gap-1 transition-colors", module === mo ? "bg-accent text-accent-fg" : "hover:bg-border")} onClick={() => setModule(module === mo ? null : mo)}><meta.icon size={12} />{meta.label} {n}</button>;
          })}
        </div>
      )}

      {error && <ErrorBox error={error} retry={() => { void search(q); }} />}
      {short && <p className="text-sm muted">Type at least {MIN_LENGTH} characters.</p>}
      {!error && !short && !q.trim() && <Empty title="Search everything">Tasks, events, meals, workouts, studies, money, trades, journal, memories and the German course.</Empty>}
      {!error && !loading && q.trim().length >= MIN_LENGTH && data && hits.length === 0 && (
        <Empty title={`Nothing matches “${data.query}”`}>Try fewer words, or part of a word.</Empty>
      )}

      {data && data.truncated && <p className="text-xs muted">Showing the {hits.length} best of {data.total} matches.</p>}

      <AnimatePresence initial={false}>
        {groups.map(({ module: mo, items }) => {
          const meta = moduleMeta(mo);
          return (
            <m.section key={mo} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.enter} className="space-y-1.5">
              <h2 className="flex items-center gap-1.5 px-0.5 text-[11px] font-medium uppercase tracking-wider muted"><meta.icon size={12} />{meta.label}</h2>
              <Card className="divide-y divide-border p-0">
                {items.map((h) => (
                  <button
                    key={h.type + h.id}
                    onClick={() => (h.href.startsWith("http") ? window.open(h.href, "_blank", "noopener") : router.push(h.href))}
                    className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{h.title}</span>
                      {h.snippet && <span className="mt-0.5 block truncate text-xs muted">{h.snippet}</span>}
                    </span>
                    <span className="shrink-0 text-right text-[11px] muted">
                      <span className="block">{typeLabel(h.type)}</span>
                      {h.date && <span className="block">{fmtDate(h.date)}</span>}
                    </span>
                  </button>
                ))}
              </Card>
            </m.section>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="p-6"><Spinner /></div>}><SearchPage /></Suspense>;
}
