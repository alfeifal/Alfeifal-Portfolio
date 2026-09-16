"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, Bar, Card, ErrorBox, PageHeader, Spinner, useConfirm } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, fmtDate, todayLocal, useApi } from "@/lib/client";
import type { Goal, Task } from "@/lib/types";

interface GoalDetail extends Goal { description: string | null; milestones: { id: string; title: string; dueDate: string | null; completedAt: string | null }[]; tasks: Task[]; pace: { from: string; to: string; expected: number | null; atRisk: boolean } | null }

export default function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const g = useApi<GoalDetail>(`/api/goals/${id}`);
  const [ms, setMs] = useState("");
  const [task, setTask] = useState("");
  const d = g.data;
  const patch = async (json: Record<string, unknown>) => { await api(`/api/goals/${id}`, { method: "PATCH", json }); toast.success("Goal updated"); g.refresh(); };
  if (g.error) return <ErrorBox error={g.error} retry={g.reload} />;
  if (!d) return <Spinner />;
  const today = todayLocal();
  const openTasks = d.tasks.filter((t) => t.status === "todo" || t.status === "in_progress").length;
  const doneTasks = d.tasks.filter((t) => t.status === "done").length;
  const doneMilestones = d.milestones.filter((m) => m.completedAt).length;
  const overdueMilestones = d.milestones.filter((m) => !m.completedAt && m.dueDate && m.dueDate < today).length;
  const overdueTasks = d.tasks.filter((t) => (t.status === "todo" || t.status === "in_progress") && t.dueDate && t.dueDate < today).length;
  // The next step: the earliest open milestone, else the earliest open task.
  const nextStep = [...d.milestones.filter((m) => !m.completedAt)].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0]?.title
    ?? [...d.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled")].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0]?.title
    ?? null;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/goals", label: "Goals" }} title={d.name} subtitle={<><Badge>{d.category}</Badge> <Badge>{d.status}</Badge> {d.deadline && `· by ${fmtDate(d.deadline)}`} · {d.priority}</>} action={<><select className="field !w-auto !py-1.5 text-sm" value={d.status} onChange={(e) => patch({ status: e.target.value })}>{["active", "paused", "completed", "abandoned"].map((s) => <option key={s}>{s}</option>)}</select><button className="btn-ghost btn-sm text-negative" onClick={() => confirm(async () => { await api(`/api/goals/${id}`, { method: "DELETE" }); toast.success("Goal deleted"); router.push("/goals"); }, { title: "Delete goal?", description: d.name })}>Delete</button></>} />
      <Card title="Progress">
        <div className="flex items-center gap-3"><Bar value={d.progress / 100} tone={d.progress >= 100 ? "positive" : "accent"} h={10} /><span className="tnum font-semibold">{d.progress}%</span></div>
        {/* Where the number comes from, and what is slipping — kept apart from the number itself. */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="muted">
            {d.metricSource ? `Tracked automatically from ${d.metricSource}` : openTasks + doneTasks > 0 ? `${doneTasks} of ${openTasks + doneTasks} linked tasks done` : d.milestones.length > 0 ? `${doneMilestones} of ${d.milestones.length} milestones reached` : "No tasks or milestones yet — nothing to measure"}
          </span>
          {overdueMilestones > 0 && <Badge tone="negative">{overdueMilestones} milestone{overdueMilestones === 1 ? "" : "s"} overdue</Badge>}
          {overdueTasks > 0 && <Badge tone="negative">{overdueTasks} task{overdueTasks === 1 ? "" : "s"} overdue</Badge>}
          {d.deadline && d.deadline < todayLocal() && d.status === "active" && <Badge tone="negative">past deadline</Badge>}
          {nextStep ? <span className="muted">Next: <span className="text-fg">{nextStep}</span></span> : null}
        </div>
        {d.metricSource ? (
          <>
            <p className="mt-2 text-sm">{d.metricName}: <span className="tnum font-medium">{d.metricCurrent ?? 0} / {d.metricTarget} {d.metricUnit}</span> {d.pace?.atRisk && <Badge tone="warning" className="ml-1">behind pace</Badge>}</p>
            <p className="mt-1 text-xs muted">Tracked automatically from {d.metricSource} ({d.metricKind}, {d.metricPeriod === "total" ? "since created" : `this ${d.metricPeriod}`}){d.pace?.expected != null ? ` · on pace would be ${d.pace.expected} ${d.metricUnit ?? ""}` : ""}. Log the activity and this updates itself.</p>
          </>
        ) : d.metricName ? <p className="mt-2 text-sm">{d.metricName}: <span className="tnum font-medium">{d.metricCurrent ?? 0} / {d.metricTarget} {d.metricUnit}</span> <button className="link ml-2 text-xs" onClick={async () => { const v = prompt("Current value", String(d.metricCurrent ?? 0)); if (v != null) await patch({ metricCurrent: Number(v) }); }}>update</button></p> : <p className="mt-2 text-sm"><input type="range" min={0} max={100} value={d.progress} onChange={(e) => patch({ progress: Number(e.target.value) })} className="w-full" /></p>}
        {d.description && <p className="mt-2 whitespace-pre-wrap text-sm muted">{d.description}</p>}
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Milestones">
          {d.milestones.length === 0 && <p className="text-sm muted">No milestones yet. Add the first checkpoint below.</p>}
          <ul className="divide-y divide-border text-sm">{d.milestones.map((m) => <li key={m.id} className="flex items-center gap-2 py-1.5"><input type="checkbox" checked={!!m.completedAt} onChange={async (e) => { await api(`/api/milestones/${m.id}`, { method: "PATCH", json: { done: e.target.checked } }); g.refresh(); }} /><span className={"flex-1 " + (m.completedAt ? "line-through muted" : "")}>{m.title}</span>{m.dueDate && <span className={"text-xs " + (!m.completedAt && m.dueDate < today ? "text-negative" : "muted")}>{fmtDate(m.dueDate)}</span>}<button className="btn-ghost btn-sm" onClick={async () => { await api(`/api/milestones/${m.id}`, { method: "DELETE" }); g.refresh(); }}>✕</button></li>)}</ul>
          <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!ms.trim()) return; await api(`/api/goals/${id}/milestones`, { method: "POST", json: { title: ms } }); setMs(""); g.refresh(); }}><input className="field" placeholder="New milestone" value={ms} onChange={(e) => setMs(e.target.value)} /><button className="btn-ghost">Add</button></form>
        </Card>
        <Card title="Linked tasks">
          {d.tasks.length === 0 && <p className="text-sm muted">No tasks linked to this goal yet.</p>}
          <ul className="divide-y divide-border text-sm">{d.tasks.map((t) => <li key={t.id} className="flex items-center gap-2 py-1.5"><input type="checkbox" checked={t.status === "done"} onChange={async () => { await api(`/api/tasks/${t.id}/complete`, { method: "POST" }); g.refresh(); }} /><span className={"flex-1 " + (t.status === "done" ? "line-through muted" : "")}>{t.title}</span>{t.dueDate && <span className="text-xs muted">{fmtDate(t.dueDate)}</span>}</li>)}</ul>
          <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!task.trim()) return; await api("/api/tasks", { method: "POST", json: { title: task, goalId: id } }); setTask(""); g.refresh(); }}><input className="field" placeholder="New task for this goal" value={task} onChange={(e) => setTask(e.target.value)} /><button className="btn-ghost">Add</button></form>
          <p className="mt-2 text-xs muted">All tasks: <Link className="link" href="/tasks">Tasks</Link></p>
        </Card>
      </div>
      {dialog}
    </div>
  );
}
