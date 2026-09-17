"use client";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Card, ErrorBox, PageHeader, Spinner, Source, useConfirm, usePrompt } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, fmtDate, fmtNum, useApi } from "@/lib/client";

interface Session { id: string; date: string; dayName: string | null; startedAt: string; finishedAt: string | null; durationMinutes: number | null; notes: string | null; rating: number | null; volume: number; sets: { id: string; exerciseId: string; exerciseName: string; setNumber: number; weightKg: number | null; reps: number | null; seconds: number | null; rpe: number | null; isWarmup: boolean; source: string }[] }

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const s = useApi<Session>(`/api/training/sessions/${id}`);
  const toast = useToast();
  const { ask, dialog: promptDialog } = usePrompt();
  const { confirm, dialog: confirmDialog } = useConfirm();
  if (s.error) return <ErrorBox error={s.error} retry={s.reload} />;
  if (!s.data) return <Spinner />;
  const d = s.data;
  const byEx = new Map<string, Session["sets"]>();
  for (const set of d.sets) byEx.set(set.exerciseId, [...(byEx.get(set.exerciseId) ?? []), set]);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/training", label: "Training" }} title={`${fmtDate(d.date, { weekday: "long", day: "numeric", month: "short" })} · ${d.dayName ?? "Session"}`} subtitle={`${d.sets.filter((x) => !x.isWarmup).length} sets · volume ${fmtNum(d.volume, 0)} kg${d.durationMinutes ? ` · ${d.durationMinutes} min` : ""}${d.finishedAt ? "" : " · still open"}`} action={<><button className="btn-ghost btn-sm" onClick={() => ask(async (v) => { await api(`/api/training/sessions/${id}`, { method: "PATCH", json: { notes: v || null } }); s.refresh(); toast.success("Notes saved"); }, { title: "Session notes", label: "Notes", type: "textarea", initial: d.notes ?? "", placeholder: "How it went, what to change next time…" })}>Notes</button><button className="btn-ghost btn-sm text-negative" onClick={() => confirm(async () => { await api(`/api/training/sessions/${id}`, { method: "DELETE" }); toast.success("Session deleted"); router.push("/training"); }, { title: "Delete this session?", description: `Its ${d.sets.length} logged sets go with it. Personal records already earned are kept.` })}>Delete</button></>} />
      {d.notes && <p className="text-sm">{d.notes}</p>}
      {[...byEx.entries()].map(([exId, sets]) => (
        <Card key={exId} title={<Link href={`/training/exercises/${exId}`} className="hover:underline">{sets[0].exerciseName}</Link>}>
          <ul className="flex flex-wrap gap-1.5">{sets.map((x) => <li key={x.id} className={"pill " + (x.isWarmup ? "opacity-60" : "")}>#{x.setNumber} {x.seconds ? `${x.seconds}s` : `${x.weightKg ?? 0} kg × ${x.reps ?? 0}`}{x.rpe ? ` @${x.rpe}` : ""}{x.isWarmup && <Badge className="ml-1">warm-up</Badge>}<Source source={x.source === "ai" ? "ai" : null} /></li>)}</ul>
        </Card>
      ))}
      {d.sets.length === 0 && <p className="text-sm muted">No sets logged in this session yet — log them from <Link className="link" href="/training">Training</Link> while you train.</p>}
      {promptDialog}
      {confirmDialog}
    </div>
  );
}
