"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, Bar, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Tabs } from "@/components/ui";
import { api, fmtDate, useApi } from "@/lib/client";
import type { Project } from "@/lib/types";

export default function ProjectsPage() {
  const [status, setStatus] = useState<string>("active");
  const projects = useApi<Project[]>(`/api/projects${status === "all" ? "" : `?status=${status}`}`, [status]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ kind: "personal", priority: "medium", status: "active" });
  const [error, setError] = useState("");
  const save = async (e: React.FormEvent) => { e.preventDefault(); setError(""); try { await api("/api/projects", { method: "POST", json: { name: form.name, description: form.description || null, kind: form.kind, priority: form.priority, status: form.status, deadline: form.deadline || null } }); setModal(false); projects.refresh(); } catch (err) { setError((err as Error).message); } };
  return (
    <div className="space-y-3">
      <PageHeader title="Projects" subtitle="Business, personal, learning, financial and technical projects with tasks and milestones." action={<button className="btn-primary btn-sm" onClick={() => setModal(true)}>+ Project</button>} />
      <Tabs value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "planning", label: "Planning" }, { value: "idea", label: "Ideas" }, { value: "on_hold", label: "On hold" }, { value: "completed", label: "Completed" }, { value: "all", label: "All" }]} />
      {projects.error && <ErrorBox error={projects.error} retry={projects.reload} />}
      {projects.loading && !projects.data ? <Spinner /> : projects.data?.length === 0 ? <Empty>No projects here.</Empty> : (
        <ul className="grid gap-2 md:grid-cols-2">{projects.data?.map((p) => <li key={p.id}><Link href={`/projects/${p.id}`} className="card block p-3 hover:bg-surface-2"><div className="flex items-center justify-between"><span className="font-medium">{p.name}</span><Badge>{p.kind}</Badge></div><p className="mt-0.5 text-xs muted">{p.status} · {p.priority}{p.deadline ? ` · ${fmtDate(p.deadline)}` : ""} · {p.openTasks} open / {p.doneTasks} done</p><div className="mt-2 flex items-center gap-2"><Bar value={p.computedProgress / 100} /><span className="text-xs tnum">{p.computedProgress}%</span></div></Link></li>)}</ul>
      )}
      <Modal open={modal} onClose={() => setModal(false)} title="New project">
        <form onSubmit={save} className="space-y-3">
          <Field label="Name"><input className="field" required autoFocus value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Kind"><select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{["personal", "business", "learning", "financial", "technical"].map((k) => <option key={k}>{k}</option>)}</select></Field><Field label="Priority"><select className="field" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{["low", "medium", "high", "urgent"].map((k) => <option key={k}>{k}</option>)}</select></Field><Field label="Status"><select className="field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["idea", "planning", "active", "on_hold"].map((k) => <option key={k}>{k}</option>)}</select></Field><Field label="Deadline"><input className="field" type="date" value={form.deadline ?? ""} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field></div>
          <Field label="Description"><textarea className="field" rows={3} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end"><button className="btn-primary">Create</button></div>
        </form>
      </Modal>
    </div>
  );
}
