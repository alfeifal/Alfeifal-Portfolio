"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Modal, Markdown, Button } from "@/components/ui";
import { api } from "@/lib/client";
import { useShell } from "./Shell";
import { useToast } from "@/components/toast";
import { ActionList, type Action } from "@/components/ai/ActionList";

const EXAMPLES = ["Spent €12 on lunch", "Finished today's workout", "Studied German 45 min", "Remind me tomorrow to review Velsoma"];

/** Global quick entry (spec §30): one sentence → the AI creates the right record via tools. */
export function QuickEntry({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { aiConfigured } = useShell();
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; actions: Action[]; pending: Action[] } | null>(null);
  const [error, setError] = useState("");
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (!text.trim()) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const r = await api<{ text: string; actions: Action[]; pending: Action[] }>("/api/ai/quick", { method: "POST", json: { text } });
      setResult(r); setText("");
      const ok = r.actions.filter((a) => a.status !== "failed");
      if (ok.length && !r.pending.length) toast.success(ok.length === 1 ? (ok[0].summary?.split(" — ")[0]?.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) ?? "Saved") : `${ok.length} records saved`, ok.map((a) => a.summary?.replace(/^\w+ — /, "")).filter(Boolean).join(" · "));
      if (r.pending.length) toast.info("Needs your confirmation", "Review the action card below.");
      if (r.actions.some((a) => a.status === "failed")) toast.error("Some actions failed", "See details below.");
      router.refresh();
    } catch (err) { setError((err as Error).message); toast.error("Quick entry failed", (err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={() => { onClose(); setResult(null); setError(""); }} title={<span className="inline-flex items-center gap-2"><Sparkles size={16} />Quick entry</span>}>
      {!aiConfigured && <p className="mb-3 rounded-xl bg-warning/10 p-3 text-sm">The AI is not configured (ANTHROPIC_API_KEY). You can still add records manually in each module.</p>}
      <form onSubmit={submit}>
        <textarea className="field" rows={3} autoFocus placeholder="Say what happened…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <div className="mt-2 flex flex-wrap gap-1.5">{EXAMPLES.map((x) => <button type="button" key={x} className="pill transition-colors hover:bg-border" onClick={() => setText(x)}>{x}</button>)}</div>
        <div className="mt-3 flex justify-end"><Button variant="primary" type="submit" loading={busy} disabled={!text.trim() || !aiConfigured}>{busy ? "Saving" : "Save"}</Button></div>
      </form>
      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
      {result && <div className="mt-3 space-y-2"><Markdown text={result.text} /><ActionList actions={result.actions} pending={result.pending} onChanged={() => router.refresh()} /></div>}
    </Modal>
  );
}
