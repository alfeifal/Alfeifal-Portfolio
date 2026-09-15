"use client";
import { useRef, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Modal, Markdown, Button } from "@/components/ui";
import { useShell } from "./Shell";
import { useToast } from "@/components/toast";
import { ActionList, type Action } from "@/components/ai/ActionList";
import { streamChat } from "@/lib/ai-stream";
import { invalidateModules, modulesOf } from "@/lib/invalidate";
import type { TurnOutcome } from "@/server/ai/stream";

const EXAMPLES = ["Spent €12 on lunch", "Finished today's workout", "Studied German 45 min", "Remind me tomorrow to review Velsoma"];

const toolLabel = (t: string) => t.replace(/_/g, " ");
const cleanSummary = (a: Action) => a.summary?.replace(new RegExp("^" + a.tool + " — "), "") ?? toolLabel(a.tool);

/** Global quick entry (spec §30): one sentence → the AI creates the right record via tools. */
export function QuickEntry({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { aiConfigured } = useShell();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [tool, setTool] = useState<string | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [pending, setPending] = useState<Action[]>([]);
  const [outcome, setOutcome] = useState<TurnOutcome | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  const reset = () => { setReply(""); setActions([]); setPending([]); setOutcome(null); setError(""); setTool(null); };

  /**
   * Reports the turn from its action statuses, never from the assistant's prose: if any tool failed
   * this says so, and a turn with one success and one failure is announced as partial — never as done.
   */
  const announce = (r: { outcome: TurnOutcome; actions: Action[]; pending: Action[] }) => {
    const ok = r.actions.filter((a) => a.status === "success" || a.status === "confirmed");
    const failed = r.actions.filter((a) => a.status === "failed");
    const detail = (list: Action[]) => list.map(cleanSummary).filter(Boolean).join(" · ");
    if (r.outcome === "partial") toast.error(`Partly saved — ${failed.length} of ${r.actions.length} failed`, `Saved: ${detail(ok)}. Failed: ${failed.map((a) => `${toolLabel(a.tool)} (${a.error ?? "error"})`).join(" · ")}`);
    else if (r.outcome === "failed") toast.error(failed.length === 1 ? "Nothing was saved" : `Nothing was saved — ${failed.length} actions failed`, failed.map((a) => a.error).filter(Boolean).join(" · ") || "The action failed.");
    else if (r.outcome === "pending") toast.info("Needs your confirmation", "Review the action card below.");
    else if (r.outcome === "ok") toast.success(ok.length === 1 ? cleanSummary(ok[0]) : `${ok.length} records saved`, ok.length === 1 ? undefined : detail(ok));
    else toast.info("Nothing to save", "No record was created for that.");
  };

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim() || busy) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const sent = text;
    setBusy(true); reset();
    try {
      const r = await streamChat({ text: sent, mode: "quick", signal: controller.signal }, {
        onText: (d) => setReply((s) => s + d),
        onTool: (name) => setTool(name),
        onAction: (a) => { setActions((s) => [...s, a]); setTool(null); },
        onPending: (a) => { setPending((s) => [...s, a]); setTool(null); },
      });
      setText(""); setOutcome(r.outcome); setTool(null);
      if (r.error) { setError(r.error); toast.error("Quick entry failed", r.error); return; }
      announce(r);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      toast.error("Quick entry failed", (err as Error).message);
    } finally { setBusy(false); }
  };

  const close = () => { abort.current?.abort(); onClose(); reset(); };

  return (
    <Modal open={open} onClose={close} title={<span className="inline-flex items-center gap-2"><Sparkles size={16} />Quick entry</span>}>
      {!aiConfigured && <p className="mb-3 rounded-xl bg-warning/10 p-3 text-sm">The AI is not configured (ANTHROPIC_API_KEY). You can still add records manually in each module.</p>}
      <form onSubmit={submit}>
        <textarea className="field" rows={3} autoFocus placeholder="Say what happened…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <div className="mt-2 flex flex-wrap gap-1.5">{EXAMPLES.map((x) => <button type="button" key={x} className="pill transition-colors hover:bg-border" onClick={() => setText(x)}>{x}</button>)}</div>
        <div className="mt-3 flex justify-end"><Button variant="primary" type="submit" loading={busy} loadingText="Saving" disabled={!text.trim() || !aiConfigured}>Save</Button></div>
      </form>
      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
      {(reply || tool || actions.length || pending.length) && (
        <div className="mt-3 space-y-2">
          {reply && <Markdown text={reply} />}
          {tool && <p className="flex items-center gap-2 text-xs muted"><Loader2 size={13} className="animate-spin" />{toolLabel(tool)}…</p>}
          <ActionList
            actions={actions}
            pending={pending}
            onChanged={(a) => {
              // A confirmation executes the action now, so its module has to be refetched now too.
              setPending((s) => s.map((p) => (p.logId === a.logId ? a : p)));
              invalidateModules(modulesOf([a]));
            }}
          />
          {outcome === "partial" && <p className="text-xs text-negative">Some actions failed — only the ones marked with a check were saved.</p>}
        </div>
      )}
    </Modal>
  );
}
