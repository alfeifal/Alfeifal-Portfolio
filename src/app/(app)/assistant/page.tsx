"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Markdown, Modal } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";
import { ActionList, type Action } from "@/components/ai/ActionList";

interface Msg { role: "user" | "assistant"; text: string; actions?: Action[]; pending?: Action[] }
interface Conversation { id: string; title: string; kind: string; updatedAt: string }

function Assistant() {
  const { aiConfigured } = useShell();
  const sp = useSearchParams();
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const convs = useApi<Conversation[]>("/api/ai/conversations");
  const bottom = useRef<HTMLDivElement>(null);
  const sent = useRef(false);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => { const q = sp.get("q"); if (q && !sent.current) { sent.current = true; send(q); router.replace("/assistant"); } }, [sp]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text }]); setInput(""); setBusy(true); setError("");
    try {
      const r = await api<{ conversationId: string; text: string; actions: Action[]; pending: Action[] }>("/api/ai/chat", { method: "POST", json: { conversationId, text } });
      setConversationId(r.conversationId);
      setMsgs((m) => [...m, { role: "assistant", text: r.text || "(no text — see actions)", actions: r.actions, pending: r.pending }]);
      convs.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function open(id: string) {
    const c = await api<{ id: string; messages: { role: string; text: string }[]; actions: Action[] }>(`/api/ai/conversations/${id}`);
    setConversationId(c.id);
    setMsgs(c.messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role as "user", text: m.text })));
    setShowHistory(false);
  }
  const suggestions = ["What should I prioritize today?", "I spent €18 on dinner", "Tomorrow I work 10 to 18. Put gym after work and German after dinner", "What did I bench last time?", "How much German did I study this week?", "Summarize my week"];
  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100vh - 150px)" }}>
      <div className="mb-2 flex items-center justify-between">
        <div><h1 className="h1">Assistant</h1><p className="text-xs muted">Acts only through logged tools. <Link className="link" href="/settings#ai">Action log & memory</Link></p></div>
        <div className="flex gap-2"><button className="btn-ghost btn-sm" onClick={() => setShowHistory(true)}>History</button><button className="btn-ghost btn-sm" onClick={() => { setConversationId(null); setMsgs([]); }}>New</button></div>
      </div>
      {!aiConfigured && <div className="card mb-3 border-warning/40 p-3 text-sm">The assistant needs <code>ANTHROPIC_API_KEY</code> on the server. Everything else in the app works without it.</div>}
      <div className="flex-1 space-y-3">
        {msgs.length === 0 && <div className="grid gap-2 sm:grid-cols-2">{suggestions.map((s) => <button key={s} className="card p-3 text-left text-sm hover:bg-surface-2" onClick={() => send(s)} disabled={!aiConfigured}>{s}</button>)}</div>}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-2xl bg-accent px-4 py-2.5 text-sm text-accent-fg whitespace-pre-wrap" : "max-w-[95%] space-y-2 rounded-2xl card px-4 py-3"}>
            {m.role === "user" ? m.text : <Markdown text={m.text} />}
            {m.role === "assistant" && <ActionList actions={m.actions ?? []} pending={m.pending ?? []} />}
          </div>
        ))}
        {busy && <div className="card w-fit px-4 py-2 text-sm muted">Thinking & acting…</div>}
        {error && <p className="text-sm text-negative">{error}</p>}
        <div ref={bottom} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="sticky bottom-20 mt-3 md:bottom-4">
        <div className="card flex items-end gap-2 p-2">
          <textarea rows={2} className="field !border-0 !ring-0 resize-none" placeholder="Talk to your Personal OS…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} disabled={!aiConfigured} />
          <button className="btn-primary" disabled={busy || !input.trim() || !aiConfigured}>Send</button>
        </div>
      </form>
      <Modal open={showHistory} onClose={() => setShowHistory(false)} title="Conversations">
        {convs.data?.length ? <ul className="divide-y divide-border">{convs.data.map((c) => <li key={c.id} className="flex items-center gap-2 py-2 text-sm"><button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => open(c.id)}>{c.title}</button><span className="pill">{c.kind}</span><button className="btn-ghost btn-sm" onClick={async () => { await api(`/api/ai/conversations/${c.id}`, { method: "DELETE" }); convs.refresh(); }}>✕</button></li>)}</ul> : <p className="text-sm muted">No conversations yet.</p>}
      </Modal>
    </div>
  );
}
export default function AssistantPage() { return <Suspense><Assistant /></Suspense>; }
