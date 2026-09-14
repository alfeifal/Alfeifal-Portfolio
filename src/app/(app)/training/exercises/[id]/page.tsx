"use client";
import { use } from "react";
import { Card, ErrorBox, PageHeader, Spinner, Stat } from "@/components/ui";
import { fmtDate, fmtNum, useApi } from "@/lib/client";
import { MiniLine } from "@/components/charts";

interface Progress { exercise: { name: string; anatomicalTarget: string | null; unit: string }; series: { date: string; topWeight: number; topReps: number; est1rm: number; volume: number; sets: { weightKg: number | null; reps: number | null; seconds: number | null }[] }[]; records: { kind: string; value: number; reps: number | null; weightKg: number | null; achievedAt: string }[] }

export default function ExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const p = useApi<Progress>(`/api/training/exercises/${id}/progress`);
  if (p.error) return <ErrorBox error={p.error} retry={p.reload} />;
  if (!p.data) return <Spinner />;
  const d = p.data;
  const last = d.series[d.series.length - 1];
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/training", label: "Training" }} title={d.exercise.name} subtitle={d.exercise.anatomicalTarget ?? ""} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Sessions" value={d.series.length} />
        <Stat label="Last top set" value={last ? (d.exercise.unit === "s" ? `${last.sets[0]?.seconds ?? 0}s` : `${last.topWeight} × ${last.topReps}`) : "—"} sub={last ? fmtDate(last.date) : ""} />
        {d.records.filter((r) => r.kind === "est_1rm" || r.kind === "max_seconds" || r.kind === "max_reps_bodyweight").slice(0, 1).map((r) => <Stat key={r.kind} label={r.kind.replace(/_/g, " ")} value={fmtNum(r.value, 1)} sub={`${fmtDate(r.achievedAt)}${r.weightKg != null ? ` · ${r.weightKg}×${r.reps}` : ""}`} />)}
        {d.records.filter((r) => r.kind === "max_weight").slice(0, 1).map((r) => <Stat key={r.kind} label="Max weight" value={`${r.value} kg`} sub={`× ${r.reps} · ${fmtDate(r.achievedAt)}`} />)}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Top set weight"><MiniLine series={d.series.map((s) => ({ label: s.date.slice(5), v: s.topWeight }))} label="kg" /></Card>
        <Card title="Estimated 1RM (Epley · calculated)"><MiniLine series={d.series.map((s) => ({ label: s.date.slice(5), v: s.est1rm }))} label="1RM" /></Card>
      </div>
      <Card title="Session log">{d.series.length === 0 ? <p className="text-sm muted">No sets logged yet for this exercise.</p> : <ul className="divide-y divide-border text-sm">{[...d.series].reverse().map((s) => <li key={s.date} className="flex justify-between py-1.5"><span>{fmtDate(s.date)}</span><span className="tnum muted">{s.sets.map((x) => x.seconds ? `${x.seconds}s` : `${x.weightKg ?? 0}×${x.reps ?? 0}`).join(", ")} · vol {fmtNum(s.volume, 0)}</span></li>)}</ul>}</Card>
    </div>
  );
}
