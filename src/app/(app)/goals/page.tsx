"use client";
import { useState } from "react";
import { Target } from "lucide-react";
import { useToast } from "@/components/toast";
import { Stagger, StaggerItem } from "@/components/motion";
import Link from "next/link";
import { Badge, Bar, Empty, ErrorBox, Field, Modal, PageHeader, Tabs, Button, SkeletonCards } from "@/components/ui";
import { api, fmtDate, useApi } from "@/lib/client";
import type { Goal } from "@/lib/types";

export default function GoalsPage() {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"active" | "paused" | "completed" | "abandoned">("active");
  const goals = useApi<Goal[]>(`/api/goals?status=${status}`, [status]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ category: "personal", priority: "medium" });
  const [error, setError] = useState("");
  const save = async (e: React.FormEvent) => { e.preventDefault(); setError(""); setSaving(true); try { await api("/api/goals", { method: "POST", json: { name: form.name, description: form.description || null, category: form.category, priority: form.priority, deadline: form.deadline || null, metricName: form.metricName || null, metricUnit: form.metricUnit || null, metricTarget: form.metricTarget ? Number(form.metricTarget) : null, metricCurrent: form.metricCurrent ? Number(form.metricCurrent) : null } }); toast.success("Goal created", form.name); setModal(false); setForm({ category: "personal", priority: "medium" }); goals.refresh(); } catch (err) { setError((err as Error).message); } finally { setSaving(false); } };
  return (
    <div className="space-y-3">
      <PageHeader title="Goals" subtitle="Deadlines, progress, milestones, metrics. Goals link to tasks, projects and German study time." action={<button className="btn-primary btn-sm" onClick={() => setModal(true)}>+ Goal</button>} />
      <Tabs value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }, { value: "completed", label: "Completed" }, { value: "abandoned", label: "Abandoned" }]} />
      {goals.error && <ErrorBox error={goals.error} retry={goals.reload} />}
      {goals.loading && !goals.data ? <SkeletonCards n={4} /> : goals.data?.length === 0 ? <Empty icon={<Target size={18} />} title={`No ${status} goals`} action={status === "active" ? <Button variant="primary" size="sm" onClick={() => setModal(true)}>Create a goal</Button> : undefined}>{status === "active" ? "Give the assistant something to track: a deadline, a metric, a habit." : "Goals with this status will appear here."}</Empty> : (
        <Stagger as="ul" className="grid gap-2 md:grid-cols-2" gap={0.04}>{goals.data?.map((g) => <StaggerItem as="li" key={g.id}><Link href={`/goals/${g.id}`} className="card card-interactive block p-3"><div className="flex items-center justify-between"><span className="font-medium">{g.name}</span><Badge>{g.category}</Badge></div><p className="mt-0.5 text-xs muted">{g.deadline ? `by ${fmtDate(g.deadline)}` : "no deadline"}{g.metricName ? ` · ${g.metricCurrent ?? 0}/${g.metricTarget} ${g.metricUnit ?? ""}` : ""} · {g.priority}</p><div className="mt-2 flex items-center gap-2"><Bar value={g.progress / 100} tone={g.progress >= 100 ? "positive" : "accent"} /><span className="text-xs tnum">{g.progress}%</span></div></Link></StaggerItem>)}</Stagger>
      )}
      <Modal open={modal} onClose={() => setModal(false)} title="New goal">
        <form onSubmit={save} className="space-y-3">
          <Field label="Name"><input className="field" required autoFocus value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Category"><select className="field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{["personal", "finance", "training", "study", "german", "career", "trading", "project", "health"].map((c) => <option key={c}>{c}</option>)}</select></Field><Field label="Priority"><select className="field" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{["low", "medium", "high", "urgent"].map((c) => <option key={c}>{c}</option>)}</select></Field><Field label="Deadline"><input className="field" type="date" value={form.deadline ?? ""} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field></div>
          <p className="text-xs muted">Optional metric: progress is computed as current/target. For German time goals use unit “min” and category “german” — study time is added automatically.</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Field label="Metric"><input className="field" placeholder="Study minutes" value={form.metricName ?? ""} onChange={(e) => setForm({ ...form, metricName: e.target.value })} /></Field><Field label="Unit"><input className="field" placeholder="min" value={form.metricUnit ?? ""} onChange={(e) => setForm({ ...form, metricUnit: e.target.value })} /></Field><Field label="Target"><input className="field" type="number" step="any" value={form.metricTarget ?? ""} onChange={(e) => setForm({ ...form, metricTarget: e.target.value })} /></Field><Field label="Current"><input className="field" type="number" step="any" value={form.metricCurrent ?? ""} onChange={(e) => setForm({ ...form, metricCurrent: e.target.value })} /></Field></div>
          <Field label="Description"><textarea className="field" rows={2} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end"><Button variant="primary" type="submit" loading={saving}>Create</Button></div>
        </form>
      </Modal>
    </div>
  );
}
