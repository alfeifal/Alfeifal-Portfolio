"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Bar, Card, ErrorBox, PageHeader, Spinner, useConfirm } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, fmtDate, useApi } from "@/lib/client";
import type { Project, Task } from "@/lib/types";

interface Detail extends Project { tasks: Task[]; milestones: { id: string; title: string; dueDate: string | null; completedAt: string | null }[] }

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const p = useApi<Detail>(`/api/projects/${id}`);
  const [task, setTask] = useState("");
  const [ms, setMs] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const d = p.data;
  const patch = async (json: Record<string, unknown>) => { await api(`/api/projects/${id}`, { method: "PATCH", json }); toast.success("Project updated"); p.refresh(); };
  if (p.error) return <ErrorBox error={p.error} retry={p.reload} />;
  if (!d) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/projects", label: "Projects" }} title={d.name} subtitle={<><Badge>{d.kind}</Badge> {d.priority}{d.deadline && ` · deadline ${fmtDate(d.deadline)}`} · {d.computedProgress}%</>} action={<><select className="field !w-auto !py-1.5 text-sm" value={d.status} onChange={(e) => patch({ status: e.target.value })}>{["idea", "planning", "active", "on_hold", "completed", "archived"].map((s) => <option key={s}>{s}</option>)}</select><button className="btn-ghost btn-sm text-negative" onClick={() => confirm(async () => { await api(`/api/projects/${id}`, { method: "DELETE" }); toast.success("Project deleted"); router.push("/projects"); }, { title: "Delete project?", description: "Its tasks are kept without a project." })}>Delete</button></>} />
      <Bar value={d.computedProgress / 100} h={8} />
      {d.description && <p className="text-sm muted">{d.description}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <Card title={`Tasks · ${d.openTasks} open`}>
          <ul className="divide-y divide-border text-sm">{d.tasks.map((t) => <li key={t.id} className="flex items-center gap-2 py-1.5"><input type="checkbox" checked={t.status === "done"} onChange={async () => { await api(t.status === "done" ? `/api/tasks/${t.id}` : `/api/tasks/${t.id}/complete`, t.status === "done" ? { method: "PATCH", json: { status: "todo" } } : { method: "POST" }); p.refresh(); }} /><span className={"flex-1 " + (t.status === "done" ? "line-through muted" : "")}>{t.title}</span>{t.dueDate && <span className="text-xs muted">{fmtDate(t.dueDate)}</span>}{t.priority !== "medium" && <Badge>{t.priority}</Badge>}</li>)}</ul>
          <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!task.trim()) return; await api("/api/tasks", { method: "POST", json: { title: task, projectId: id, category: "project" } }); setTask(""); p.refresh(); }}><input className="field" placeholder="New task" value={task} onChange={(e) => setTask(e.target.value)} /><button className="btn-ghost">Add</button></form>
        </Card>
        <div className="space-y-3">
          <Card title="Milestones">
            <ul className="divide-y divide-border text-sm">{d.milestones.map((m) => <li key={m.id} className="flex items-center gap-2 py-1.5"><input type="checkbox" checked={!!m.completedAt} onChange={async (e) => { await api(`/api/milestones/${m.id}`, { method: "PATCH", json: { done: e.target.checked } }); p.refresh(); }} /><span className={"flex-1 " + (m.completedAt ? "line-through muted" : "")}>{m.title}</span>{m.dueDate && <span className="text-xs muted">{fmtDate(m.dueDate)}</span>}</li>)}</ul>
            <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!ms.trim()) return; await api(`/api/projects/${id}/milestones`, { method: "POST", json: { title: ms } }); setMs(""); p.refresh(); }}><input className="field" placeholder="New milestone" value={ms} onChange={(e) => setMs(e.target.value)} /><button className="btn-ghost">Add</button></form>
          </Card>
          <Card title="Notes" action={notes == null ? <button className="btn-ghost btn-sm" onClick={() => setNotes(d.notes ?? "")}>Edit</button> : <button className="btn-primary btn-sm" onClick={async () => { await patch({ notes }); setNotes(null); }}>Save</button>}>
            {notes == null ? <p className="whitespace-pre-wrap text-sm">{d.notes || <span className="muted">No notes.</span>}</p> : <textarea className="field" rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Card>
        </div>
      </div>
      {dialog}
    </div>
  );
}
