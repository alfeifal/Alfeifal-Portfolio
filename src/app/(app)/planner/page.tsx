"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, ErrorBox, Markdown, PageHeader, Spinner, Badge, Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { addDays, api, fmtDate, fmtTime, todayLocal, useApi } from "@/lib/client";
import type { EventItem, Goal, Plan, Project, Task } from "@/lib/types";
import { useShell } from "@/components/shell/Shell";
import { ActionList, type Action } from "@/components/ai/ActionList";
import { PlanCard } from "@/components/planner/PlanCard";

function startOfWeek(key: string) { const d = new Date(key + "T00:00:00"); const dow = (d.getDay() + 6) % 7; return addDays(key, -dow); }

/** Weekly planner (spec §24, §45): one screen for work, training, studies, German, tasks, goals, projects; the AI can optimise it. */
export default function PlannerPage() {
  const { aiConfigured } = useShell();
  const toast = useToast();
  const [weekStart, setWeekStart] = useState(startOfWeek(todayLocal()));
  const days = useMemo(() => [...Array(7)].map((_, i) => addDays(weekStart, i)), [weekStart]);
  const events = useApi<EventItem[]>(`/api/events?from=${weekStart}T00:00:00&to=${addDays(weekStart, 7)}T00:00:00`, [weekStart]);
  const tasks = useApi<Task[]>("/api/tasks?view=all&limit=300");
  const goals = useApi<Goal[]>("/api/goals?status=active");
  const projects = useApi<Project[]>("/api/projects?status=active");
  const training = useApi<{ days: { dayIndex: number; name: string; isRest: boolean }[]; startDate: string; cycleLength: number }>("/api/training/plan");
  const dayPlan = useApi<{ current: Plan | null }>("/api/planner?horizon=day");
  const weekPlan = useApi<{ current: Plan | null }>("/api/planner?horizon=week");
  const refreshPlans = () => { dayPlan.refresh(); weekPlan.refresh(); events.refresh(); tasks.refresh(); };
  const [plan, setPlan] = useState<{ text: string; actions: Action[]; pending: Action[]; conversationId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const run = async (horizon: "today" | "week") => {
    setBusy(true); setError("");
    try { const r = await api<typeof plan & object>("/api/ai/planner", { method: "POST", json: { horizon, instructions: instructions || undefined, conversationId: plan?.conversationId } }); setPlan(r); refreshPlans(); toast.success("Plan saved as a draft", "Nothing was created yet — accept it to turn it into tasks and events"); } catch (e) { setError((e as Error).message); toast.error("Planner failed", (e as Error).message); } finally { setBusy(false); }
  };
  const cycleDay = (k: string) => { if (!training.data) return null; const diff = Math.round((new Date(k + "T00:00:00").getTime() - new Date(training.data.startDate + "T00:00:00").getTime()) / 86400e3); const idx = ((diff % training.data.cycleLength) + training.data.cycleLength) % training.data.cycleLength; return training.data.days.find((d) => d.dayIndex === idx) ?? null; };
  const dayEvents = (k: string) => (events.data ?? []).filter((e) => e.startAt.slice(0, 10) === k || (e.allDay && e.startAt.slice(0, 10) <= k && e.endAt.slice(0, 10) > k));
  const dayTasks = (k: string) => (tasks.data ?? []).filter((t) => t.dueDate === k && t.status !== "done" && t.status !== "cancelled");
  return (
    <div className="space-y-4">
      <PageHeader title="Weekly planner" subtitle={`${fmtDate(weekStart)} – ${fmtDate(addDays(weekStart, 6))}`} action={<><button className="btn-ghost btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>←</button><button className="btn-ghost btn-sm" onClick={() => setWeekStart(startOfWeek(todayLocal()))}>This week</button><button className="btn-ghost btn-sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>→</button></>} />
      {events.error && <ErrorBox error={events.error} retry={events.reload} />}
      {events.loading && !events.data && <Spinner />}
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((k) => { const td = cycleDay(k); return (
          <div key={k} className={"card p-2 " + (k === todayLocal() ? "border-accent" : "")}>
            <p className="text-sm font-semibold">{fmtDate(k, { weekday: "short", day: "numeric" })}</p>
            {td && <p className="text-[11px]"><Badge tone={td.isRest ? "muted" : "positive"}>{td.isRest ? "rest" : td.name}</Badge></p>}
            <ul className="mt-1 space-y-0.5 text-xs">{dayEvents(k).map((e) => <li key={e.id} className="truncate"><span className="muted">{e.allDay ? "day" : fmtTime(e.startAt)}</span> {e.title}</li>)}</ul>
            <ul className="mt-1 space-y-0.5 text-xs">{dayTasks(k).map((t) => <li key={t.id} className="truncate">☐ {t.title}</li>)}</ul>
          </div>); })}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Goals in play" href="/goals">{goals.data?.length ? <ul className="text-sm">{goals.data.slice(0, 6).map((g) => <li key={g.id} className="flex justify-between"><span className="truncate">{g.name}</span><span className="muted">{g.progress}%{g.deadline ? " · " + fmtDate(g.deadline) : ""}</span></li>)}</ul> : <p className="text-sm muted">No active goals.</p>}</Card>
        <Card title="Projects in play" href="/projects">{projects.data?.length ? <ul className="text-sm">{projects.data.slice(0, 6).map((p) => <li key={p.id} className="flex justify-between"><span className="truncate">{p.name}</span><span className="muted">{p.openTasks} open{p.deadline ? " · " + fmtDate(p.deadline) : ""}</span></li>)}</ul> : <p className="text-sm muted">No active projects.</p>}</Card>
      </div>
      {(dayPlan.data?.current || weekPlan.data?.current) && (
        <div className="space-y-2">
          {dayPlan.data?.current && <PlanCard plan={dayPlan.data.current} onChanged={refreshPlans} />}
          {weekPlan.data?.current && <PlanCard plan={weekPlan.data.current} onChanged={refreshPlans} />}
        </div>
      )}
      <Card title="AI planner">
        {!aiConfigured && <p className="mb-2 text-sm muted">AI not configured.</p>}
        <textarea className="field" rows={2} placeholder="Constraints, e.g. “I work Mon–Fri 10–18, gym after work, German after dinner, exam Friday”" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        <p className="mt-1.5 text-xs muted">The assistant always saves a draft: nothing reaches your calendar or tasks until you accept it.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={busy} disabled={!aiConfigured} onClick={() => run("today")}>Plan today</Button>
          <Button variant="primary" size="sm" disabled={busy || !aiConfigured} onClick={() => run("week")}>Organize my week</Button>
        </div>
        {busy && <Spinner label="Planning…" />}
        {error && <p className="mt-2 text-sm text-negative">{error}</p>}
        {plan && <div className="mt-3 space-y-2"><Markdown text={plan.text} /><ActionList actions={plan.actions} pending={plan.pending} onChanged={() => { events.refresh(); tasks.refresh(); }} /><p className="text-xs muted">Continue this plan in the <Link className="link" href="/assistant">Assistant</Link>.</p></div>}
      </Card>
    </div>
  );
}
