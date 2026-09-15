"use client";
import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, m } from "motion/react";
import { Calendar, CheckSquare, StickyNote, Check, X, AlertCircle } from "lucide-react";
import { Badge, Button, Markdown, Checkbox } from "@/components/ui";
import { T, V } from "@/components/motion";
import { api, fmtDate, fmtTime } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { Plan, PlanItem, PlanAcceptResult } from "@/lib/types";

const KIND_ICON = { task: CheckSquare, event: Calendar, note: StickyNote } as const;
const STATUS_TONE: Record<string, "positive" | "warning" | "negative" | "muted"> = {
  accepted: "positive", partially_accepted: "warning", draft: "warning", rejected: "negative", superseded: "muted",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "waiting for you", accepted: "accepted", partially_accepted: "partly accepted", rejected: "rejected", superseded: "superseded",
};

const when = (i: PlanItem) => {
  if (i.startAt) return i.allDay ? `${fmtDate(i.startAt)} · all day` : `${fmtDate(i.startAt)} · ${fmtTime(i.startAt)}${i.endAt ? `–${fmtTime(i.endAt)}` : ""}`;
  if (i.date) return fmtDate(i.date);
  return null;
};
const becomes = (i: PlanItem) => (i.kind === "task" ? "will become a task" : i.kind === "event" ? "will become a calendar event" : "advice only — nothing is created");

/**
 * One persisted plan: what the assistant proposed, what is still waiting for the user, and what has
 * actually become a task or an event. Accepting and rejecting go through the existing planner routes;
 * the assistant has no way to do either. Failures are shown exactly as the server reported them.
 */
export function PlanCard({ plan, onChanged }: { plan: Plan; onChanged?: () => void }) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [results, setResults] = useState<PlanAcceptResult[]>([]);
  const [error, setError] = useState("");

  const pending = plan.items.filter((i) => i.status === "proposed");
  const chosen = pending.filter((i) => selected[i.id]);
  const closed = plan.status === "rejected" || plan.status === "superseded";

  const accept = async (itemIds?: string[]) => {
    setBusy("accept"); setError(""); setResults([]);
    try {
      const r = await api<{ results: PlanAcceptResult[] }>(`/api/planner/${plan.id}/accept`, { method: "POST", json: itemIds?.length ? { itemIds } : {} });
      setResults(r.results);
      setSelected({});
      onChanged?.();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const reject = async () => {
    setBusy("reject"); setError("");
    try { await api(`/api/planner/${plan.id}/reject`, { method: "POST" }); onChanged?.(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div className="card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">{plan.title ?? (plan.horizon === "week" ? "Week plan" : "Plan for the day")}</span>
        <Badge tone={STATUS_TONE[plan.status]}>{STATUS_LABEL[plan.status] ?? plan.status}</Badge>
        <span className="text-xs muted">{plan.periodKey}</span>
        {pending.length > 0 && !closed && <span className="text-xs muted">· {pending.length} item{pending.length === 1 ? "" : "s"} pending your acceptance</span>}
      </div>
      {plan.content && <div className="mb-2 text-sm"><Markdown text={plan.content} /></div>}

      <ul className="divide-y divide-border">
        {plan.items.map((i) => {
          const Icon = KIND_ICON[i.kind];
          const materialised = Boolean(i.createdTaskId || i.createdEventId);
          const selectable = i.status === "proposed" && !closed;
          return (
            <li key={i.id} className="flex items-start gap-2 py-2 text-sm">
              {selectable ? (
                <Checkbox checked={Boolean(selected[i.id])} onChange={() => setSelected((s) => ({ ...s, [i.id]: !s[i.id] }))} />
              ) : (
                <span className={cn("mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full", i.status === "accepted" ? "bg-positive text-white" : "bg-surface-2 muted")}>
                  {i.status === "accepted" ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5"><Icon size={13} className="shrink-0 muted" /><span className="truncate">{i.title}</span></p>
                <p className="text-xs muted">
                  {when(i) ? <>{when(i)} · </> : null}
                  {materialised ? (
                    i.createdTaskId
                      ? <>created as a task · <Link className="link" href="/tasks">open tasks</Link></>
                      : <>created as a calendar event · <Link className="link" href="/calendar">open calendar</Link></>
                  ) : i.status === "accepted" ? "accepted" : i.status === "rejected" ? "rejected" : becomes(i)}
                </p>
                {i.notes && <p className="mt-0.5 text-xs muted">{i.notes}</p>}
              </div>
            </li>
          );
        })}
        {plan.items.length === 0 && <li className="py-2 text-sm muted">This plan has no items.</li>}
      </ul>

      <AnimatePresence initial={false}>
        {results.length > 0 && (
          <m.ul variants={V.riseSm} initial="hidden" animate="visible" transition={T.enter} className="mt-2 space-y-1">
            {results.map((r) => (
              <li key={r.itemId} className={cn("rounded-lg px-2 py-1.5 text-xs", r.status === "failed" ? "bg-negative/10 text-negative" : "bg-surface-2/60")}>
                {r.status === "failed" ? <span className="flex items-start gap-1.5"><AlertCircle size={12} className="mt-0.5 shrink-0" /><span><strong>{r.title}</strong> was NOT created: {r.error}</span></span>
                  : r.status === "created" ? <span><strong>{r.title}</strong> created</span>
                  : r.status === "already_created" ? <span><strong>{r.title}</strong> already existed — nothing duplicated</span>
                  : <span><strong>{r.title}</strong> skipped</span>}
              </li>
            ))}
          </m.ul>
        )}
      </AnimatePresence>
      {error && <p className="mt-2 text-sm text-negative">{error}</p>}

      {!closed && pending.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={busy === "accept"} onClick={() => accept(chosen.length ? chosen.map((i) => i.id) : undefined)}>
            {chosen.length ? `Accept ${chosen.length} selected` : "Accept plan"}
          </Button>
          <Button size="sm" disabled={busy !== null} onClick={reject}>Reject</Button>
          <span className="self-center text-xs muted">Nothing is created until you accept.</span>
        </div>
      )}
    </div>
  );
}
