"use client";
import Link from "next/link";
import { Empty, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { fmtDate, useApi } from "@/lib/client";
interface PR { id: string; exerciseId: string; exerciseName: string; kind: string; value: number; reps: number | null; weightKg: number | null; achievedAt: string }
export default function RecordsPage() {
  const prs = useApi<PR[]>("/api/training/records");
  if (prs.error) return <ErrorBox error={prs.error} retry={prs.reload} />;
  const byEx = new Map<string, PR[]>();
  for (const p of prs.data ?? []) byEx.set(p.exerciseName, [...(byEx.get(p.exerciseName) ?? []), p]);
  return <div className="space-y-3"><PageHeader back={{ href: "/training", label: "Training" }} title="Personal records" subtitle="Calculated from your logged sets (Epley for estimated 1RM)." />{!prs.data ? <Spinner /> : prs.data.length === 0 ? <Empty>No records yet — log your first sets.</Empty> : <ul className="card divide-y divide-border">{[...byEx.entries()].map(([name, list]) => <li key={name} className="px-3 py-2 text-sm"><Link href={`/training/exercises/${list[0].exerciseId}`} className="font-medium hover:underline">{name}</Link><p className="text-xs muted">{list.map((p) => `${p.kind.replace(/_/g, " ")}: ${p.value}${p.weightKg != null && p.reps != null ? ` (${p.weightKg}×${p.reps})` : ""} · ${fmtDate(p.achievedAt)}`).join(" · ")}</p></li>)}</ul>}</div>;
}
