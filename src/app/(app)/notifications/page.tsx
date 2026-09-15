"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, SkeletonList } from "@/components/ui";
import { Bell } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { T } from "@/components/motion";
import { api, fmtDate, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";

interface N { id: string; kind: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string }
interface Settings { tasks: boolean; deadlines: boolean; events: boolean; study: boolean; training: boolean; goals: boolean; finance: boolean; market: boolean; eventLeadMinutes: number; deadlineLeadDays: number; budgetWarnPct: number; studyQuietDays: number }

export default function NotificationsPage() {
  const { refreshUnread } = useShell();
  const list = useApi<{ items: N[]; unread: number }>("/api/notifications?generate=1&limit=100");
  const settings = useApi<Settings>("/api/notifications/settings");
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { if (settings.data) setS(settings.data); }, [settings.data]);
  const markAll = async () => { await api("/api/notifications/read", { method: "POST", json: { ids: "all" } }); list.refresh(); refreshUnread(); };
  const markOne = async (id: string) => { await api("/api/notifications/read", { method: "POST", json: { ids: [id] } }); list.refresh(); refreshUnread(); };
  const saveSettings = async (patch: Partial<Settings>) => { const next = { ...s!, ...patch }; setS(next); await api("/api/notifications/settings", { method: "PATCH", json: patch }); };
  return (
    <div className="space-y-4">
      <PageHeader title="Notifications" subtitle="Generated from your own data: tasks, deadlines, events, exams, goals, training, budgets, study consistency and price alerts." action={<button className="btn-ghost btn-sm" onClick={markAll}>Mark all read</button>} />
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {!list.data ? <SkeletonList rows={4} /> : list.data.items.length === 0 ? <Empty icon={<Bell size={18} />} title="Nothing to report">Reminders for tasks, deadlines, events, exams, goals, training, budgets, study consistency and price alerts will show up here.</Empty> : (
        <ul className="card divide-y divide-border overflow-hidden"><AnimatePresence initial={false}>{list.data.items.map((n) => <m.li key={n.id} layout="position" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, x: 24 }} transition={T.enter} className={"row flex items-start gap-3 px-3 py-2.5 text-sm transition-opacity " + (n.readAt ? "opacity-60" : "")}><Badge>{n.kind}</Badge><div className="min-w-0 flex-1">{n.href ? <Link href={n.href} className="font-medium hover:underline" onClick={() => markOne(n.id)}>{n.title}</Link> : <p className="font-medium">{n.title}</p>}{n.body && <p className="text-xs muted">{n.body}</p>}<p className="text-[11px] muted">{fmtDate(n.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p></div>{!n.readAt && <button className="btn-ghost btn-sm" onClick={() => markOne(n.id)}>✓</button>}<button className="btn-ghost btn-sm" onClick={async () => { await api(`/api/notifications/${n.id}`, { method: "DELETE" }); list.refresh(); refreshUnread(); }}>✕</button></m.li>)}</AnimatePresence></ul>
      )}
      <Card title="Notification settings">
        {!s ? <Spinner /> : <div className="grid gap-2 sm:grid-cols-2">
          {(["tasks", "deadlines", "events", "study", "training", "goals", "finance", "market"] as const).map((k) => <label key={k} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm capitalize"><span>{k}</span><input type="checkbox" checked={s[k]} onChange={(e) => saveSettings({ [k]: e.target.checked })} /></label>)}
          <label className="text-sm">Event reminder lead (minutes)<input className="field mt-1" type="number" value={s.eventLeadMinutes} onChange={(e) => saveSettings({ eventLeadMinutes: Number(e.target.value) })} /></label>
          <label className="text-sm">Deadline lead (days)<input className="field mt-1" type="number" value={s.deadlineLeadDays} onChange={(e) => saveSettings({ deadlineLeadDays: Number(e.target.value) })} /></label>
          <label className="text-sm">Budget warning (%)<input className="field mt-1" type="number" min={50} max={100} value={s.budgetWarnPct} onChange={(e) => saveSettings({ budgetWarnPct: Number(e.target.value) })} /></label>
          <label className="text-sm">Study quiet streak (days)<input className="field mt-1" type="number" min={1} max={30} value={s.studyQuietDays} onChange={(e) => saveSettings({ studyQuietDays: Number(e.target.value) })} /></label>
        </div>}
        <p className="mt-2 text-xs muted">Notifications are generated when you open the app and hourly by the cron endpoint (see docs/DEPLOYMENT.md).</p>
      </Card>
    </div>
  );
}
