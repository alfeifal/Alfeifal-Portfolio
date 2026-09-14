"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui";
import { api } from "@/lib/client";

interface Hit { type: string; id: string; title: string; subtitle?: string | null; href: string; date?: string | null }

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => { setBusy(true); api<Hit[]>(`/api/search?q=${encodeURIComponent(q)}`).then(setHits).catch(() => setHits([])).finally(() => setBusy(false)); }, 250);
    return () => clearTimeout(t);
  }, [q, open]);
  return (
    <Modal open={open} onClose={onClose} title="Search" wide>
      <input className="field" autoFocus placeholder="Tasks, events, expenses, workouts, trades, German vocabulary…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-[60vh] divide-y divide-border overflow-y-auto">
        {busy && <p className="py-2 text-xs muted">Searching…</p>}
        {!busy && q.length >= 2 && hits.length === 0 && <p className="py-2 text-sm muted">No results.</p>}
        {hits.map((h) => (
          <Link key={h.type + h.id} href={h.href} onClick={onClose} target={h.href.startsWith("http") ? "_blank" : undefined} className="flex items-center gap-3 py-2 text-sm hover:bg-surface-2">
            <span className="pill w-24 justify-center capitalize">{h.type.replace("_", " ")}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{h.title}</span>{h.subtitle && <span className="block truncate text-xs muted">{h.subtitle}</span>}</span>
            {h.date && <span className="text-xs muted">{h.date.slice(0, 10)}</span>}
          </Link>
        ))}
      </div>
    </Modal>
  );
}
