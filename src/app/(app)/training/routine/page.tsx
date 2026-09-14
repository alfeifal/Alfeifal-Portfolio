"use client";
import { useState } from "react";
import { Badge, Card, ErrorBox, Field, Modal, PageHeader, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/client";

interface Plan { id: string; name: string; description: string | null; cycleLength: number; startDate: string; rules: Record<string, unknown>; days: { id: string; dayIndex: number; name: string; focus: string[]; isRest: boolean; notes: string | null; exercises: { id: string; position: number; sets: number; reps: string; intensity: string | null; loadNote: string | null; restNote: string | null; restSeconds: number | null; notes: string | null; exercise: { name: string; anatomicalTarget: string | null } }[] }[] }

/** The routine, exactly as imported from the attached document, editable (spec §17). */
export default function RoutinePage() {
  const plan = useApi<Plan>("/api/training/plan");
  const [adding, setAdding] = useState<string | null>(null);
  const [form, setForm] = useState({ exerciseName: "", sets: "3", reps: "8–10", intensity: "MODERADO", loadNote: "", restSeconds: "90" });
  const [error, setError] = useState("");
  const p = plan.data;
  const setStart = async () => { const v = prompt("Cycle start date (YYYY-MM-DD). Day 1 (Push) falls on this date.", p?.startDate); if (!v || !p) return; await api("/api/training/plan", { method: "PATCH", json: { id: p.id, startDate: v } }); plan.refresh(); };
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (!adding) return; setError(""); try { await api(`/api/training/days/${adding}/exercises`, { method: "POST", json: { exerciseName: form.exerciseName, sets: Number(form.sets), reps: form.reps, intensity: form.intensity, loadNote: form.loadNote || null, restSeconds: Number(form.restSeconds) } }); setAdding(null); plan.refresh(); } catch (err) { setError((err as Error).message); } };
  const edit = async (id: string, field: "sets" | "reps" | "loadNote" | "restSeconds", current: string) => { const v = prompt(`New ${field}`, current); if (v == null) return; await api(`/api/training/day-exercises/${id}`, { method: "PATCH", json: { [field]: field === "sets" || field === "restSeconds" ? Number(v) : v } }); plan.refresh(); };
  const remove = async (id: string) => { if (!confirm("Remove this exercise from the routine?")) return; await api(`/api/training/day-exercises/${id}`, { method: "DELETE" }); plan.refresh(); };
  const map = (p?.rules.anatomicalMap ?? []) as { group: string; parts: [string, string][] }[];
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/training", label: "Training" }} title={p?.name ?? "Routine"} subtitle={p?.description ?? ""} action={<button className="btn-ghost btn-sm" onClick={setStart}>Cycle start: {p?.startDate}</button>} />
      {plan.error && <ErrorBox error={plan.error} retry={plan.reload} />}
      {!p && plan.loading && <Spinner />}
      {p && (
        <>
          <p className="text-xs muted">Source: your attached routine document (imported verbatim). {p.cycleLength}-day cycle: {p.days.map((d) => d.name).join(" → ")}. Edits here change your plan; the original text is in docs/training-routine.md.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {p.days.map((d) => (
              <Card key={d.id} title={`D${d.dayIndex + 1} · ${d.name}`} action={!d.isRest && <button className="btn-ghost btn-sm" onClick={() => { setAdding(d.id); setError(""); }}>+ Exercise</button>}>
                {d.isRest ? <p className="text-sm">{d.notes}</p> : <><p className="mb-2 text-xs muted">{d.focus.join(" · ")}</p><ol className="divide-y divide-border text-sm">{d.exercises.map((e) => <li key={e.id} className="py-1.5"><div className="flex items-start gap-2"><span className="w-5 shrink-0 text-xs muted">{e.position}</span><div className="min-w-0 flex-1"><p className="font-medium">{e.exercise.name}</p><p className="text-xs muted">{e.exercise.anatomicalTarget}</p><p className="text-xs"><button className="link" onClick={() => edit(e.id, "sets", String(e.sets))}>{e.sets} sets</button> × <button className="link" onClick={() => edit(e.id, "reps", e.reps)}>{e.reps}</button> · {e.intensity && <Badge tone={e.intensity === "PESADO" ? "negative" : e.intensity === "MODERADO" ? "warning" : "muted"}>{e.intensity}</Badge>} <button className="link" onClick={() => edit(e.id, "loadNote", e.loadNote ?? "")}>{e.loadNote || "load?"}</button> · rest <button className="link" onClick={() => edit(e.id, "restSeconds", String(e.restSeconds ?? 60))}>{e.restNote ?? `${e.restSeconds} s`}</button></p></div><button className="btn-ghost btn-sm" onClick={() => remove(e.id)}>✕</button></div></li>)}</ol></>}
              </Card>
            ))}
          </div>
          <Card title="Anatomical map (from the routine)"><div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">{map.map((g) => <div key={g.group}><p className="font-semibold">{g.group}</p><ul>{g.parts.map(([part, where]) => <li key={part} className="flex justify-between gap-2"><span>{part}</span><span className="muted text-right">{where}</span></li>)}</ul></div>)}</div></Card>
        </>
      )}
      <Modal open={!!adding} onClose={() => setAdding(null)} title="Add exercise to day">
        <form onSubmit={add} className="space-y-3">
          <Field label="Exercise name"><input className="field" required autoFocus value={form.exerciseName} onChange={(e) => setForm({ ...form, exerciseName: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Sets"><input className="field" type="number" min={1} value={form.sets} onChange={(e) => setForm({ ...form, sets: e.target.value })} /></Field><Field label="Reps"><input className="field" value={form.reps} onChange={(e) => setForm({ ...form, reps: e.target.value })} /></Field><Field label="Intensity"><select className="field" value={form.intensity} onChange={(e) => setForm({ ...form, intensity: e.target.value })}>{["PESADO", "MODERADO", "LIGERO"].map((i) => <option key={i}>{i}</option>)}</select></Field><Field label="Rest (s)"><input className="field" type="number" value={form.restSeconds} onChange={(e) => setForm({ ...form, restSeconds: e.target.value })} /></Field></div>
          <Field label="Load note"><input className="field" placeholder="e.g. 20–25 kg" value={form.loadNote} onChange={(e) => setForm({ ...form, loadNote: e.target.value })} /></Field>
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end"><button className="btn-primary">Add</button></div>
        </form>
      </Modal>
    </div>
  );
}
