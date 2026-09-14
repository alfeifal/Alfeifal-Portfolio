"use client";
import Link from "next/link";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedNumber, T, V } from "@/components/motion";

/* ------------------------------------------------------------------ Cards */
type CardKind = "static" | "interactive" | "clickable";
/**
 * Card kinds (spec §4): `static` informational, `interactive` (hover lifts border/shadow, no scale),
 * `clickable` (renders a Link with hover + press feedback). Metric cards are `Stat`.
 */
export function Card({ children, className, title, action, href, kind, to }: { children?: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; href?: string; kind?: CardKind; to?: string }) {
  const k: CardKind = kind ?? (to ? "clickable" : "static");
  const body = (
    <>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && (href ? <Link href={href} className="h2 group inline-flex items-center gap-1 hover:underline">{title}<span className="text-xs muted opacity-0 transition-opacity group-hover:opacity-100">→</span></Link> : <h2 className="h2">{title}</h2>)}
          {action}
        </div>
      )}
      {children}
    </>
  );
  const base = cn("card p-4", k !== "static" && "card-interactive", className);
  if (k === "clickable" && to) return <m.div whileTap={{ scale: 0.995 }} transition={T.state}><Link href={to} className={cn(base, "block")}>{body}</Link></m.div>;
  return <section className={base}>{body}</section>;
}

export function PageHeader({ title, subtitle, action, back }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && <Link href={back.href} className="text-xs muted transition-colors hover:text-fg">← {back.label}</Link>}
        <h1 className="h1">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm muted">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

/** Metric card. Pass `count` (+ `format`) for a quick count-up on important numbers only. */
export function Stat({ label, value, sub, tone, href, count, format }: { label: string; value?: ReactNode; sub?: ReactNode; tone?: "positive" | "negative" | "warning"; href?: string; count?: number; format?: (v: number) => string }) {
  const inner = (
    <div className={cn("card p-3", href && "card-interactive")}>
      <p className="text-xs muted">{label}</p>
      <p className={cn("text-xl font-semibold tnum tracking-tight", tone === "positive" && "text-positive", tone === "negative" && "text-negative", tone === "warning" && "text-warning")}>
        {count != null ? <AnimatedNumber value={count} format={format} /> : value}
      </p>
      {sub && <p className="text-xs muted">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

/* ------------------------------------------------------------- States */
export function Empty({ children, action, title, icon }: { children?: ReactNode; action?: ReactNode; title?: ReactNode; icon?: ReactNode }) {
  return (
    <m.div variants={V.rise} initial="hidden" animate="visible" className="card flex flex-col items-center px-6 py-8 text-center">
      {icon && <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 muted">{icon}</div>}
      {title && <p className="text-sm font-medium">{title}</p>}
      {children && <p className="mt-0.5 max-w-sm text-sm muted">{children}</p>}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </m.div>
  );
}
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <m.div variants={V.rise} initial="hidden" animate="visible" className="card flex items-start gap-3 border-negative/40 p-4 text-sm">
      <span className="mt-0.5 text-negative"><AlertTriangle size={16} /></span>
      <div className="min-w-0 flex-1"><p className="font-semibold">Something went wrong</p><p className="muted">{error}</p></div>
      {retry && <Button variant="ghost" size="sm" onClick={retry}>Retry</Button>}
    </m.div>
  );
}
export function Spinner({ label = "Loading…", className }: { label?: string; className?: string }) {
  return <div className={cn("flex items-center gap-2 py-4 text-sm muted", className)} role="status"><Loader2 size={14} className="animate-spin" />{label}</div>;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-xl bg-surface-2", className)} aria-hidden />;
}
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return <div className={cn("card divide-y divide-border", className)} aria-busy>{[...Array(rows)].map((_, i) => <div key={i} className="flex items-center gap-3 px-3 py-3"><Skeleton className="h-4 w-4 rounded" /><Skeleton className="h-3.5 flex-1" /><Skeleton className="h-3 w-16" /></div>)}</div>;
}
export function SkeletonCards({ n = 4, className }: { n?: number; className?: string }) {
  return <div className={cn("grid gap-3 md:grid-cols-2", className)} aria-busy>{[...Array(n)].map((_, i) => <Skeleton key={i} className="h-36" />)}</div>;
}
export function SkeletonStats({ n = 4 }: { n?: number }) {
  return <div className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-busy>{[...Array(n)].map((_, i) => <Skeleton key={i} className="h-[74px]" />)}</div>;
}

/* ------------------------------------------------------------ Elements */
export function Bar({ value, tone = "accent", h = 6 }: { value: number; tone?: "accent" | "positive" | "negative" | "warning"; h?: number }) {
  const w = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface-2" style={{ height: h }}>
      <m.div className={cn("h-full rounded-full", tone === "accent" && "bg-accent", tone === "positive" && "bg-positive", tone === "negative" && "bg-negative", tone === "warning" && "bg-warning")} initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.5, ease: T.enter.ease }} />
    </div>
  );
}
export function Badge({ children, tone = "muted", className }: { children: ReactNode; tone?: "muted" | "positive" | "negative" | "warning" | "accent"; className?: string }) {
  return <span className={cn("pill", tone === "positive" && "bg-positive/15 text-positive", tone === "negative" && "bg-negative/15 text-negative", tone === "warning" && "bg-warning/15 text-warning", tone === "accent" && "bg-accent text-accent-fg", className)}>{children}</span>;
}
/** Provenance label (spec §34). */
export function Source({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  const map: Record<string, { label: string; tone: "muted" | "warning" | "accent" | "positive" }> = { user: { label: "exact", tone: "positive" }, ai: { label: "AI", tone: "accent" }, estimated: { label: "estimated", tone: "warning" }, external: { label: "external", tone: "muted" }, calculated: { label: "calculated", tone: "muted" }, import: { label: "database", tone: "muted" } };
  const mm = map[source] ?? { label: source, tone: "muted" as const };
  return <Badge tone={mm.tone} className="!text-[10px]">{mm.label}</Badge>;
}
/** Segmented tabs with a shared sliding indicator. */
export function Tabs<Tv extends string>({ value, onChange, options, id = "tabs" }: { value: Tv; onChange: (v: Tv) => void; options: { value: Tv; label: ReactNode }[]; id?: string }) {
  return (
    <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)} className={cn("relative rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors", value === o.value ? "text-accent-fg" : "muted hover:text-fg hover:bg-surface-2")}>
          {value === o.value && <m.span layoutId={`tab-ind-${id}`} className="absolute inset-0 rounded-full bg-accent" transition={T.layout} />}
          <span className="relative z-10">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- Buttons */
type Variant = "primary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md";
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: Variant; size?: Size; loading?: boolean; success?: boolean; icon?: ReactNode; children?: ReactNode;
}
/** Button with idle / hover / press / loading / success / disabled states (spec §8). */
export function Button({ variant = "ghost", size = "md", loading, success, icon, children, className, disabled, ...rest }: ButtonProps) {
  const cls = cn(variant === "primary" && "btn-primary", variant === "ghost" && "btn-ghost", variant === "danger" && "btn-danger", variant === "subtle" && "btn-subtle", size === "sm" && "btn-sm", className);
  return (
    <m.button whileTap={disabled || loading ? undefined : { scale: 0.97 }} transition={T.state} className={cls} disabled={disabled || loading} aria-busy={loading} {...(rest as object)}>
      <AnimatePresence mode="wait" initial={false}>
        {loading ? <m.span key="l" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={T.state} className="inline-flex"><Loader2 size={14} className="animate-spin" /></m.span>
          : success ? <m.span key="s" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={T.state} className="inline-flex text-positive"><Check size={14} strokeWidth={3} /></m.span>
          : icon ? <m.span key="i" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex">{icon}</m.span> : null}
      </AnimatePresence>
      {children}
    </m.button>
  );
}
/** Runs an async handler and shows loading → success (✓ for 1.2 s) automatically. */
export function AsyncButton({ onClick, successLabel, children, ...rest }: Omit<ButtonProps, "onClick"> & { onClick: () => Promise<unknown>; successLabel?: ReactNode }) {
  const [state, setState] = useState<"idle" | "loading" | "success">("idle");
  useEffect(() => { if (state === "success") { const t = setTimeout(() => setState("idle"), 1200); return () => clearTimeout(t); } }, [state]);
  return (
    <Button {...rest} loading={state === "loading"} success={state === "success"} onClick={async () => { setState("loading"); try { await onClick(); setState("success"); } catch { setState("idle"); } }}>
      {state === "success" && successLabel ? successLabel : children}
    </Button>
  );
}

/* ---------------------------------------------------------- Overlays */
/** Modal: scale 0.97→1 + backdrop fade on desktop, sheet from the bottom on mobile (spec §10). */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <m.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" initial="hidden" animate="visible" exit="hidden">
          <m.div className="absolute inset-0 bg-black/50" variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }} transition={T.state} onClick={onClose} />
          <m.div
            className={cn("relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 shadow-2xl shadow-black/20 sm:rounded-2xl safe-b", wide ? "sm:max-w-2xl" : "sm:max-w-md")}
            variants={{ hidden: { opacity: 0, scale: 0.97, y: 12 }, visible: { opacity: 1, scale: 1, y: 0 } }}
            transition={{ ...T.enter, duration: 0.2 }}
          >
            <div className="mb-3 flex items-center justify-between"><h2 className="h2">{title}</h2><button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button></div>
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
/** Careful destructive confirmation (replaces window.confirm where used). */
export function ConfirmDialog({ open, onClose, onConfirm, title = "Are you sure?", description, confirmLabel = "Delete", danger = true }: { open: boolean; onClose: () => void; onConfirm: () => Promise<unknown> | void; title?: ReactNode; description?: ReactNode; confirmLabel?: string; danger?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {description && <p className="mb-4 text-sm muted">{description}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
/** Hook-style helper for the common "click → confirm → run" flow. */
export function useConfirm() {
  const [state, setState] = useState<{ title?: ReactNode; description?: ReactNode; confirmLabel?: string; run: () => Promise<unknown> | void } | null>(null);
  const confirm = (run: () => Promise<unknown> | void, opts: { title?: ReactNode; description?: ReactNode; confirmLabel?: string } = {}) => setState({ ...opts, run });
  const dialog = <ConfirmDialog open={!!state} onClose={() => setState(null)} onConfirm={() => state?.run()} title={state?.title} description={state?.description} confirmLabel={state?.confirmLabel} />;
  return { confirm, dialog };
}
export function Tooltip({ label, children, side = "right" }: { label: string; children: ReactNode; side?: "right" | "top" | "bottom" }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span role="tooltip" className={cn("pointer-events-none absolute z-40 whitespace-nowrap rounded-md bg-fg px-2 py-1 text-[11px] font-medium text-bg opacity-0 shadow-md transition-all duration-150 group-hover/tt:opacity-100", side === "right" && "left-full top-1/2 ml-2 -translate-y-1/2 -translate-x-1 group-hover/tt:translate-x-0", side === "top" && "bottom-full left-1/2 mb-1.5 -translate-x-1/2 translate-y-1 group-hover/tt:translate-y-0", side === "bottom" && "top-full left-1/2 mt-1.5 -translate-x-1/2 -translate-y-1 group-hover/tt:translate-y-0")}>{label}</span>
    </span>
  );
}

/* ------------------------------------------------------------- Forms */
export function Field({ label, children, hint, error }: { label: ReactNode; children: ReactNode; hint?: ReactNode; error?: string | null }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <span className={cn("block", error && "[&>.field]:border-negative [&>.field]:ring-2 [&>.field]:ring-negative/15")}>{children}</span>
      {hint && !error && <span className="mt-1 block text-xs muted">{hint}</span>}
      <FieldError error={error} />
    </label>
  );
}
/** Error text that animates height + opacity instead of popping in (spec §9). */
export function FieldError({ error }: { error?: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {error && (
        <m.span key="err" className="block overflow-hidden text-xs text-negative" initial={{ height: 0, opacity: 0, y: -2 }} animate={{ height: "auto", opacity: 1, y: 0 }} exit={{ height: 0, opacity: 0, y: -2 }} transition={T.state}>
          <span className="block pt-1">{error}</span>
        </m.span>
      )}
    </AnimatePresence>
  );
}
/** Satisfying checkbox: the check mark draws itself (spec §12). */
export function Checkbox({ checked, onChange, label, size = 18 }: { checked: boolean; onChange: (v: boolean) => void; label?: string; size?: number }) {
  const reduced = useReducedMotion();
  return (
    <m.button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={(e) => { e.stopPropagation(); onChange(!checked); }} whileTap={{ scale: 0.9 }} transition={T.state}
      className={cn("flex shrink-0 items-center justify-center rounded-md border transition-colors duration-150", checked ? "border-positive bg-positive text-white" : "border-border bg-surface hover:border-fg/40")} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size - 6} height={size - 6} fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
        <m.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={reduced ? { duration: 0 } : { duration: 0.22, ease: T.enter.ease }} />
      </svg>
    </m.button>
  );
}
export function Confirm({ message, onConfirm, children, className = "btn-ghost btn-sm" }: { message: string; onConfirm: () => void; children: ReactNode; className?: string }) {
  return <button className={className} onClick={() => { if (confirm(message)) onConfirm(); }}>{children}</button>;
}

/* ---------------------------------------------------------- Markdown */
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
  let last = 0, mt: RegExpExecArray | null;
  while ((mt = re.exec(s))) {
    if (mt.index > last) parts.push(s.slice(last, mt.index));
    const t = mt[0];
    if (t.startsWith("**")) parts.push(<strong key={mt.index}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) parts.push(<code key={mt.index}>{t.slice(1, -1)}</code>);
    else { const mm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!; parts.push(<a key={mt.index} href={mm[2]} target="_blank" rel="noreferrer" className="link">{mm[1]}</a>); }
    last = mt.index + t.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
