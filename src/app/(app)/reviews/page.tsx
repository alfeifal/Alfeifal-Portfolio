"use client";
import { useState } from "react";
import { Card, ErrorBox, Markdown, PageHeader, Spinner, Tabs, Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Stagger, StaggerItem } from "@/components/motion";
import { api, fmtDate, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";

interface Report { id: string; kind: string; periodKey: string; content: string; createdAt: string }

/** Daily and weekly AI reviews (spec §28, §29). */
export default function ReviewsPage() {
  const { aiConfigured } = useShell();
  const toast = useToast();
  const [kind, setKind] = useState<"daily_review" | "weekly_review">("daily_review");
  const reports = useApi<Report[]>(`/api/ai/reports/${kind}?all=1`, [kind]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generate = async () => { setBusy(true); setError(""); try { await api(`/api/ai/reports/${kind}`, { method: "POST" }); reports.refresh(); toast.success(kind === "daily_review" ? "Daily review ready" : "Weekly review ready"); } catch (e) { setError((e as Error).message); toast.error("Review failed", (e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <PageHeader title="Reviews" subtitle="AI-written daily and weekly reviews built only from your stored data." action={<Button variant="primary" size="sm" loading={busy} disabled={!aiConfigured} onClick={generate}>{kind === "daily_review" ? "Generate today's review" : "Generate this week's review"}</Button>} />
      <Tabs value={kind} onChange={setKind} options={[{ value: "daily_review", label: "Daily" }, { value: "weekly_review", label: "Weekly" }]} />
      {error && <p className="text-sm text-negative">{error}</p>}
      {reports.error && <ErrorBox error={reports.error} retry={reports.reload} />}
      {!reports.data ? <Spinner /> : reports.data.length === 0 ? <Card><p className="text-sm muted">No reviews yet.</p></Card> : <Stagger className="space-y-4">{reports.data.map((r) => <StaggerItem key={r.id}><Card title={`${r.periodKey}`} action={<span className="text-xs muted">{fmtDate(r.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}><Markdown text={r.content} /></Card></StaggerItem>)}</Stagger>}
    </div>
  );
}
