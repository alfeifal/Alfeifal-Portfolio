"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "motion/react";
import { ArrowRight, CornerDownLeft, Plus, Sparkles, Search as SearchIcon } from "lucide-react";
import { NAV } from "@/components/nav";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { T } from "@/components/motion";

import type { SearchHit, SearchResponse } from "@/components/search/results";
import { moduleMeta, typeLabel } from "@/components/search/results";
interface Cmd { id: string; label: string; hint?: string; group: "Go to" | "Create" | "Ask AI" | "Results"; icon?: React.ReactNode; run: () => void; keywords?: string }

/** Global command palette (spec §21/§22): navigation, quick actions, AI questions and search results in one panel. */
export function CommandPalette({ open, onClose, onQuick }: { open: boolean; onClose: () => void; onQuick: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const seq = useRef(0);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQ(""); setHits([]); setIndex(0); setSearchError(""); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  // Debounced so a typed word is one request, and sequence-guarded so a slow reply cannot overwrite a newer one.
  useEffect(() => {
    if (!open || q.trim().length < 2) { setHits([]); setSearchError(""); return; }
    const t = setTimeout(() => {
      const id = ++seq.current;
      setBusy(true);
      api<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}&limit=24&perEntity=3`)
        .then((r) => { if (id === seq.current) { setHits(r.hits); setSearchError(""); } })
        .catch((e) => { if (id === seq.current) { setHits([]); setSearchError((e as Error).message); } })
        .finally(() => { if (id === seq.current) setBusy(false); });
    }, 220);
    return () => clearTimeout(t);
  }, [q, open]);
  const go = (href: string) => { onClose(); if (href.startsWith("http")) window.open(href, "_blank"); else router.push(href); };
  const ask = (text: string) => go(`/assistant?q=${encodeURIComponent(text)}`);
  const commands = useMemo<Cmd[]>(() => {
    const nav: Cmd[] = NAV.map((n) => ({ id: "go:" + n.href, label: n.label, hint: n.href, group: "Go to", icon: <n.icon size={15} strokeWidth={1.8} />, run: () => go(n.href), keywords: "open go navigate " + n.label.toLowerCase() }));
    const create: Cmd[] = [
      { id: "c:expense", label: "Add expense", group: "Create", icon: <Plus size={15} />, run: () => go("/finance?new=tx"), keywords: "spent money" },
      { id: "c:task", label: "Create task", group: "Create", icon: <Plus size={15} />, run: () => go("/tasks?new=1"), keywords: "todo remind" },
      { id: "c:event", label: "Create calendar event", group: "Create", icon: <Plus size={15} />, run: () => go("/calendar?new=1") },
      { id: "c:workout", label: "Start today's workout", group: "Create", icon: <Plus size={15} />, run: () => go("/training"), keywords: "gym train" },
      { id: "c:study", label: "Log study session", group: "Create", icon: <Plus size={15} />, run: () => go("/studies?new=session") },
      { id: "c:journal", label: "Write journal entry", group: "Create", icon: <Plus size={15} />, run: () => go("/journal?new=1") },
      { id: "c:quick", label: "Quick entry (natural language)", hint: "⌘J", group: "Create", icon: <Sparkles size={15} />, run: onQuick, keywords: "ai log" },
    ];
    const askCmds: Cmd[] = ["What should I do today?", "Review my finances this month", "Plan tomorrow", "What do I train today?", "How is my German going?", "Summarize my week"].map((t) => ({ id: "ask:" + t, label: t, group: "Ask AI", icon: <Sparkles size={15} />, run: () => ask(t), keywords: "ai ask assistant" }));
    return [...create, ...askCmds, ...nav];
  }, [onQuick]);
  const nq = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    const local = nq ? commands.filter((c) => (c.label + " " + (c.keywords ?? "") + " " + (c.hint ?? "")).toLowerCase().includes(nq)) : commands;
    const results: Cmd[] = hits.map((h) => {
      const meta = moduleMeta(h.module);
      return { id: "hit:" + h.type + h.id, label: h.title, hint: `${meta.label} · ${typeLabel(h.type)}${h.snippet ? " · " + h.snippet : ""}`, group: "Results" as const, icon: <meta.icon size={14} />, run: () => go(h.href) };
    });
    const seeAll: Cmd[] = nq.length >= 2 ? [{ id: "hit:all", label: `See all results for “${q.trim()}”`, group: "Results", icon: <SearchIcon size={15} />, run: () => go(`/search?q=${encodeURIComponent(q.trim())}`) }] : [];
    const askFree: Cmd[] = nq.length > 3 && !local.some((c) => c.group === "Ask AI") ? [{ id: "ask:free", label: `Ask AI: “${q.trim()}”`, group: "Ask AI", icon: <Sparkles size={15} />, run: () => ask(q.trim()) }] : [];
    return [...results, ...seeAll, ...local, ...askFree];
  }, [commands, hits, nq, q]);
  useEffect(() => { setIndex(0); }, [filtered.length, nq]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(filtered.length - 1, i + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    if (e.key === "Enter") { e.preventDefault(); filtered[index]?.run(); }
    if (e.key === "Escape") onClose();
  };
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" }); }, [index]);
  const groupsOrder: Cmd["group"][] = ["Results", "Create", "Ask AI", "Go to"];
  let running = -1;
  return (
    <AnimatePresence>
      {open && (
        <m.div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" initial="hidden" animate="visible" exit="hidden">
          <m.div className="absolute inset-0 bg-black/50" variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }} transition={T.state} onClick={onClose} />
          <m.div role="dialog" aria-label="Command palette" className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/25" variants={{ hidden: { opacity: 0, scale: 0.97, y: -6 }, visible: { opacity: 1, scale: 1, y: 0 } }} transition={{ ...T.enter, duration: 0.18 }}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <SearchIcon size={16} className="muted" />
              <input ref={inputRef} className="flex-1 bg-transparent py-3 text-[15px] outline-none placeholder:text-muted/70" placeholder="Search, jump to a module, create, or ask…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
              {busy && <span className="text-xs muted">…</span>}
              <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] muted">esc</kbd>
            </div>
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
              {searchError && <p className="px-3 py-2 text-center text-sm text-negative">Search failed: {searchError}</p>}
              {filtered.length === 0 && !busy && <p className="px-3 py-6 text-center text-sm muted">Nothing matches.</p>}
              {groupsOrder.map((g) => { const items = filtered.filter((c) => c.group === g); if (!items.length) return null; return (
                <div key={g} className="mb-1">
                  <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-wider muted">{g}</p>
                  {items.map((c) => { running += 1; const i = running; return (
                    <button key={c.id} data-i={i} onMouseEnter={() => setIndex(i)} onClick={c.run} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors", i === index ? "bg-accent text-accent-fg" : "hover:bg-surface-2")}>
                      <span className={cn("inline-flex w-4 justify-center", i === index ? "text-accent-fg" : "muted")}>{c.icon ?? <ArrowRight size={14} />}</span>
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.hint && <span className={cn("truncate text-[11px]", i === index ? "text-accent-fg/70" : "muted")}>{c.hint}</span>}
                      {i === index && <CornerDownLeft size={13} className="opacity-70" />}
                    </button>); })}
                </div>); })}
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
