"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { Badge } from "@/components/ui";

export interface Action { logId: string; tool: string; risk: string; status: string; summary: string | null; params?: unknown; error?: string | null }

/** Shows executed / failed / pending AI actions; pending ones can be confirmed or rejected (spec §9). */
export function ActionList({ actions, pending, onChanged }: { actions: Action[]; pending: Action[]; onChanged?: (a: Action) => void }) {
  const [state, setState] = useState<Record<string, Action>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (a: Action, ok: boolean) => {
    setBusy(a.logId);
    try {
      if (ok) { const r = await api<Action>(`/api/ai/actions/${a.logId}/confirm`, { method: "POST" }); setState((s) => ({ ...s, [a.logId]: r })); onChanged?.(r); }
      else { await api(`/api/ai/actions/${a.logId}/reject`, { method: "POST" }); setState((s) => ({ ...s, [a.logId]: { ...a, status: "rejected" } })); }
    } catch (e) { setState((s) => ({ ...s, [a.logId]: { ...a, status: "failed", error: (e as Error).message } })); } finally { setBusy(null); }
  };
  if (!actions.length && !pending.length) return null;
  return (
    <div className="space-y-1.5">
      {actions.map((a) => (
        <div key={a.logId} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
          <Badge tone={a.status === "failed" ? "negative" : "positive"}>{a.status === "failed" ? "failed" : "done"}</Badge>
          <span className="min-w-0 flex-1 truncate"><code>{a.tool}</code>{a.summary && <span className="muted"> · {a.summary.replace(a.tool + " — ", "")}</span>}{a.error && <span className="text-negative"> · {a.error}</span>}</span>
        </div>
      ))}
      {pending.map((p) => {
        const cur = state[p.logId] ?? p;
        return (
          <div key={p.logId} className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <div className="flex items-center gap-2"><Badge tone={cur.status === "pending_confirmation" ? "warning" : cur.status === "failed" || cur.status === "rejected" ? "negative" : "positive"}>{cur.status.replace("_", " ")}</Badge><span className="flex-1 font-medium">{cur.summary ?? cur.tool}</span><span className="muted">risk: {cur.risk}</span></div>
            {cur.params != null && <pre className="mt-1 max-h-32 overflow-auto rounded bg-surface p-2 text-[11px]">{JSON.stringify(cur.params, null, 1)}</pre>}
            {cur.error && <p className="mt-1 text-negative">{cur.error}</p>}
            {cur.status === "pending_confirmation" && <div className="mt-2 flex gap-2"><button className="btn-primary btn-sm" disabled={busy === p.logId} onClick={() => decide(p, true)}>Confirm</button><button className="btn-ghost btn-sm" disabled={busy === p.logId} onClick={() => decide(p, false)}>Reject</button></div>}
          </div>
        );
      })}
    </div>
  );
}
