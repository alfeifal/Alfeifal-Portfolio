"use client";
import { useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { Check, ChevronDown, X, Clock, AlertCircle } from "lucide-react";
import { api } from "@/lib/client";
import { Badge, Button } from "@/components/ui";
import { T, V } from "@/components/motion";
import { cn } from "@/lib/utils";

export interface Action { logId: string; tool: string; risk: string; status: string; summary: string | null; params?: unknown; result?: unknown; error?: string | null }

const label = (tool: string) => tool.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Executed / failed / pending AI actions as compact cards; pending ones can be confirmed or rejected (spec §9, §16). */
export function ActionList({ actions, pending, onChanged }: { actions: Action[]; pending: Action[]; onChanged?: (a: Action) => void }) {
  const [state, setState] = useState<Record<string, Action>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const decide = async (a: Action, ok: boolean) => {
    setBusy(a.logId);
    try {
      if (ok) { const r = await api<Action>(`/api/ai/actions/${a.logId}/confirm`, { method: "POST" }); setState((s) => ({ ...s, [a.logId]: r })); onChanged?.(r); }
      else { await api(`/api/ai/actions/${a.logId}/reject`, { method: "POST" }); setState((s) => ({ ...s, [a.logId]: { ...a, status: "rejected" } })); }
    } catch (e) { setState((s) => ({ ...s, [a.logId]: { ...a, status: "failed", error: (e as Error).message } })); } finally { setBusy(null); }
  };
  if (!actions.length && !pending.length) return null;
  return (
    <m.div className="space-y-1.5" initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}>
      {actions.map((a) => {
        const ok = a.status !== "failed";
        const detail = a.summary?.replace(a.tool + " — ", "") ?? "";
        return (
          <m.div key={a.logId} variants={V.riseSm} transition={T.enter} className={cn("rounded-xl border px-3 py-2 text-xs", ok ? "border-border bg-surface-2/60" : "border-negative/40 bg-negative/5")}>
            <button className="flex w-full items-center gap-2 text-left" onClick={() => a.result != null && setOpen((o) => ({ ...o, [a.logId]: !o[a.logId] }))}>
              <span className={cn("flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full", ok ? "bg-positive text-white" : "bg-negative text-white")}>{ok ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}</span>
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{label(a.tool)}</span>{detail && detail !== a.tool && <span className="muted"> · {detail}</span>}{a.error && <span className="text-negative"> · {a.error}</span>}</span>
              {a.result != null && <ChevronDown size={13} className={cn("muted transition-transform", open[a.logId] && "rotate-180")} />}
            </button>
            <AnimatePresence initial={false}>{open[a.logId] && <m.pre initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={T.state} className="mt-1 max-h-40 overflow-auto rounded-lg bg-surface p-2 text-[11px]">{JSON.stringify(a.result, null, 1)}</m.pre>}</AnimatePresence>
          </m.div>
        );
      })}
      {pending.map((p) => {
        const cur = state[p.logId] ?? p;
        const isPending = cur.status === "pending_confirmation";
        return (
          <m.div key={p.logId} variants={V.riseSm} transition={T.enter} className={cn("rounded-xl border px-3 py-2.5 text-xs", isPending ? "border-warning/50 bg-warning/10" : cur.status === "failed" || cur.status === "rejected" ? "border-negative/40 bg-negative/5" : "border-border bg-surface-2/60")}>
            <div className="flex items-center gap-2">
              <span className={cn("flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full", isPending ? "bg-warning text-white" : cur.status === "failed" || cur.status === "rejected" ? "bg-negative text-white" : "bg-positive text-white")}>{isPending ? <Clock size={11} /> : cur.status === "failed" ? <AlertCircle size={11} /> : cur.status === "rejected" ? <X size={11} strokeWidth={3} /> : <Check size={11} strokeWidth={3} />}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{cur.summary ?? label(cur.tool)}</span>
              <Badge tone={isPending ? "warning" : "muted"}>{isPending ? "needs confirmation" : cur.status.replace("_", " ")}</Badge>
            </div>
            {cur.params != null && isPending && <pre className="mt-1.5 max-h-32 overflow-auto rounded-lg bg-surface p-2 text-[11px]">{JSON.stringify(cur.params, null, 1)}</pre>}
            {cur.error && <p className="mt-1 text-negative">{cur.error}</p>}
            {isPending && <div className="mt-2 flex gap-2"><Button variant="primary" size="sm" loading={busy === p.logId} onClick={() => decide(p, true)}>Confirm</Button><Button size="sm" disabled={busy === p.logId} onClick={() => decide(p, false)}>Reject</Button><span className="ml-auto self-center muted">risk: {cur.risk}</span></div>}
          </m.div>
        );
      })}
    </m.div>
  );
}
