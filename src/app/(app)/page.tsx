"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, Bar, Empty, ErrorBox, Skeleton, Badge, Source } from "@/components/ui";
import { api, fmtDate, fmtMoney, fmtNum, fmtTime, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";
import type { DashboardData } from "@/lib/types";

export default function HomePage() {
  const { user, aiConfigured } = useShell();
  const { data, error, loading, reload, refresh } = useApi<DashboardData>("/api/dashboard");
  const router = useRouter();
  const [ask, setAsk] = useState("");
  const submitAsk = (e: React.FormEvent) => { e.preventDefault(); if (ask.trim()) router.push(`/assistant?q=${encodeURIComponent(ask)}`); };
  const complete = async (id: string) => { await api(`/api/tasks/${id}/complete`, { method: "POST" }); refresh(); };
  const hour = new Date().getHours();
  const greet = hour < 13 ? "Good morning" : hour < 19 ? "Good afternoon" : "Good evening";
  if (error) return <ErrorBox error={error} retry={reload} />;
  const d = data;
  const has = (w: string) => !d || d.widgets.includes(w as never);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm muted">{greet}, {user.name.split(" ")[0]}</p>
        <h1 className="h1">Today · {fmtDate(d?.today ?? new Date(), { weekday: "long", day: "numeric", month: "long" })}</h1>
      </div>
      <form onSubmit={submitAsk} className="card flex items-center gap-2 p-2">
        <input className="field !border-0 !ring-0" placeholder={aiConfigured ? "Ask your Personal OS… “What should I prioritize today?”" : "AI not configured — set ANTHROPIC_API_KEY"} value={ask} onChange={(e) => setAsk(e.target.value)} disabled={!aiConfigured} />
        <button className="btn-primary" disabled={!ask.trim() || !aiConfigured}>Ask</button>
      </form>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {["What should I do today?", "How am I doing financially this month?", "What did I accomplish this week?", "What do I train today?"].map((q) => <Link key={q} href={`/assistant?q=${encodeURIComponent(q)}`} className="pill hover:bg-border">{q}</Link>)}
      </div>

      {loading && !d ? <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div> : d && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {has("today") && (
            <Card title="Today" href="/tasks" className="lg:col-span-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide muted">Tasks · {d.tasks.counts.today} today · {d.tasks.counts.overdue} overdue</p>
                  {d.tasks.overdue.length + d.tasks.today.length === 0 ? <p className="text-sm muted">No tasks due. <Link className="link" href="/tasks">Add one</Link>.</p> : (
                    <ul className="space-y-1">{[...d.tasks.overdue, ...d.tasks.today.filter((t) => !d.tasks.overdue.some((o) => o.id === t.id))].slice(0, 7).map((t) => (
                      <li key={t.id} className="flex items-center gap-2 text-sm"><button onClick={() => complete(t.id)} className="h-4 w-4 shrink-0 rounded border border-border hover:bg-positive/20" aria-label="Complete" /><span className="min-w-0 flex-1 truncate">{t.title}</span>{t.dueDate && t.dueDate < d.today && <Badge tone="negative">overdue</Badge>}{t.priority === "urgent" && <Badge tone="warning">urgent</Badge>}</li>
                    ))}</ul>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide muted">Calendar</p>
                  {d.events.filter((e) => e.startAt.slice(0, 10) === d.today).length === 0 ? <p className="text-sm muted">Nothing scheduled today.</p> : (
                    <ul className="space-y-1">{d.events.filter((e) => e.startAt.slice(0, 10) === d.today).slice(0, 6).map((e) => <li key={e.id} className="flex items-center gap-2 text-sm"><span className="w-11 shrink-0 text-xs muted tnum">{e.allDay ? "all day" : fmtTime(e.startAt)}</span><span className="truncate">{e.title}</span><span className="pill ml-auto">{e.kind}</span></li>)}</ul>
                  )}
                  {d.training.workout && (
                    <p className="mt-3 text-sm"><span className="text-xs font-medium uppercase tracking-wide muted">Training · </span>{d.training.workout.day ? d.training.workout.day.isRest ? <span>Rest day — {d.training.workout.day.notes}</span> : <Link className="link" href="/training">{d.training.workout.day.name} · {d.training.workout.day.exercises.length} exercises</Link> : "no plan"}{d.training.workout.session?.finishedAt && <Badge tone="positive" className="ml-2">done</Badge>}</p>
                  )}
                  {d.nutrition && <p className="mt-1 text-sm"><span className="text-xs font-medium uppercase tracking-wide muted">Nutrition · </span>{fmtNum(d.nutrition.totals.calories, 0)} / {d.nutrition.goals.calories} kcal · {fmtNum(d.nutrition.totals.protein, 0)} g protein{d.nutrition.estimatedItems > 0 && <Source source="estimated" />}</p>}
                </div>
              </div>
            </Card>
          )}
          {has("finance") && d.finance && (
            <Card title="Finance" href="/finance">
              <div className="mb-2 grid grid-cols-3 gap-2 text-center">
                <div><p className="text-xs muted">Income</p><p className="font-semibold tnum text-positive">{fmtMoney(d.finance.income, user.currency)}</p></div>
                <div><p className="text-xs muted">Expenses</p><p className="font-semibold tnum text-negative">{fmtMoney(d.finance.expenses, user.currency)}</p></div>
                <div><p className="text-xs muted">Net</p><p className="font-semibold tnum">{fmtMoney(d.finance.net, user.currency)}</p></div>
              </div>
              <p className="mb-2 text-xs muted">This month · savings rate {d.finance.savingsRate != null ? `${d.finance.savingsRate}%` : "n/a"} · net worth {fmtMoney(d.finance.netWorth, user.currency)}</p>
              {d.finance.recent.length ? <ul className="divide-y divide-border text-sm">{d.finance.recent.slice(0, 4).map((t) => <li key={t.id} className="flex justify-between py-1"><span className="truncate">{t.description || t.categoryName || t.type}</span><span className={t.type === "income" ? "text-positive tnum" : "tnum"}>{t.type === "income" ? "+" : "−"}{fmtMoney(t.amount, user.currency)}</span></li>)}</ul> : <p className="text-sm muted">No transactions yet.</p>}
              {d.finance.savings.slice(0, 2).map((s) => <div key={s.id} className="mt-2"><div className="flex justify-between text-xs"><span>{s.name}</span><span className="muted">{fmtMoney(s.currentAmount, user.currency)} / {fmtMoney(s.targetAmount, user.currency)}</span></div><Bar value={s.targetAmount ? s.currentAmount / s.targetAmount : 0} tone="positive" /></div>)}
            </Card>
          )}
          {has("goals") && (
            <Card title="Goals" href="/goals">
              {d.goals.length === 0 ? <p className="text-sm muted">No active goals.</p> : <ul className="space-y-2">{d.goals.slice(0, 5).map((g) => <li key={g.id}><Link href={`/goals/${g.id}`} className="flex justify-between text-sm"><span className="truncate">{g.name}</span><span className="muted tnum">{g.progress}%{g.deadline ? ` · ${fmtDate(g.deadline)}` : ""}</span></Link><Bar value={g.progress / 100} /></li>)}</ul>}
            </Card>
          )}
          {has("projects") && (
            <Card title="Projects" href="/projects">
              {d.projects.length === 0 ? <p className="text-sm muted">No active projects.</p> : <ul className="space-y-1.5">{d.projects.slice(0, 5).map((p) => <li key={p.id}><Link href={`/projects/${p.id}`} className="flex items-center justify-between text-sm"><span className="truncate">{p.name}</span><span className="muted text-xs">{p.openTasks} open · {p.computedProgress}%</span></Link></li>)}</ul>}
            </Card>
          )}
          {has("training") && (
            <Card title="Training" href="/training">
              {d.training.recent.length === 0 ? <p className="text-sm muted">No workouts logged yet. <Link className="link" href="/training">Open today&apos;s workout</Link>.</p> : <ul className="divide-y divide-border text-sm">{d.training.recent.map((s) => <li key={s.id} className="flex justify-between py-1"><Link href={`/training/sessions/${s.id}`} className="truncate hover:underline">{fmtDate(s.date)} · {s.dayName ?? "Workout"}</Link><span className="muted text-xs tnum">{s.sets} sets · {fmtNum(s.volume, 0)} kg</span></li>)}</ul>}
            </Card>
          )}
          {has("studies") && d.studies && (
            <Card title="Studies & German" href="/studies">
              <p className="text-sm">{d.studies.totalMinutes} min studied in the last 7 days</p>
              <ul className="mt-1 space-y-1 text-sm">{d.studies.bySubject.slice(0, 4).map((s) => <li key={s.name} className="flex justify-between"><span>{s.name}</span><span className="muted tnum">{s.minutes} min{s.weeklyGoalMinutes ? ` / ${s.weeklyGoalMinutes}` : ""}</span></li>)}</ul>
              {d.studies.german && <p className="mt-2 text-sm"><Link className="link" href="/german">German</Link>: 🔥 {d.studies.german.streak} · {d.studies.german.unitsPassed}/28 units · {d.studies.german.xp} XP</p>}
              {d.studies.exams.length > 0 && <p className="mt-2 text-xs muted">Next exam: {d.studies.exams[0].title} · {fmtDate(d.studies.exams[0].date)}</p>}
            </Card>
          )}
          {has("investing") && (
            <Card title="Investing" href="/investing">
              {!d.investing || (d.investing.positions.length === 0 && d.investing.cash === 0) ? <p className="text-sm muted">No investments recorded.</p> : (
                <>
                  <p className="text-xl font-semibold tnum">{fmtMoney(d.investing.totalValue + d.investing.cash, user.currency)}</p>
                  <p className="text-xs muted">cost {fmtMoney(d.investing.totalCost, user.currency)} · unrealized <span className={d.investing.unrealized >= 0 ? "text-positive" : "text-negative"}>{fmtMoney(d.investing.unrealized, user.currency)}</span>{d.investing.unpriced.length > 0 && ` · ${d.investing.unpriced.length} unpriced`}</p>
                  <ul className="mt-2 space-y-1 text-sm">{d.investing.positions.slice(0, 4).map((p) => <li key={p.asset.id} className="flex justify-between"><span>{p.asset.symbol}</span><span className="muted tnum">{p.value != null ? fmtMoney(p.value, user.currency) : "no price"}</span></li>)}</ul>
                </>
              )}
            </Card>
          )}
          {has("trading") && (
            <Card title="Trading" href="/trading">
              <p className="mb-1 text-xs muted">Open positions: {d.trading.openTrades.length}</p>
              {d.trading.openTrades.slice(0, 3).map((t) => <p key={t.id} className="text-sm">{t.symbol} {t.direction} <Badge tone={t.mode === "real" ? "warning" : "muted"}>{t.mode}</Badge></p>)}
              <p className="mt-2 text-xs muted">Watchlist: {d.trading.watchlists.flatMap((w) => w.items).map((i) => i.symbol).join(", ") || "empty"}</p>
              {d.trading.economicEvents.length > 0 && <p className="mt-2 text-xs">Upcoming: {d.trading.economicEvents.map((e) => e.title).join(" · ")}</p>}
            </Card>
          )}
          {has("news") && (
            <Card title="Market news" href="/news" className="md:col-span-2 lg:col-span-3">
              {d.news.length === 0 ? <Empty>No news cached yet. <Link className="link" href="/news">Open Market News</Link> to fetch the feeds.</Empty> : <ul className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">{d.news.map((n) => <li key={n.id} className="truncate"><a href={n.url} target="_blank" rel="noreferrer" className="hover:underline">{n.headline}</a> <span className="text-xs muted">· {n.source}</span></li>)}</ul>}
            </Card>
          )}
        </div>
      )}
      <p className="text-xs muted">Configure widgets in <Link className="link" href="/settings">Settings</Link>.</p>
    </div>
  );
}
