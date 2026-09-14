"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Markdown } from "@/components/ui";
import { api } from "@/lib/client";
import { useShell } from "./Shell";
import { ActionList, type Action } from "@/components/ai/ActionList";

/** Global quick entry (spec §30): one sentence → the AI creates the right record via tools. */
export function QuickEntry({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { aiConfigured } = useShell();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; actions: Action[]; pending: Action[] } | null>(null);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!text.trim()) return;
    setBusy(true); setError(""); setResult(null);
    try { const r = await api<{ text: string; actions: Action[]; pending: Action[] }>("/api/ai/quick", { method: "POST", json: { text } }); setResult(r); setText(""); router.refresh(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={() => { onClose(); setResult(null); setError(""); }} title="Quick entry">
      {!aiConfigured && <p className="mb-3 rounded-xl bg-warning/10 p-3 text-sm">The AI is not configured (ANTHROPIC_API_KEY). You can still add records manually in each module.</p>}
      <form onSubmit={submit}>
        <textarea className="field" rows={3} autoFocus placeholder={"Spent €12 on lunch · Finished today's workout · Studied German 45 min · Remind me tomorrow to review Velsoma"} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e); } }} />
        <div className="mt-2 flex justify-end"><button className="btn-primary" disabled={busy || !text.trim() || !aiConfigured}>{busy ? "Saving…" : "Save"}</button></div>
      </form>
      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
      {result && <div className="mt-3 space-y-2"><Markdown text={result.text} /><ActionList actions={result.actions} pending={result.pending} onChanged={() => router.refresh()} /></div>}
    </Modal>
  );
}
