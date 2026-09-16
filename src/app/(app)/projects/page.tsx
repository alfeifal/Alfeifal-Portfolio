"use client";
import { useState } from "react";
import { FolderKanban } from "lucide-react";
import { useToast } from "@/components/toast";
import { Stagger, StaggerItem } from "@/components/motion";
import Link from "next/link";
import { Badge, Bar, Empty, ErrorBox, Field, Modal, PageHeader, Tabs, Button, SkeletonCards } from "@/components/ui";
import { api, fmtDate, todayLocal, useApi } from "@/lib/client";
import type { Project } from "@/lib/types";

export default function ProjectsPage() {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("active");
  const projects = useApi<Project[]>(`/api/projects${status === "all" ? "" : `?status=${status}`}`, [status]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ kind: "personal", priority: "medium", status: "active" });
  const [error, setError] = useState("");
  const save = async (e: React.FormEvent) => { e.preventDefault(); setError(""); setSaving(true); try { await api("/api/projects", { method: "POST", json: { name: form.name, description: form.description || null, kind: form.kind, priority: form.priority, status: form.status, deadline: form.deadline || null } }); toast.success("Project created", form.name); setModal(false); projects.refresh(); } catch (err) { setError((err as Error).message); } finally { setSaving(false); } };
  return (
    <div className="space-y-3">
      <PageHeader title="Projects" subtitle="Business, personal, learning, financial and technical projects with tasks and milestones." action={<button className="btn-primary btn-sm" onClick={() => setModal(true)}>+ Project</button>} />
      <Tabs value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "planning", label: "Planning" }, { value: "idea", label: "Ideas" }, { value: "on_hold", label: "On hold" }, { value: "completed", label: "Completed" }, { value: "all", label: "All" }]} />
      {projects.error && <ErrorBox error={projects.error} retry={projects.reload} />}
      {projects.loading && !projects.data ? <SkeletonCards n={4} /> : projects.data?.length === 0 ? <Empty icon={<FolderKanban size={18} />} title="No projects here" action={<Button variant="primary" size="sm" onClick={() => setModal(true)}>Create a project</Button>}>Business, personal, learning or technical — each project keeps its tasks, milestones and notes together.</Empty> : (
        <Stagger as="ul" className="grid gap-2 md:grid-cols-2" gap={0.04}>{projects.data?.map((p) => {
          const late = Boolean(p.deadline && p.deadline < todayLocal());
          return (
          <StaggerItem as="li" key={p.id}><Link href={`/projects/${p.id}`} className="card card-interactive block p-3">
            <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate font-medium">{p.name}</span><span className="flex shrink-0 items-center gap-1">{late && <Badge tone="negative">overdue</Badge>}{p.overdueTasks > 0 && <Badge tone="warning">{p.overdueTasks} late</Badge>}<Badge>{p.kind}</Badge></span></div>
            <p className="mt-0.5 text-xs muted">{p.status} · {p.priority}{p.deadline ? ` · ${fmtDate(p.deadline)}` : ""} · {p.openTasks} open / {p.doneTasks} done{p.totalMilestones > 0 ? ` · ${p.doneMilestones}/${p.totalMilestones} milestones` : ""}</p>
            <div className="mt-2 flex items-center gap-2"><Bar value={p.computedProgress / 100} /><span className="text-xs tnum">{p.computedProgress}%</span></div>
            {/* Never a bare percentage: say what it was counted over, or that there is nothing to count. */}
            <p className="mt-1 text-[11px] muted">{p.progressBasis === "none" ? "No tasks or milestones yet" : p.progressBasis === "manual" ? "set by hand" : `${p.progressDone} of ${p.progressTotal} ${p.progressBasis}`}</p>
          </Link></StaggerItem>);
        })}</Stagger>
      )}
      <Modal open={modal} onClose={() => setModal(false)} title="New project">
        <form onSubmit={save} className="space-y-3">
          <Field label="Name"><input className="field" required autoFocus value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Kind"><select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{["personal", "business", "learning", "financial", "technical"].map((k) => <option key={k}>{k}</option>)}</select></Field><Field label="Priority"><select className="field" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{["low", "medium", "high", "urgent"].map((k) => <option key={k}>{k}</option>)}</select></Field><Field label="Status"><select className="field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["idea", "planning", "active", "on_hold"].map((k) => <option key={k}>{k}</option>)}</select></Field><Field label="Deadline"><input className="field" type="date" value={form.deadline ?? ""} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field></div>
          <Field label="Description"><textarea className="field" rows={3} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end"><Button variant="primary" type="submit" loading={saving}>Create</Button></div>
        </form>
      </Modal>
    </div>
  );
}
