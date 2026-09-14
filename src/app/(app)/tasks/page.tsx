"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckSquare } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, SkeletonList, Tabs, Source, Checkbox, Button, useConfirm } from "@/components/ui";
import { T } from "@/components/motion";
import { useToast } from "@/components/toast";
import { api, fmtDate, todayLocal, useApi } from "@/lib/client";
import type { Task, Project, Goal } from "@/lib/types";

type View = "today" | "upcoming" | "overdue" | "inbox" | "completed";
const empty = { title: "", description: "", priority: "medium", category: "", dueDate: "", dueTime: "", projectId: "", goalId: "", recurrence: "", estimatedMinutes: "" };
const EMPTY_COPY: Record<View, { title: string; body: string }> = {
  today: { title: "Nothing due today", body: "You've cleared everything for today." },
  upcoming: { title: "No upcoming tasks", body: "Plan the next days and they will show up here." },
  overdue: { title: "Nothing overdue", body: "You're on top of things." },
  inbox: { title: "Inbox is empty", body: "Tasks without a date land here." },
  completed: { title: "No completed tasks yet", body: "Completed tasks are kept here for reference." },
};

function TasksInner() {
  const sp = useSearchParams();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<View>((sp.get("view") as View) || "today");
  const tasks = useApi<Task[]>(`/api/tasks?view=${view}`, [view]);
  const projects = useApi<Project[]>("/api/projects");
  const goals = useApi<Goal[]>("/api/goals?status=active");
  const [editing, setEditing] = useState<Partial<Task> | null>(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const openNew = () => { setForm({ ...empty, dueDate: view === "upcoming" || view === "inbox" ? "" : todayLocal() }); setEditing({}); setError(""); };
  const openEdit = (t: Task) => { setForm({ title: t.title, description: t.description ?? "", priority: t.priority, category: t.category ?? "", dueDate: t.dueDate ?? "", dueTime: t.dueTime ?? "", projectId: t.projectId ?? "", goalId: t.goalId ?? "", recurrence: t.recurrence ?? "", estimatedMinutes: t.estimatedMinutes?.toString() ?? "" }); setEditing(t); setError(""); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setSaving(true);
    const body = { title: form.title, description: form.description || null, priority: form.priority, category: form.category || null, dueDate: form.dueDate || null, dueTime: form.dueTime || null, projectId: form.projectId || null, goalId: form.goalId || null, recurrence: form.recurrence || null, estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null };
    try { if (editing?.id) { await api(`/api/tasks/${editing.id}`, { method: "PATCH", json: body }); toast.success("Task updated", form.title); } else { await api("/api/tasks", { method: "POST", json: body }); toast.success("Task created", form.title); } setEditing(null); tasks.refresh(); } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };
  const complete = async (t: Task) => {
    tasks.setData((d) => (d ?? []).filter((x) => x.id !== t.id));
    try { const r = await api<{ next: Task | null }>(`/api/tasks/${t.id}/complete`, { method: "POST" }); toast.success("Task completed", r.next ? `${t.title} · next on ${fmtDate(r.next.dueDate)}` : t.title, { label: "Undo", onClick: async () => { await api(`/api/tasks/${t.id}`, { method: "PATCH", json: { status: "todo" } }); tasks.refresh(); } }); }
    catch (e) { toast.error("Could not complete task", (e as Error).message); } finally { tasks.refresh(); }
  };
  const reopen = async (t: Task) => { tasks.setData((d) => (d ?? []).filter((x) => x.id !== t.id)); await api(`/api/tasks/${t.id}`, { method: "PATCH", json: { status: "todo" } }); toast.info("Task reopened", t.title); tasks.refresh(); };
  const remove = (t: Task) => confirm(async () => { await api(`/api/tasks/${t.id}`, { method: "DELETE" }); setEditing(null); toast.success("Task deleted", t.title); tasks.refresh(); }, { title: "Delete task?", description: t.title });
  const today = todayLocal();
  const tone = (p: string) => (p === "urgent" ? "negative" : p === "high" ? "warning" : "muted");
  useEffect(() => { if (sp.get("new")) openNew(); }, []);
  return (
    <div>
      <PageHeader title="Tasks" subtitle="Today, upcoming, overdue and inbox. Recurring tasks re-spawn on completion." action={<Button variant="primary" onClick={openNew}>+ Task</Button>} />
      <Tabs id="tasks" value={view} onChange={setView} options={[{ value: "today", label: "Today" }, { value: "upcoming", label: "Upcoming" }, { value: "overdue", label: "Overdue" }, { value: "inbox", label: "Inbox" }, { value: "completed", label: "Completed" }]} />
      <div className="mt-3">
        {tasks.error ? <ErrorBox error={tasks.error} retry={tasks.reload} /> : tasks.loading && !tasks.data ? <SkeletonList rows={5} /> : !tasks.data?.length ? (
          <Empty icon={<CheckSquare size={18} />} title={EMPTY_COPY[view].title} action={view !== "completed" ? <><Button variant="primary" size="sm" onClick={openNew}>Add a task</Button><Button size="sm" onClick={() => (location.href = "/planner")}>Plan tomorrow</Button></> : undefined}>{EMPTY_COPY[view].body}</Empty>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            <AnimatePresence initial={false}>
              {tasks.data.map((t) => (
                <m.li key={t.id} layout="position" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24, height: 0, transition: { duration: 0.2, ease: T.exit.ease } }} transition={T.enter} className="row flex items-center gap-3 px-3 py-2.5">
                  <Checkbox checked={t.status === "done"} onChange={(v) => (v ? complete(t) : reopen(t))} label={t.status === "done" ? `Reopen ${t.title}` : `Complete ${t.title}`} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(t)}>
                    <p className={"truncate text-sm font-medium transition-all " + (t.status === "done" ? "line-through muted" : "")}>{t.title}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs muted">
                      {t.dueDate && <span className={t.dueDate < today && t.status !== "done" ? "text-negative" : ""}>{fmtDate(t.dueDate)}{t.dueTime ? " " + t.dueTime : ""}</span>}
                      {t.category && <span>· {t.category}</span>}
                      {t.recurrence && <span>· ↻ {t.recurrence}</span>}
                      {t.projectId && projects.data && <span>· {projects.data.find((p) => p.id === t.projectId)?.name}</span>}
                      <Source source={t.source === "ai" ? "ai" : null} />
                    </p>
                  </button>
                  {t.priority !== "medium" && <Badge tone={tone(t.priority)}>{t.priority}</Badge>}
                </m.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit task" : "New task"}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Title" error={error && !form.title ? "Title is required" : null}><input className="field" required autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
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
          <div className="flex justify-between">{editing?.id ? <Button type="button" variant="ghost" className="text-negative" onClick={() => remove(editing as Task)}>Delete</Button> : <span />}<Button variant="primary" type="submit" loading={saving}>Save</Button></div>
        </form>
      </Modal>
      {dialog}
    </div>
  );
}
export default function TasksPage() { return <Suspense><TasksInner /></Suspense>; }
