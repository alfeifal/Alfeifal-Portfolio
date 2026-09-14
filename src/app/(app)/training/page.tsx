"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, Card, Empty, ErrorBox, Field, Modal, PageHeader, Stat, Source, Button, Bar, SkeletonCards } from "@/components/ui";
import { AnimatePresence, m } from "motion/react";
import { Stagger, StaggerItem, T } from "@/components/motion";
import { useToast } from "@/components/toast";
import { addDays, api, fmtDate, fmtNum, todayLocal, useApi } from "@/lib/client";
import { MiniBars } from "@/components/charts";

interface DayExercise { id: string; exerciseId: string; position: number; sets: number; reps: string; intensity: string | null; loadNote: string | null; restSeconds: number | null; restNote: string | null; notes: string | null; exercise: { id: string; name: string; anatomicalTarget: string | null; unit: string; bodyweight: boolean } }
interface Today { date: string; dayIndex: number; plan: { id: string; name: string; cycleLength: number; startDate: string; rules: Record<string, unknown> }; day: { id: string; name: string; focus: string[]; isRest: boolean; notes: string | null; exercises: DayExercise[] } | null; session: { id: string; startedAt: string; finishedAt: string | null; durationMinutes: number | null; notes: string | null; sets: { id: string; exerciseId: string; setNumber: number; weightKg: number | null; reps: number | null; seconds: number | null; isWarmup: boolean; source: string }[]; volume: number } | null; lastPerformance: Record<string, { date: string; sets: { weightKg: number | null; reps: number | null; seconds: number | null }[] }> }
interface Stats { sessions: number; sets: number; volume: number; minutes: number; weekly: { week: string; sessions: number; volume: number }[] }
interface HistoryItem { id: string; date: string; dayName: string | null; sets: number; volume: number; finishedAt: string | null; durationMinutes: number | null }

export default function TrainingPage() {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const today = useApi<Today>(`/api/training/today?date=${date}`, [date]);
  const stats = useApi<Stats>("/api/training/stats");
  const history = useApi<HistoryItem[]>("/api/training/sessions?limit=8");
  const [logging, setLogging] = useState<DayExercise | null>(null);
  const [form, setForm] = useState({ weightKg: "", reps: "", seconds: "", rpe: "", isWarmup: false });
  const [error, setError] = useState("");
  const [pr, setPr] = useState<string | null>(null);
  const d = today.data;
  const start = async () => { await api("/api/training/sessions", { method: "POST", json: { date, dayId: d?.day?.id } }); toast.success("Workout started", d?.day?.name ?? undefined); today.refresh(); };
  const finish = async () => { if (!d?.session) return; const r = await api<{ durationMinutes: number | null }>(`/api/training/sessions/${d.session.id}`, { method: "PATCH", json: { finished: true } }); toast.success("Workout saved", `${d.day?.name ?? "Session"} · ${r.durationMinutes ?? 0} min`); today.refresh(); history.refresh(); stats.refresh(); };
  const openLog = (ex: DayExercise) => { const sets = d?.session?.sets.filter((s) => s.exerciseId === ex.exerciseId) ?? []; const last = sets[sets.length - 1] ?? d?.lastPerformance[ex.exerciseId]?.sets[0]; setForm({ weightKg: last?.weightKg?.toString() ?? "", reps: last?.reps?.toString() ?? "", seconds: last?.seconds?.toString() ?? "", rpe: "", isWarmup: false }); setLogging(ex); setError(""); };
  const logSet = async (e: React.FormEvent) => {
    e.preventDefault(); if (!logging) return; setError(""); setSaving(true);
    try {
      const r = await api<{ newRecords: { kind: string; value: number }[] }>("/api/training/sets", { method: "POST", json: { sessionId: d?.session?.id, exerciseId: logging.exerciseId, date, weightKg: form.weightKg ? Number(form.weightKg) : null, reps: form.reps ? Number(form.reps) : null, seconds: form.seconds ? Number(form.seconds) : null, rpe: form.rpe ? Number(form.rpe) : null, isWarmup: form.isWarmup } });
      const setLabel = form.seconds ? `${form.seconds}s` : `${form.weightKg || 0} kg × ${form.reps || 0}`;
      if (r.newRecords.length) { const prText = r.newRecords.map((x) => `${x.kind.replace(/_/g, " ")} ${x.value}`).join(", "); setPr(`New PR: ${prText}`); toast.success("Set logged · new PR 🏆", `${logging.exercise.name} · ${setLabel}`); }
      else toast.success("Set logged", `${logging.exercise.name} · ${setLabel}`);
      today.refresh(); stats.refresh();
    } catch (err) { setError((err as Error).message); toast.error("Could not log set", (err as Error).message); } finally { setSaving(false); }
  };
  const deleteSet = async (id: string) => { await api(`/api/training/sets/${id}`, { method: "DELETE" }); toast.info("Set removed"); today.refresh(); };
  const setsFor = (exId: string) => d?.session?.sets.filter((s) => s.exerciseId === exId) ?? [];
  const doneCount = d?.day ? d.day.exercises.filter((e) => setsFor(e.exerciseId).filter((s) => !s.isWarmup).length >= e.sets).length : 0;
  const rules = (d?.plan.rules ?? {}) as { progression?: string; rest?: string; intensityLegend?: string };
  return (
    <div className="space-y-4">
      <PageHeader title="Training" subtitle={d ? `${d.plan.name} · cycle day ${d.dayIndex + 1}/${d.plan.cycleLength}` : "Your routine"} action={<><button className="btn-ghost btn-sm" onClick={() => setDate(addDays(date, -1))}>←</button><input type="date" className="field !w-auto !py-1.5 text-sm" value={date} onChange={(e) => setDate(e.target.value)} /><button className="btn-ghost btn-sm" onClick={() => setDate(addDays(date, 1))}>→</button><Link href="/training/routine" className="btn-ghost btn-sm">Routine</Link></>} />
      {today.error && <ErrorBox error={today.error} retry={today.reload} />}
      {today.loading && !d && <SkeletonCards n={2} />}
      <AnimatePresence>{pr && <m.div key="pr" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, height: 0 }} transition={T.enter} className="card border-positive/40 bg-positive/10 p-3 text-sm">🏆 {pr} <button className="link ml-2" onClick={() => setPr(null)}>ok</button></m.div>}</AnimatePresence>
      {d && (
        <>
          {d.day?.isRest ? <Card title={`${fmtDate(date, { weekday: "long", day: "numeric", month: "short" })} · Rest day`}><p className="text-sm">{d.day.notes}</p><p className="mt-2 text-xs muted">Want to train anyway? <button className="link" onClick={start}>Start a free session</button></p></Card> : d.day ? (
            <Card title={<>{fmtDate(date, { weekday: "long", day: "numeric", month: "short" })} · {d.day.name}</>} action={d.session ? d.session.finishedAt ? <Badge tone="positive">finished · {d.session.durationMinutes} min</Badge> : <Button variant="primary" size="sm" onClick={finish}>Finish workout</Button> : <Button variant="primary" size="sm" onClick={start}>Start workout</Button>}>
              <p className="mb-1.5 text-xs muted">{d.day.focus.join(" · ")} · {doneCount}/{d.day.exercises.length} exercises done{d.session ? ` · volume ${fmtNum(d.session.volume, 0)} kg` : ""}</p>
              <div className="mb-3"><Bar value={d.day.exercises.length ? doneCount / d.day.exercises.length : 0} tone="positive" h={4} /></div>
              <Stagger as="ol" className="divide-y divide-border" gap={0.03}>
                {d.day.exercises.map((ex) => { const sets = setsFor(ex.exerciseId); const working = sets.filter((s) => !s.isWarmup); const done = working.length >= ex.sets; const last = d.lastPerformance[ex.exerciseId]; return (
                  <StaggerItem as="li" key={ex.id} className={"py-2.5 transition-opacity " + (done ? "opacity-70" : "")}>
                    <div className="flex items-start gap-3">
                      <m.span layout className={"mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200 " + (done ? "bg-positive text-white" : "bg-surface-2")} animate={done ? { scale: [1, 1.15, 1] } : {}} transition={{ duration: 0.3 }}>{done ? "✓" : ex.position}</m.span>
                      <div className="min-w-0 flex-1">
                        <Link href={`/training/exercises/${ex.exerciseId}`} className="font-medium hover:underline">{ex.exercise.name}</Link>
                        <p className="text-xs muted">{ex.exercise.anatomicalTarget}</p>
                        <p className="mt-0.5 text-sm"><span className="font-medium tnum">{ex.sets} × {ex.reps}</span>{ex.intensity && <Badge tone={ex.intensity === "PESADO" ? "negative" : ex.intensity === "MODERADO" ? "warning" : "muted"} className="ml-1.5">{ex.intensity}</Badge>}<span className="muted"> · {ex.loadNote} · rest {ex.restNote ?? (ex.restSeconds ? ex.restSeconds + " s" : "—")}</span></p>
                        {last && <p className="text-xs muted">Last ({fmtDate(last.date)}): {last.sets.map((s) => s.seconds ? `${s.seconds}s` : `${s.weightKg ?? 0}×${s.reps ?? 0}`).join(", ")}</p>}
                        <ul className="mt-1 flex flex-wrap gap-1"><AnimatePresence initial={false}>{sets.map((s) => <m.li key={s.id} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={T.state} className={"pill " + (s.isWarmup ? "opacity-60" : "")}>{s.isWarmup ? "w " : ""}{s.seconds ? `${s.seconds}s` : `${s.weightKg ?? 0} kg × ${s.reps ?? 0}`}{s.source === "ai" && <Source source="ai" />}<button className="ml-1 muted transition-colors hover:text-negative" onClick={() => deleteSet(s.id)} aria-label="Remove set">✕</button></m.li>)}</AnimatePresence></ul>
                      </div>
                      <Button size="sm" variant={done ? "ghost" : "subtle"} className="shrink-0" onClick={() => openLog(ex)}>+ Set</Button>
                    </div>
                  </StaggerItem>); })}
              </Stagger>
            </Card>
          ) : <Empty>No plan day for this date.</Empty>}
          <div className="grid gap-3 md:grid-cols-3">
            <Card title="Rules (from your routine)" className="md:col-span-2"><ul className="space-y-1 text-xs"><li><span className="font-medium">Intensity:</span> {rules.intensityLegend}</li><li><span className="font-medium">Progression:</span> {rules.progression}</li><li><span className="font-medium">Rest:</span> {rules.rest}</li></ul></Card>
            <div className="grid grid-cols-2 gap-2"><Stat label="Sessions (8 wk)" value={stats.data?.sessions ?? "—"} /><Stat label="Volume (8 wk)" value={stats.data ? `${fmtNum(stats.data.volume / 1000, 1)} t` : "—"} sub={`${stats.data?.sets ?? 0} sets`} /></div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Card title="Weekly volume">{stats.data?.weekly.length ? <MiniBars series={stats.data.weekly.map((w) => ({ label: w.week.slice(5), a: w.volume }))} labels={["Volume (kg)"]} format={(v) => `${fmtNum(v, 0)} kg`} /> : <p className="text-sm muted">Log workouts to see volume trends.</p>}</Card>
            <Card title="History" action={<Link href="/training/records" className="btn-ghost btn-sm">Records</Link>}>{!history.data?.length ? <p className="text-sm muted">No workouts yet.</p> : <ul className="divide-y divide-border text-sm">{history.data.map((s) => <li key={s.id}><Link href={`/training/sessions/${s.id}`} className="flex justify-between py-1.5 hover:underline"><span>{fmtDate(s.date)} · {s.dayName ?? "Free session"}{!s.finishedAt && <Badge tone="warning" className="ml-1">open</Badge>}</span><span className="muted tnum">{s.sets} sets · {fmtNum(s.volume, 0)} kg{s.durationMinutes ? ` · ${s.durationMinutes} min` : ""}</span></Link></li>)}</ul>}</Card>
          </div>
        </>
      )}
      <Modal open={!!logging} onClose={() => setLogging(null)} title={logging ? `Log set · ${logging.exercise.name}` : ""}>
        {logging && <form onSubmit={logSet} className="space-y-3">
          <p className="text-xs muted">Prescribed: {logging.sets} × {logging.reps} · {logging.loadNote}. Sets logged: {setsFor(logging.exerciseId).filter((s) => !s.isWarmup).length}/{logging.sets}</p>
          <div className="grid grid-cols-2 gap-2">
            {logging.exercise.unit === "s" ? <Field label="Seconds"><input className="field" type="number" inputMode="numeric" autoFocus value={form.seconds} onChange={(e) => setForm({ ...form, seconds: e.target.value })} /></Field> : <Field label="Reps"><input className="field" type="number" inputMode="numeric" autoFocus value={form.reps} onChange={(e) => setForm({ ...form, reps: e.target.value })} /></Field>}
            <Field label={logging.exercise.bodyweight ? "Added weight (kg)" : "Weight (kg)"}><input className="field" type="number" step="0.5" inputMode="decimal" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} /></Field>
            <Field label="RPE (optional)"><input className="field" type="number" step="0.5" min={1} max={10} value={form.rpe} onChange={(e) => setForm({ ...form, rpe: e.target.value })} /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={form.isWarmup} onChange={(e) => setForm({ ...form, isWarmup: e.target.checked })} />Warm-up set</label>
          </div>
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setLogging(null)}>Done</Button><Button variant="primary" type="submit" loading={saving}>Log set</Button></div>
        </form>}
      </Modal>
    </div>
  );
}
