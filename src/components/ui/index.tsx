"use client";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ children, className, title, action, href }: { children?: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; href?: string }) {
  return (
    <section className={cn("card p-4", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && (href ? <Link href={href} className="h2 hover:underline">{title}</Link> : <h2 className="h2">{title}</h2>)}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function PageHeader({ title, subtitle, action, back }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back && <Link href={back.href} className="text-xs muted hover:underline">← {back.label}</Link>}
        <h1 className="h1">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm muted">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
export function Stat({ label, value, sub, tone, href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "positive" | "negative" | "warning"; href?: string }) {
  const inner = (
    <div className="card p-3">
      <p className="text-xs muted">{label}</p>
      <p className={cn("text-xl font-semibold tnum", tone === "positive" && "text-positive", tone === "negative" && "text-negative", tone === "warning" && "text-warning")}>{value}</p>
      {sub && <p className="text-xs muted">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="card p-6 text-center text-sm muted">{children}{action && <div className="mt-3 flex justify-center">{action}</div>}</div>;
}
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="card border-negative/40 p-4 text-sm">
      <p className="font-semibold text-negative">Something went wrong</p>
      <p className="muted">{error}</p>
      {retry && <button className="btn-ghost btn-sm mt-2" onClick={retry}>Retry</button>}
    </div>
  );
}
export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <div className="flex items-center gap-2 py-6 text-sm muted" role="status"><span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted/40 border-t-fg" />{label}</div>;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-surface-2", className)} />;
}
export function Bar({ value, tone = "accent", h = 6 }: { value: number; tone?: "accent" | "positive" | "negative" | "warning"; h?: number }) {
  const w = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return <div className="w-full overflow-hidden rounded-full bg-surface-2" style={{ height: h }}><div className={cn("h-full rounded-full transition-[width]", tone === "accent" && "bg-accent", tone === "positive" && "bg-positive", tone === "negative" && "bg-negative", tone === "warning" && "bg-warning")} style={{ width: `${w}%` }} /></div>;
}
export function Badge({ children, tone = "muted", className }: { children: ReactNode; tone?: "muted" | "positive" | "negative" | "warning" | "accent"; className?: string }) {
  return <span className={cn("pill", tone === "positive" && "bg-positive/15 text-positive", tone === "negative" && "bg-negative/15 text-negative", tone === "warning" && "bg-warning/15 text-warning", tone === "accent" && "bg-accent text-accent-fg", className)}>{children}</span>;
}
/** Provenance label (spec §34). */
export function Source({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  const map: Record<string, { label: string; tone: "muted" | "warning" | "accent" | "positive" }> = { user: { label: "exact", tone: "positive" }, ai: { label: "AI", tone: "accent" }, estimated: { label: "estimated", tone: "warning" }, external: { label: "external", tone: "muted" }, calculated: { label: "calculated", tone: "muted" }, import: { label: "database", tone: "muted" } };
  const m = map[source] ?? { label: source, tone: "muted" as const };
  return <Badge tone={m.tone} className="!text-[10px]">{m.label}</Badge>;
}
export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
      {options.map((o) => <button key={o.value} onClick={() => onChange(o.value)} className={cn("rounded-full border border-border px-3 py-1.5 text-sm font-medium whitespace-nowrap", value === o.value ? "bg-accent text-accent-fg border-accent" : "hover:bg-surface-2")}>{o.label}</button>)}
    </div>
  );
}
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className={cn("max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-4 shadow-xl sm:rounded-2xl safe-b", wide ? "sm:max-w-2xl" : "sm:max-w-md")} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><h2 className="h2">{title}</h2><button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}
export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span>{children}{hint && <span className="mt-1 block text-xs muted">{hint}</span>}</label>;
}
export function Confirm({ message, onConfirm, children, className = "btn-ghost btn-sm" }: { message: string; onConfirm: () => void; children: ReactNode; className?: string }) {
  return <button className={className} onClick={() => { if (confirm(message)) onConfirm(); }}>{children}</button>;
}
/** Minimal markdown renderer for AI output (headings, bullets, bold, code, tables). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: { type: "ul" | "ol"; items: ReactNode[] } | null = null;
  let table: string[][] | null = null;
  const flush = () => {
    if (list) { out.push(list.type === "ul" ? <ul key={out.length}>{list.items.map((i, k) => <li key={k}>{i}</li>)}</ul> : <ol key={out.length}>{list.items.map((i, k) => <li key={k}>{i}</li>)}</ol>); list = null; }
    if (table) { const [h, ...rows] = table; out.push(<div key={out.length} className="overflow-x-auto"><table><thead><tr>{h.map((c, k) => <th key={k}>{inline(c)}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table></div>); table = null; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\|.*\|$/.test(line)) { const cells = line.slice(1, -1).split("|").map((c) => c.trim()); if (cells.every((c) => /^:?-+:?$/.test(c))) continue; table = table ?? []; table.push(cells); continue; } else if (table) flush();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); const Tag = (`h${Math.min(3, h[1].length)}` as "h1" | "h2" | "h3"); out.push(<Tag key={out.length}>{inline(h[2])}</Tag>); continue; }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) { const type = ul ? "ul" : "ol"; if (!list || list.type !== type) { flush(); list = { type, items: [] }; } list.items.push(inline((ul ?? ol)![1])); continue; }
    flush();
    if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return <div className={cn("prose-sm text-sm", className)}>{out}</div>;
}
function inline(s: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) parts.push(<strong key={m.index}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) parts.push(<code key={m.index}>{t.slice(1, -1)}</code>);
    else { const mm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!; parts.push(<a key={m.index} href={mm[2]} target="_blank" rel="noreferrer" className="link">{mm[1]}</a>); }
    last = m.index + t.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
