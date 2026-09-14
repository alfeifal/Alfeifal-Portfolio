"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Tabs, Source } from "@/components/ui";
import { api, fmtDate, todayLocal, useApi } from "@/lib/client";
import type { Task, Project, Goal } from "@/lib/types";

type View = "today" | "upcoming" | "overdue" | "inbox" | "completed";
const empty = { title: "", description: "", priority: "medium", category: "", dueDate: "", dueTime: "", projectId: "", goalId: "", recurrence: "", estimatedMinutes: "" };

function TasksInner() {
  const sp = useSearchParams();
  const [view, setView] = useState<View>((sp.get("view") as View) || "today");
  const tasks = useApi<Task[]>(`/api/tasks?view=${view}`, [view]);
  const projects = useApi<Project[]>("/api/projects");
  const goals = useApi<Goal[]>("/api/goals?status=active");
  const [editing, setEditing] = useState<Partial<Task> | null>(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const openNew = () => { setForm({ ...empty, dueDate: view === "upcoming" ? "" : view === "inbox" ? "" : todayLocal() }); setEditing({}); };
  const openEdit = (t: Task) => { setForm({ title: t.title, description: t.description ?? "", priority: t.priority, category: t.category ?? "", dueDate: t.dueDate ?? "", dueTime: t.dueTime ?? "", projectId: t.projectId ?? "", goalId: t.goalId ?? "", recurrence: t.recurrence ?? "", estimatedMinutes: t.estimatedMinutes?.toString() ?? "" }); setEditing(t); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    const body = { title: form.title, description: form.description || null, priority: form.priority, category: form.category || null, dueDate: form.dueDate || null, dueTime: form.dueTime || null, projectId: form.projectId || null, goalId: form.goalId || null, recurrence: form.recurrence || null, estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null };
    try { if (editing?.id) await api(`/api/tasks/${editing.id}`, { method: "PATCH", json: body }); else await api("/api/tasks", { method: "POST", json: body }); setEditing(null); tasks.refresh(); } catch (err) { setError((err as Error).message); }
  };
  const complete = async (t: Task) => { tasks.setData((d) => (d ?? []).filter((x) => x.id !== t.id)); try { await api(`/api/tasks/${t.id}/complete`, { method: "POST" }); } finally { tasks.refresh(); } };
  const reopen = async (t: Task) => { await api(`/api/tasks/${t.id}`, { method: "PATCH", json: { status: "todo" } }); tasks.refresh(); };
  const remove = async (t: Task) => { if (!confirm(`Delete "${t.title}"?`)) return; await api(`/api/tasks/${t.id}`, { method: "DELETE" }); setEditing(null); tasks.refresh(); };
  const today = todayLocal();
  const tone = (p: string) => (p === "urgent" ? "negative" : p === "high" ? "warning" : "muted");
  return (
    <div>
      <PageHeader title="Tasks" subtitle="Today, upcoming, overdue and inbox. Recurring tasks re-spawn on completion." action={<button className="btn-primary" onClick={openNew}>+ Task</button>} />
      <Tabs value={view} onChange={setView} options={[{ value: "today", label: "Today" }, { value: "upcoming", label: "Upcoming" }, { value: "overdue", label: "Overdue" }, { value: "inbox", label: "Inbox" }, { value: "completed", label: "Completed" }]} />
      <div className="mt-3">
        {tasks.error ? <ErrorBox error={tasks.error} retry={tasks.reload} /> : tasks.loading && !tasks.data ? <Spinner /> : !tasks.data?.length ? <Empty>Nothing here. {view !== "completed" && <button className="link" onClick={openNew}>Add a task</button>}</Empty> : (
          <ul className="card divide-y divide-border">
            {tasks.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                {t.status === "done" ? <button onClick={() => reopen(t)} className="h-5 w-5 shrink-0 rounded border border-positive bg-positive/20 text-[11px] text-positive" aria-label="Reopen">✓</button> : <button onClick={() => complete(t)} className="h-5 w-5 shrink-0 rounded border border-border hover:bg-positive/20" aria-label="Complete" />}
                <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(t)}>
                  <p className={"truncate text-sm font-medium" + (t.status === "done" ? " line-through muted" : "")}>{t.title}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs muted">
                    {t.dueDate && <span className={t.dueDate < today && t.status !== "done" ? "text-negative" : ""}>{fmtDate(t.dueDate)}{t.dueTime ? " " + t.dueTime : ""}</span>}
                    {t.category && <span>· {t.category}</span>}
                    {t.recurrence && <span>· ↻ {t.recurrence}</span>}
                    {t.projectId && projects.data && <span>· {projects.data.find((p) => p.id === t.projectId)?.name}</span>}
                    <Source source={t.source === "ai" ? "ai" : null} />
                  </p>
                </button>
                {t.priority !== "medium" && <Badge tone={tone(t.priority)}>{t.priority}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit task" : "New task"}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Title"><input className="field" required autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Due date"><input className="field" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
            <Field label="Time"><input className="field" type="time" value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} /></Field>
            <Field label="Priority"><select className="field" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{["low", "medium", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</select></Field>
            <Field label="Category"><input className="field" list="cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /><datalist id="cats">{["work", "study", "german", "training", "finance", "personal", "project", "trading"].map((c) => <option key={c} value={c} />)}</datalist></Field>
            <Field label="Project"><select className="field" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">—</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Goal"><select className="field" value={form.goalId} onChange={(e) => setForm({ ...form, goalId: e.target.value })}><option value="">—</option>{goals.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
            <Field label="Recurrence" hint="daily · weekdays · weekly · weekly:MO,WE · monthly:15"><input className="field" value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })} /></Field>
            <Field label="Estimate (min)"><input className="field" type="number" min={1} value={form.estimatedMinutes} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })} /></Field>
          </div>
          <Field label="Description"><textarea className="field" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-between">{editing?.id ? <button type="button" className="btn-ghost text-negative" onClick={() => remove(editing as Task)}>Delete</button> : <span />}<button className="btn-primary">Save</button></div>
        </form>
      </Modal>
    </div>
  );
}
export default function TasksPage() { return <Suspense><TasksInner /></Suspense>; }
