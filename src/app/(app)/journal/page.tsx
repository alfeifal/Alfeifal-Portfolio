"use client";
import { useState } from "react";
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Source } from "@/components/ui";
import { api, fmtDate, todayLocal, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";

interface Entry { id: string; date: string; title: string | null; content: string; kind: string; mood: number | null; tags: string[]; source: string }
const KINDS = ["entry", "note", "reflection", "event", "achievement", "problem", "idea"];
const MOODS = ["😞", "😕", "😐", "🙂", "😄"];

export default function JournalPage() {
  const { aiConfigured } = useShell();
  const entries = useApi<Entry[]>("/api/journal?limit=200");
  const [editing, setEditing] = useState<Partial<Entry> | null>(null);
  const [form, setForm] = useState({ date: todayLocal(), title: "", content: "", kind: "entry", mood: "", tags: "" });
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openNew = () => { setForm({ date: todayLocal(), title: "", content: "", kind: "entry", mood: "", tags: "" }); setEditing({}); };
  const openEdit = (e: Entry) => { setForm({ date: e.date, title: e.title ?? "", content: e.content, kind: e.kind, mood: e.mood?.toString() ?? "", tags: e.tags.join(", ") }); setEditing(e); };
  const save = async (e: React.FormEvent) => { e.preventDefault(); setError(""); const body = { date: form.date, title: form.title || null, content: form.content, kind: form.kind, mood: form.mood ? Number(form.mood) : null, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean) }; try { if (editing?.id) await api(`/api/journal/${editing.id}`, { method: "PATCH", json: body }); else await api("/api/journal", { method: "POST", json: body }); setEditing(null); entries.refresh(); } catch (err) { setError((err as Error).message); } };
  const summarize = async () => { setBusy(true); try { const r = await api<{ text: string }>("/api/ai/chat", { method: "POST", json: { text: "Read my journal entries from the last 30 days (get_journal_entries) and summarize the period: themes, mood trend, achievements, recurring problems, ideas worth pursuing. Do not create anything." } }); setSummary(r.text); } catch (e) { setSummary("Failed: " + (e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="space-y-3">
      <PageHeader title="Journal" subtitle="Daily entries, reflections, achievements, problems, ideas." action={<>{aiConfigured && <button className="btn-ghost btn-sm" disabled={busy} onClick={summarize}>{busy ? "Summarizing…" : "AI summary (30 days)"}</button>}<button className="btn-primary btn-sm" onClick={openNew}>+ Entry</button></>} />
      {summary && <div className="card p-3 text-sm"><Badge tone="accent" className="mb-1">AI summary</Badge><p className="whitespace-pre-wrap">{summary}</p></div>}
      {entries.error && <ErrorBox error={entries.error} retry={entries.reload} />}
      {entries.loading && !entries.data ? <Spinner /> : entries.data?.length === 0 ? <Empty>Write your first entry.</Empty> : (
        <ul className="space-y-2">{entries.data?.map((e) => <li key={e.id}><button className="card w-full p-3 text-left hover:bg-surface-2" onClick={() => openEdit(e)}><div className="flex items-center gap-2 text-xs muted"><span>{fmtDate(e.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span><Badge>{e.kind}</Badge>{e.mood && <span>{MOODS[e.mood - 1]}</span>}{e.tags.map((t) => <span key={t}>#{t}</span>)}<Source source={e.source === "ai" ? "ai" : null} /></div>{e.title && <p className="mt-1 font-medium">{e.title}</p>}<p className="mt-0.5 whitespace-pre-wrap text-sm line-clamp-4">{e.content}</p></button></li>)}</ul>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit entry" : "New entry"} wide>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Field label="Date"><input className="field" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field><Field label="Kind"><select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field><Field label="Mood"><select className="field" value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })}><option value="">—</option>{MOODS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select></Field><Field label="Tags"><input className="field" placeholder="a, b" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field></div>
          <Field label="Title (optional)"><input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Content"><textarea className="field" rows={10} required autoFocus value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-between">{editing?.id ? <button type="button" className="btn-ghost text-negative" onClick={async () => { if (confirm("Delete entry?")) { await api(`/api/journal/${editing.id}`, { method: "DELETE" }); setEditing(null); entries.refresh(); } }}>Delete</button> : <span />}<button className="btn-primary">Save</button></div>
        </form>
      </Modal>
    </div>
  );
}
