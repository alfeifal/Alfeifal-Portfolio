"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, m } from "motion/react";
import { Sparkles, History, Plus, Wallet, CheckSquare, Dumbbell, GraduationCap, CalendarPlus, BookOpen, Loader2 } from "lucide-react";
import { Markdown, Modal, Button } from "@/components/ui";
import { T, V } from "@/components/motion";
import { api, useApi } from "@/lib/client";
import type { TurnOutcome } from "@/server/ai/stream";
import { streamChat } from "@/lib/ai-stream";
import { invalidateModules, modulesOf } from "@/lib/invalidate";
import { useShell } from "@/components/shell/Shell";
import { ActionList, type Action } from "@/components/ai/ActionList";

interface Msg { id: string; role: "user" | "assistant"; text: string; actions?: Action[]; pending?: Action[]; streaming?: boolean; interrupted?: boolean; outcome?: TurnOutcome; tool?: string }
interface Conversation { id: string; title: string; kind: string; updatedAt: string; expiresAt: string }
interface Transcript { id: string; title: string; expiresAt: string; messages: { id: string; role: string; text: string }[] }

/**
 * Pointer to the chat this browser had open. The transcript itself lives on the server and expires
 * 24 h after the last message; this is only a hint, always validated before use (an unknown or expired
 * id falls back to the most recent living conversation, or to a fresh one).
 */
const POINTER_KEY = "pos.assistant.conversation";
const readPointer = () => { try { return localStorage.getItem(POINTER_KEY); } catch { return null; } };
const writePointer = (id: string | null) => { try { if (id) localStorage.setItem(POINTER_KEY, id); else localStorage.removeItem(POINTER_KEY); } catch { /* private mode: the session simply does not survive a reload */ } };

const SUGGESTIONS = ["What should I prioritize today?", "I spent €18 on dinner", "Tomorrow I work 10 to 18. Put gym after work and German after dinner", "What did I bench last time?", "How much German did I study this week?", "Summarize my week"];
const QUICK = [
  { label: "Expense", icon: Wallet, text: "I spent " },
  { label: "Task", icon: CheckSquare, text: "Create a task: " },
  { label: "Workout", icon: Dumbbell, text: "Log my workout: " },
  { label: "Study", icon: GraduationCap, text: "I studied " },
  { label: "Event", icon: CalendarPlus, text: "Add to my calendar: " },
  { label: "Journal", icon: BookOpen, text: "Journal entry: " },
];
const STATUS = ["Thinking…", "Looking at your data…", "Working on it…"];

function Assistant() {
  const { aiConfigured } = useShell();
  const sp = useSearchParams();
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(0);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const convs = useApi<Conversation[]>("/api/ai/conversations");
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sent = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const sendSeq = useRef(0);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;
  const [restoring, setRestoring] = useState(true);
  // On mount: resume the conversation this browser was in, or the latest one still inside its 24 h window.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // A search result can point at a specific living conversation; it wins over the stored pointer.
        const pointer = new URLSearchParams(window.location.search).get("conversation") ?? readPointer();
        const r = await api<{ conversation: Transcript | null }>(`/api/ai/conversations/active${pointer ? `?id=${encodeURIComponent(pointer)}` : ""}`);
        if (cancelled) return;
        if (r.conversation) {
          setConversationId(r.conversation.id);
          setMsgs(r.conversation.messages.filter((mm) => mm.role === "user" || mm.role === "assistant").map((mm) => ({ id: mm.id, role: mm.role as "user", text: mm.text })));
          writePointer(r.conversation.id);
        } else writePointer(null);
      } catch { /* resuming is best effort: on failure the user simply starts a new chat */ }
      finally { if (!cancelled) setRestoring(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);
  useEffect(() => { const q = sp.get("q"); if (q && !sent.current) { sent.current = true; send(q); router.replace("/assistant"); } }, [sp]);
  useEffect(() => { if (!busy) { setStatus(0); return; } const t = setInterval(() => setStatus((s) => Math.min(STATUS.length - 1, s + 1)), 2200); return () => clearInterval(t); }, [busy]);

  /**
   * Sends a message and renders the answer as it is generated. One request at a time (guarded by
   * `busy`), one abort controller, and a sequence number so a stream that is still finishing can never
   * write into a newer exchange.
   */
  async function send(text: string) {
    if (!text.trim() || busy) return;
    const seq = ++sendSeq.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const assistantId = crypto.randomUUID();
    setMsgs((mm) => [...mm, { id: crypto.randomUUID(), role: "user", text }, { id: assistantId, role: "assistant", text: "", streaming: true }]);
    setInput(""); setBusy(true); setError("");
    const patch = (fn: (m: Msg) => Msg) => { if (seq === sendSeq.current) setMsgs((mm) => mm.map((m) => (m.id === assistantId ? fn(m) : m))); };
    try {
      const r = await streamChat({ text, conversationId, signal: controller.signal }, {
        onStart: (id) => { if (seq === sendSeq.current) { setConversationId(id); writePointer(id); } },
        onText: (delta) => patch((m) => ({ ...m, text: m.text + delta, tool: undefined })),
        // The tool's name reaches the UI before the work starts, so a slow round is never a frozen screen.
        onTool: (name) => patch((m) => ({ ...m, tool: name })),
        onAction: (a) => patch((m) => ({ ...m, actions: [...(m.actions ?? []), a], tool: undefined })),
        onPending: (a) => patch((m) => ({ ...m, pending: [...(m.pending ?? []), a], tool: undefined })),
      });
      if (seq !== sendSeq.current) return;
      if (r.error) {
        const hadText = Boolean(msgsRef.current.find((m) => m.id === assistantId)?.text);
        if (hadText) patch((m) => ({ ...m, streaming: false, interrupted: true, tool: undefined }));
        else { setMsgs((mm) => mm.filter((m) => m.id !== assistantId)); setError(r.error); }
      } else {
        patch((m) => ({ ...m, streaming: false, interrupted: r.interrupted, outcome: r.outcome, tool: undefined }));
      }
      convs.refresh();
    } catch (e) {
      if ((e as Error).name === "AbortError") { patch((m) => ({ ...m, streaming: false, interrupted: true, tool: undefined })); return; }
      if (seq !== sendSeq.current) return;
      setMsgs((mm) => mm.filter((m) => m.id !== assistantId || m.text));
      patch((m) => ({ ...m, streaming: false, interrupted: Boolean(m.text), tool: undefined }));
      if (!msgsRef.current.find((m) => m.id === assistantId)?.text) setError((e as Error).message);
    } finally {
      if (seq === sendSeq.current) setBusy(false);
    }
  }

  async function open(id: string) {
    try {
      const c = await api<Transcript & { actions: Action[] }>(`/api/ai/conversations/${id}`);
      setConversationId(c.id);
      setMsgs(c.messages.filter((mm) => mm.role === "user" || mm.role === "assistant").map((mm) => ({ id: mm.id, role: mm.role as "user", text: mm.text })));
      writePointer(c.id);
      setError("");
    } catch (e) { setError((e as Error).message); convs.refresh(); }
    setShowHistory(false);
  }
  function startNew() { setConversationId(null); setMsgs([]); setError(""); writePointer(null); }
  const prefill = (t: string) => { setInput(t); inputRef.current?.focus(); };
  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100vh - 150px)" }}>
      <div className="mb-3 flex items-center justify-between">
        <div><h1 className="h1">Assistant</h1><p className="text-xs muted">Acts only through logged tools. <Link className="link" href="/settings#ai">Action log & memory</Link></p></div>
        <div className="flex gap-2"><Button size="sm" icon={<History size={14} />} onClick={() => setShowHistory(true)}>History</Button><Button size="sm" icon={<Plus size={14} />} onClick={startNew}>New</Button></div>
      </div>
      {!aiConfigured && <div className="card mb-3 border-warning/40 p-3 text-sm">The assistant needs <code>ANTHROPIC_API_KEY</code> on the server. Everything else in the app works without it.</div>}
      <div className="flex-1 space-y-3">
        {msgs.length === 0 && !restoring && (
          <m.div variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }} initial="hidden" animate="visible">
            <m.div variants={V.rise} className="card mb-3 flex items-center gap-3 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-fg"><Sparkles size={16} /></span><div><p className="text-sm font-medium">Talk to your Personal OS</p><p className="text-xs muted">Log things, ask about your data, plan your day. Actions run through controlled tools and show up below each answer.</p></div></m.div>
            <div className="grid gap-2 sm:grid-cols-2">{SUGGESTIONS.map((s) => <m.button key={s} variants={V.rise} whileTap={{ scale: 0.98 }} className="card card-interactive p-3 text-left text-sm" onClick={() => send(s)} disabled={!aiConfigured}>{s}</m.button>)}</div>
          </m.div>
        )}
        <AnimatePresence initial={false}>
          {msgs.map((mm) => (
            <m.div key={mm.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={T.enter} className={mm.role === "user" ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-accent-fg whitespace-pre-wrap" : "max-w-[95%] space-y-2 rounded-2xl rounded-bl-md card px-4 py-3"}>
              {mm.role === "user" ? mm.text : mm.text ? <Markdown text={mm.text} /> : mm.streaming ? (
                <span className="flex items-center gap-2.5 text-sm muted"><span className="flex items-center gap-0.5"><span className="dot" /><span className="dot" /><span className="dot" /></span>{STATUS[status]}</span>
              ) : <p className="text-sm muted">Done — see the actions below.</p>}
              {mm.tool && <p className="flex items-center gap-2 text-xs muted"><Loader2 size={13} className="animate-spin" />{mm.tool.replace(/_/g, " ")}…</p>}
              {mm.interrupted && <p className="text-xs text-warning">The answer was interrupted — what you see above is what arrived.</p>}
              {mm.role === "assistant" && <ActionList actions={mm.actions ?? []} pending={mm.pending ?? []} onChanged={(a) => invalidateModules(modulesOf([a]))} />}
              {mm.outcome === "partial" && <p className="text-xs text-negative">Some of those actions failed — only the ones marked with a check were saved.</p>}
              {mm.outcome === "failed" && <p className="text-xs text-negative">Nothing was saved: every action in this turn failed.</p>}
            </m.div>
          ))}
        </AnimatePresence>
        {error && <m.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-negative">{error}</m.p>}
        <div ref={bottom} />
      </div>
      <div className="sticky bottom-20 mt-3 md:bottom-4">
        <div className="mb-1.5 flex gap-1.5 overflow-x-auto pb-1">{QUICK.map((q) => <m.button key={q.label} whileTap={{ scale: 0.95 }} transition={T.state} onClick={() => prefill(q.text)} className="btn-subtle btn-sm shrink-0 !rounded-full bg-surface"><q.icon size={12} />{q.label}</m.button>)}</div>
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="card flex items-end gap-2 p-2 shadow-lg shadow-black/5 transition-[border-color] focus-within:border-fg/30">
          <textarea ref={inputRef} rows={2} className="field !border-0 !ring-0 resize-none !bg-transparent" placeholder="Talk to your Personal OS…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} disabled={!aiConfigured} />
          <Button variant="primary" type="submit" loading={busy} disabled={!input.trim() || !aiConfigured}>Send</Button>
        </form>
      </div>
      <Modal open={showHistory} onClose={() => setShowHistory(false)} title="Conversations">
        <p className="mb-2 text-xs muted">Chats are kept for 24 hours after your last message, then deleted. What the assistant did (action log), its memory and your data are kept.</p>
        {convs.data?.length ? <ul className="divide-y divide-border">{convs.data.map((c) => <li key={c.id} className="row -mx-2 flex items-center gap-2 rounded-lg px-2 py-2 text-sm"><button className="min-w-0 flex-1 truncate text-left" onClick={() => open(c.id)}>{c.title}</button><span className="pill">{c.kind}</span><button className="btn-ghost btn-sm" onClick={async () => { await api(`/api/ai/conversations/${c.id}`, { method: "DELETE" }); if (c.id === conversationId) startNew(); convs.refresh(); }}>✕</button></li>)}</ul> : <p className="text-sm muted">No conversations yet. Ask anything above — transcripts are kept for 24 hours, what the assistant does is kept for good.</p>}
      </Modal>
    </div>
  );
}
export default function AssistantPage() { return <Suspense><Assistant /></Suspense>; }
