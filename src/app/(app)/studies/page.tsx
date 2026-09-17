"use client";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import Link from "next/link";
import { Badge, Bar, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Tabs, Button, SkeletonList, SkeletonCards, useConfirm, usePrompt } from "@/components/ui";
import { api, fmtDate, todayLocal, useApi } from "@/lib/client";
import { MiniBars } from "@/components/charts";
import { initialParam } from "@/lib/urlparam";

interface Subject { id: string; name: string; kind: string; slug: string | null; weeklyGoalMinutes: number | null; color: string | null }
interface Session { id: string; date: string; durationMinutes: number; topic: string | null; subjectName: string | null; source: string }
interface Progress { totalMinutes: number; bySubject: { subjectId: string | null; name: string; minutes: number; sessions: number; days: number; weeklyGoalMinutes: number | null }[]; daily: { date: string; minutes: number }[] }
interface Assignment { id: string; title: string; dueDate: string | null; subjectName: string | null; completedAt: string | null }
interface Exam { id: string; title: string; date: string; subjectName: string | null; result: string | null }

export default function StudiesPage() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { ask, dialog: promptDialog } = usePrompt();
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"overview" | "sessions" | "deadlines" | "subjects">(() => initialParam("tab", ["overview", "sessions", "deadlines", "subjects"] as const, "overview"));
  const subjects = useApi<Subject[]>("/api/studies/subjects");
  const sessions = useApi<Session[]>("/api/studies/sessions?limit=100");
  const progress = useApi<Progress>("/api/studies/progress");
  const week = useApi<Progress>(`/api/studies/progress?from=${(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); })()}`);
  const assignments = useApi<Assignment[]>("/api/studies/assignments");
  const exams = useApi<Exam[]>("/api/studies/exams?upcoming=1");
  const [modal, setModal] = useState<null | "session" | "subject" | "assignment" | "exam">(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const all = () => { subjects.refresh(); sessions.refresh(); progress.refresh(); week.refresh(); assignments.refresh(); exams.refresh(); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setSaving(true);
    try {
      if (modal === "session") await api("/api/studies/sessions", { method: "POST", json: { subjectId: form.subjectId || null, date: form.date, durationMinutes: Number(form.durationMinutes), topic: form.topic || null, notes: form.notes || null } });
      if (modal === "subject") await api("/api/studies/subjects", { method: "POST", json: { name: form.name, kind: form.kind || "subject", weeklyGoalMinutes: form.weeklyGoalMinutes ? Number(form.weeklyGoalMinutes) : null } });
      if (modal === "assignment") await api("/api/studies/assignments", { method: "POST", json: { subjectId: form.subjectId || null, title: form.title, dueDate: form.dueDate || null, description: form.description || null } });
      if (modal === "exam") await api("/api/studies/exams", { method: "POST", json: { subjectId: form.subjectId || null, title: form.title, date: form.date, notes: form.notes || null } });
      toast.success(modal === "session" ? "Study session logged" : modal === "subject" ? "Subject created" : modal === "assignment" ? "Assignment added" : "Exam added", modal === "session" ? `${form.durationMinutes} min${form.topic ? " · " + form.topic : ""}` : form.name ?? form.title);
      setModal(null); setForm({}); all();
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };
  const subjectSelect = <Field label="Subject"><select className="field" value={form.subjectId ?? ""} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}><option value="">—</option>{subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>;
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "session") { setForm({ date: todayLocal(), durationMinutes: "45" }); setModal("session"); } }, []);
  return (
    <div className="space-y-4">
      <PageHeader title="Studies" subtitle="Subjects, sessions, assignments, exams. German lessons are recorded here automatically." action={<button className="btn-primary btn-sm" onClick={() => { setForm({ date: todayLocal(), durationMinutes: "45" }); setModal("session"); }}>+ Session</button>} />
      <Tabs value={tab} onChange={setTab} options={[{ value: "overview", label: "Overview" }, { value: "sessions", label: "Sessions" }, { value: "deadlines", label: "Exams & assignments" }, { value: "subjects", label: "Subjects" }]} />
      {progress.error && <ErrorBox error={progress.error} retry={progress.reload} />}
      {tab === "overview" && (week.data && progress.data ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Card title="This week">
              <p className="text-2xl font-semibold tnum">{week.data.totalMinutes} min</p>
              <ul className="mt-2 space-y-2">{week.data.bySubject.map((s) => <li key={s.name}><div className="flex justify-between text-sm"><span>{s.name} <span className="muted">· {s.sessions} sessions · {s.days} days</span></span><span className="tnum">{s.minutes}{s.weeklyGoalMinutes ? ` / ${s.weeklyGoalMinutes}` : ""} min</span></div>{s.weeklyGoalMinutes ? <Bar value={s.minutes / s.weeklyGoalMinutes} tone="positive" h={4} /> : null}</li>)}{week.data.bySubject.length === 0 && <p className="text-sm muted">No sessions this week yet — log one and it counts towards the subject&apos;s weekly goal.</p>}</ul>
            </Card>
            <Card title="Last 28 days · minutes per day"><MiniBars series={progress.data.daily.map((d) => ({ label: d.date.slice(5), a: d.minutes }))} labels={["minutes"]} /></Card>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Card title="Upcoming exams">{!exams.data?.length ? <p className="text-sm muted">No exams registered. Ask the assistant: “I have an exam next Friday, organize my study sessions”.</p> : <ul className="space-y-1 text-sm">{exams.data.slice(0, 5).map((e) => <li key={e.id} className="flex justify-between"><span>{e.title} <span className="muted">· {e.subjectName}</span></span><span className="muted">{fmtDate(e.date)}</span></li>)}</ul>}</Card>
            <Card title="Open assignments">{!assignments.data?.length ? <p className="text-sm muted">Nothing pending.</p> : <ul className="space-y-1 text-sm">{assignments.data.slice(0, 5).map((a) => <li key={a.id} className="flex justify-between"><span>{a.title} <span className="muted">· {a.subjectName}</span></span><span className="muted">{a.dueDate ? fmtDate(a.dueDate) : "no date"}</span></li>)}</ul>}</Card>
          </div>
          <p className="text-xs muted">German: open the <Link href="/german" className="link">Deutsch module</Link> — every lesson, test and exam feeds these statistics.</p>
        </>
      ) : <><SkeletonCards n={2} /></>)}
      {tab === "sessions" && (!sessions.data ? <SkeletonList /> : sessions.data.length === 0 ? <Empty title="No study sessions yet" action={<Button variant="primary" size="sm" onClick={() => { setForm({ date: todayLocal(), durationMinutes: "45" }); setModal("session"); }}>Log a session</Button>}>German lessons are recorded here automatically; log other subjects manually.</Empty> : <ul className="card divide-y divide-border">{sessions.data.map((s) => <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="w-12 text-xs muted">{fmtDate(s.date)}</span><span className="flex-1">{s.subjectName ?? "—"}{s.topic && <span className="muted"> · {s.topic}</span>}{s.source === "import" && <Badge className="ml-1">auto</Badge>}</span><span className="tnum">{s.durationMinutes} min</span><button className="btn-ghost btn-sm" onClick={() => confirm(async () => { await api(`/api/studies/sessions/${s.id}`, { method: "DELETE" }); toast.success("Session deleted"); all(); }, { title: "Delete study session?" })}>✕</button></li>)}</ul>)}
      {tab === "deadlines" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card title="Exams" action={<button className="btn-primary btn-sm" onClick={() => { setForm({ date: todayLocal() }); setModal("exam"); }}>+ Exam</button>}>{!exams.data?.length ? <p className="text-sm muted">None upcoming.</p> : <ul className="divide-y divide-border text-sm">{exams.data.map((e) => <li key={e.id} className="flex items-center gap-2 py-1.5"><span className="flex-1">{e.title} <span className="muted">· {e.subjectName ?? "—"}</span></span><span className="muted">{fmtDate(e.date)}</span><button className="btn-ghost btn-sm" onClick={async () => { await api(`/api/studies/exams/${e.id}`, { method: "DELETE" }); all(); }}>✕</button></li>)}</ul>}</Card>
          <Card title="Assignments" action={<button className="btn-primary btn-sm" onClick={() => { setForm({}); setModal("assignment"); }}>+ Assignment</button>}>{!assignments.data?.length ? <p className="text-sm muted">None pending.</p> : <ul className="divide-y divide-border text-sm">{assignments.data.map((a) => <li key={a.id} className="flex items-center gap-2 py-1.5"><button className="h-4 w-4 rounded border border-border hover:bg-positive/20" onClick={async () => { await api(`/api/studies/assignments/${a.id}`, { method: "PATCH", json: { completed: true } }); all(); }} aria-label="Complete" /><span className="flex-1">{a.title} <span className="muted">· {a.subjectName ?? "—"}</span></span><span className="muted">{a.dueDate ? fmtDate(a.dueDate) : ""}</span></li>)}</ul>}</Card>
        </div>
      )}
      {tab === "subjects" && <Card title="Subjects" action={<button className="btn-primary btn-sm" onClick={() => { setForm({ kind: "subject" }); setModal("subject"); }}>+ Subject</button>}><ul className="divide-y divide-border text-sm">{subjects.data?.map((s) => <li key={s.id} className="flex items-center gap-2 py-1.5"><span className="flex-1">{s.name} <Badge>{s.kind}</Badge>{s.slug === "german" && <Badge tone="accent" className="ml-1">linked module</Badge>}</span><span className="muted">{s.weeklyGoalMinutes ? `${s.weeklyGoalMinutes} min/week` : ""}</span><button className="btn-ghost btn-sm" onClick={() => ask(async (v) => { await api(`/api/studies/subjects/${s.id}`, { method: "PATCH", json: { weeklyGoalMinutes: v ? Number(v) : null } }); all(); toast.success("Weekly goal updated", s.name); }, { title: `${s.name} weekly goal`, label: "Minutes per week", hint: "Leave it empty for no goal.", type: "number", step: "5", min: "0", initial: String(s.weeklyGoalMinutes ?? "") })}>goal</button>{s.slug !== "german" && <button className="btn-ghost btn-sm" onClick={() => confirm(async () => { await api(`/api/studies/subjects/${s.id}`, { method: "DELETE" }); toast.success("Subject deleted"); all(); }, { title: "Delete subject?", description: s.name })}>✕</button>}</li>)}</ul></Card>}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === "session" ? "Log study session" : modal === "subject" ? "New subject" : modal === "assignment" ? "New assignment" : "New exam"}>
        <form onSubmit={submit} className="space-y-3">
          {modal === "session" && <>{subjectSelect}<div className="grid grid-cols-2 gap-2"><Field label="Date"><input className="field" type="date" required value={form.date ?? ""} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field><Field label="Minutes"><input className="field" type="number" min={1} required value={form.durationMinutes ?? ""} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} /></Field></div><Field label="Topic"><input className="field" value={form.topic ?? ""} onChange={(e) => setForm({ ...form, topic: e.target.value })} /></Field></>}
          {modal === "subject" && <><Field label="Name"><input className="field" required autoFocus value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Kind"><select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{["subject", "course", "language", "certification"].map((k) => <option key={k}>{k}</option>)}</select></Field><Field label="Weekly goal (min)"><input className="field" type="number" value={form.weeklyGoalMinutes ?? ""} onChange={(e) => setForm({ ...form, weeklyGoalMinutes: e.target.value })} /></Field></div></>}
          {modal === "assignment" && <>{subjectSelect}<Field label="Title"><input className="field" required value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field><Field label="Due date"><input className="field" type="date" value={form.dueDate ?? ""} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field></>}
          {modal === "exam" && <>{subjectSelect}<Field label="Title"><input className="field" required value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field><Field label="Date"><input className="field" type="date" required value={form.date ?? ""} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field></>}
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end"><Button variant="primary" type="submit" loading={saving}>Save</Button></div>
        </form>
      </Modal>
      {dialog}
      {promptDialog}
    </div>
  );
}
