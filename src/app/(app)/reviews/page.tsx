"use client";
import { useState } from "react";
import { Card, ErrorBox, Markdown, PageHeader, Spinner, Tabs } from "@/components/ui";
import { api, fmtDate, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";

interface Report { id: string; kind: string; periodKey: string; content: string; createdAt: string }

/** Daily and weekly AI reviews (spec §28, §29). */
export default function ReviewsPage() {
  const { aiConfigured } = useShell();
  const [kind, setKind] = useState<"daily_review" | "weekly_review">("daily_review");
  const reports = useApi<Report[]>(`/api/ai/reports/${kind}?all=1`, [kind]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generate = async () => { setBusy(true); setError(""); try { await api(`/api/ai/reports/${kind}`, { method: "POST" }); reports.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <PageHeader title="Reviews" subtitle="AI-written daily and weekly reviews built only from your stored data." action={<button className="btn-primary btn-sm" disabled={busy || !aiConfigured} onClick={generate}>{busy ? "Writing…" : kind === "daily_review" ? "Generate today's review" : "Generate this week's review"}</button>} />
      <Tabs value={kind} onChange={setKind} options={[{ value: "daily_review", label: "Daily" }, { value: "weekly_review", label: "Weekly" }]} />
      {error && <p className="text-sm text-negative">{error}</p>}
      {reports.error && <ErrorBox error={reports.error} retry={reports.reload} />}
      {!reports.data ? <Spinner /> : reports.data.length === 0 ? <Card><p className="text-sm muted">No reviews yet.</p></Card> : reports.data.map((r) => <Card key={r.id} title={`${r.periodKey}`} action={<span className="text-xs muted">{fmtDate(r.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}><Markdown text={r.content} /></Card>)}
    </div>
  );
}
