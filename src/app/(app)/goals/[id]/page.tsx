"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, Bar, Card, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { api, fmtDate, useApi } from "@/lib/client";
import type { Goal, Task } from "@/lib/types";

interface GoalDetail extends Goal { description: string | null; milestones: { id: string; title: string; dueDate: string | null; completedAt: string | null }[]; tasks: Task[] }

export default function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const g = useApi<GoalDetail>(`/api/goals/${id}`);
  const [ms, setMs] = useState("");
  const [task, setTask] = useState("");
  const d = g.data;
  const patch = async (json: Record<string, unknown>) => { await api(`/api/goals/${id}`, { method: "PATCH", json }); g.refresh(); };
  if (g.error) return <ErrorBox error={g.error} retry={g.reload} />;
  if (!d) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/goals", label: "Goals" }} title={d.name} subtitle={<><Badge>{d.category}</Badge> <Badge>{d.status}</Badge> {d.deadline && `· by ${fmtDate(d.deadline)}`} · {d.priority}</>} action={<><select className="field !w-auto !py-1.5 text-sm" value={d.status} onChange={(e) => patch({ status: e.target.value })}>{["active", "paused", "completed", "abandoned"].map((s) => <option key={s}>{s}</option>)}</select><button className="btn-ghost btn-sm text-negative" onClick={async () => { if (confirm("Delete goal?")) { await api(`/api/goals/${id}`, { method: "DELETE" }); router.push("/goals"); } }}>Delete</button></>} />
      <Card title="Progress">
        <div className="flex items-center gap-3"><Bar value={d.progress / 100} tone={d.progress >= 100 ? "positive" : "accent"} h={10} /><span className="tnum font-semibold">{d.progress}%</span></div>
        {d.metricName ? <p className="mt-2 text-sm">{d.metricName}: <span className="tnum font-medium">{d.metricCurrent ?? 0} / {d.metricTarget} {d.metricUnit}</span> <button className="link ml-2 text-xs" onClick={async () => { const v = prompt("Current value", String(d.metricCurrent ?? 0)); if (v != null) await patch({ metricCurrent: Number(v) }); }}>update</button></p> : <p className="mt-2 text-sm"><input type="range" min={0} max={100} value={d.progress} onChange={(e) => patch({ progress: Number(e.target.value) })} className="w-full" /></p>}
        {d.description && <p className="mt-2 whitespace-pre-wrap text-sm muted">{d.description}</p>}
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Milestones">
          <ul className="divide-y divide-border text-sm">{d.milestones.map((m) => <li key={m.id} className="flex items-center gap-2 py-1.5"><input type="checkbox" checked={!!m.completedAt} onChange={async (e) => { await api(`/api/milestones/${m.id}`, { method: "PATCH", json: { done: e.target.checked } }); g.refresh(); }} /><span className={"flex-1 " + (m.completedAt ? "line-through muted" : "")}>{m.title}</span>{m.dueDate && <span className="text-xs muted">{fmtDate(m.dueDate)}</span>}<button className="btn-ghost btn-sm" onClick={async () => { await api(`/api/milestones/${m.id}`, { method: "DELETE" }); g.refresh(); }}>✕</button></li>)}</ul>
          <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!ms.trim()) return; await api(`/api/goals/${id}/milestones`, { method: "POST", json: { title: ms } }); setMs(""); g.refresh(); }}><input className="field" placeholder="New milestone" value={ms} onChange={(e) => setMs(e.target.value)} /><button className="btn-ghost">Add</button></form>
        </Card>
        <Card title="Linked tasks">
          <ul className="divide-y divide-border text-sm">{d.tasks.map((t) => <li key={t.id} className="flex items-center gap-2 py-1.5"><input type="checkbox" checked={t.status === "done"} onChange={async () => { await api(`/api/tasks/${t.id}/complete`, { method: "POST" }); g.refresh(); }} /><span className={"flex-1 " + (t.status === "done" ? "line-through muted" : "")}>{t.title}</span>{t.dueDate && <span className="text-xs muted">{fmtDate(t.dueDate)}</span>}</li>)}</ul>
          <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!task.trim()) return; await api("/api/tasks", { method: "POST", json: { title: task, goalId: id } }); setTask(""); g.refresh(); }}><input className="field" placeholder="New task for this goal" value={task} onChange={(e) => setTask(e.target.value)} /><button className="btn-ghost">Add</button></form>
          <p className="mt-2 text-xs muted">All tasks: <Link className="link" href="/tasks">Tasks</Link></p>
        </Card>
      </div>
    </div>
  );
}
