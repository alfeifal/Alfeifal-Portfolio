"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Sparkles, ArrowUpRight, Dumbbell, BookOpen, CalendarPlus, GraduationCap, Wallet, CheckSquare } from "lucide-react";
import { Card, Bar, ErrorBox, Badge, Source, Stat, Checkbox, SkeletonStats, SkeletonCards } from "@/components/ui";
import { Stagger, StaggerItem, FadeIn, m, T, AnimatedNumber } from "@/components/motion";
import { api, fmtDate, fmtMoney, fmtNum, fmtTime, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";
import { useToast } from "@/components/toast";
import type { DashboardData } from "@/lib/types";

const QUICK = [
  { label: "Expense", icon: Wallet, href: "/finance?new=tx" },
  { label: "Task", icon: CheckSquare, href: "/tasks?new=1" },
  { label: "Workout", icon: Dumbbell, href: "/training" },
  { label: "Study", icon: GraduationCap, href: "/studies?new=session" },
  { label: "Event", icon: CalendarPlus, href: "/calendar?new=1" },
  { label: "Journal", icon: BookOpen, href: "/journal?new=1" },
];
const ASKS = ["What should I do today?", "How am I doing financially this month?", "What did I accomplish this week?", "Plan tomorrow"];

export default function HomePage() {
  const { user, aiConfigured, openQuick } = useShell();
  const toast = useToast();
  const { data, error, loading, reload, refresh, setData } = useApi<DashboardData>("/api/dashboard");
  const router = useRouter();
  const [ask, setAsk] = useState("");
  const submitAsk = (e: React.FormEvent) => { e.preventDefault(); if (ask.trim()) router.push(`/assistant?q=${encodeURIComponent(ask)}`); };
  const complete = async (id: string, title: string) => {
    setData((d) => d ? { ...d, tasks: { ...d.tasks, today: d.tasks.today.filter((t) => t.id !== id), overdue: d.tasks.overdue.filter((t) => t.id !== id) } } : d!);
    try { await api(`/api/tasks/${id}/complete`, { method: "POST" }); toast.success("Task completed", title); } catch (e) { toast.error("Could not complete task", (e as Error).message); } finally { refresh(); }
  };
  const hour = new Date().getHours();
  const greet = hour < 13 ? "Good morning" : hour < 19 ? "Good afternoon" : "Good evening";
  if (error) return <ErrorBox error={error} retry={reload} />;
  const d = data;
  const has = (w: string) => !d || d.widgets.includes(w as never);
  const todayTasks = d ? [...d.tasks.overdue, ...d.tasks.today.filter((t) => !d.tasks.overdue.some((o) => o.id === t.id))] : [];
  const todayEvents = d ? d.events.filter((e) => e.startAt.slice(0, 10) === d.today) : [];
  const cur = user.currency;

  return (
    <Stagger className="space-y-5" gap={0.06}>
      <StaggerItem>
        <p className="text-sm muted">{greet}, {user.name.split(" ")[0]}</p>
        <h1 className="h1">{fmtDate(d?.today ?? new Date(), { weekday: "long", day: "numeric", month: "long" })}</h1>
      </StaggerItem>

      <StaggerItem>
        <form onSubmit={submitAsk} className="card flex items-center gap-2 p-1.5 pl-3 transition-[box-shadow,border-color] duration-150 focus-within:border-fg/30 focus-within:shadow-lg focus-within:shadow-black/5">
          <Sparkles size={16} className="shrink-0 muted" />
          <input className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-muted/70" placeholder={aiConfigured ? "Ask your Personal OS…" : "AI not configured — set ANTHROPIC_API_KEY"} value={ask} onChange={(e) => setAsk(e.target.value)} disabled={!aiConfigured} />
          <button className="btn-primary btn-sm" disabled={!ask.trim() || !aiConfigured}>Ask</button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ASKS.map((q) => <Link key={q} href={`/assistant?q=${encodeURIComponent(q)}`} className="pill transition-colors hover:bg-border">{q}</Link>)}
        </div>
      </StaggerItem>

      <StaggerItem>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          <m.button whileTap={{ scale: 0.96 }} transition={T.state} onClick={openQuick} className="btn-primary btn-sm shrink-0 !rounded-full"><Sparkles size={13} />Quick entry</m.button>
          {QUICK.map((q) => <m.span key={q.label} whileTap={{ scale: 0.96 }} transition={T.state} className="shrink-0"><Link href={q.href} className="btn-subtle btn-sm !rounded-full"><Plus size={13} />{q.label}</Link></m.span>)}
        </div>
      </StaggerItem>

      {loading && !d ? <StaggerItem><SkeletonStats /><div className="mt-3"><SkeletonCards n={4} /></div></StaggerItem> : d && (
        <>
          {has("finance") && d.finance && (
            <StaggerItem>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label="Net this month" count={d.finance.net} format={(v) => fmtMoney(v, cur)} tone={d.finance.net >= 0 ? "positive" : "negative"} sub={d.finance.savingsRate != null ? `savings rate ${d.finance.savingsRate}%` : "no income yet"} href="/finance" />
                <Stat label="Tasks today" count={d.tasks.counts.today} format={(v) => String(Math.round(v))} sub={`${d.tasks.counts.overdue} overdue · ${d.tasks.counts.open} open`} tone={d.tasks.counts.overdue ? "warning" : undefined} href="/tasks" />
                <Stat label="Workouts this week" count={d.training.week?.completed ?? 0} format={(v) => String(Math.round(v))} tone={d.training.week && d.training.week.plannedSoFar != null && d.training.week.completed < d.training.week.plannedSoFar ? "warning" : undefined} sub={d.training.week?.plannedDays != null ? `${d.training.week.completed}/${d.training.week.plannedDays} training days in cycle${d.training.workout?.day ? ` · today: ${d.training.workout.day.isRest ? "rest" : d.training.workout.day.name}` : ""}` : "no active plan"} href="/training" />
                <Stat label="Cash (Finance)" count={d.finance.financeBalance} format={(v) => fmtMoney(v, cur)} sub={`${d.finance.accounts.length} accounts · excludes investing & trading`} href="/finance" />
              </div>
            </StaggerItem>
          )}

          <StaggerItem>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {has("today") && (
                <Card title="Today" href="/tasks" kind="interactive" className="lg:col-span-2">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider muted">Tasks</p>
                      {todayTasks.length === 0 ? (
                        <div className="rounded-xl bg-surface-2/60 p-3 text-sm"><p className="font-medium">Nothing due today.</p><p className="text-xs muted">You&apos;ve cleared everything for today.</p><Link href="/planner" className="link mt-1 inline-block text-xs">Plan tomorrow →</Link></div>
                      ) : (
                        <ul className="space-y-1">{todayTasks.slice(0, 7).map((t) => (
                          <m.li key={t.id} layout="position" className="row -mx-2 flex items-center gap-2 rounded-lg px-2 py-1 text-sm"><Checkbox checked={false} onChange={() => complete(t.id, t.title)} label={`Complete ${t.title}`} size={17} /><span className="min-w-0 flex-1 truncate">{t.title}</span>{t.dueDate && t.dueDate < d.today && <Badge tone="negative">overdue</Badge>}{t.priority === "urgent" && <Badge tone="warning">urgent</Badge>}</m.li>
                        ))}</ul>
                      )}
                    </div>
                    <div>
                      <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider muted">Calendar</p>
                      {todayEvents.length === 0 ? <p className="text-sm muted">Nothing scheduled. <Link className="link" href="/calendar?new=1">Add an event</Link></p> : (
                        <ul className="space-y-1">{todayEvents.slice(0, 6).map((e) => <li key={e.id} className="flex items-center gap-2 text-sm"><span className="w-11 shrink-0 text-xs muted tnum">{e.allDay ? "all day" : fmtTime(e.startAt)}</span><span className="truncate">{e.title}</span><span className="pill ml-auto">{e.kind}</span></li>)}</ul>
                      )}
                      {d.training.workout && (
                        <p className="mt-3 text-sm"><span className="text-[10.5px] font-medium uppercase tracking-wider muted">Training · </span>{d.training.workout.day ? d.training.workout.day.isRest ? <span>Rest day — {d.training.workout.day.notes}</span> : <Link className="link" href="/training">{d.training.workout.day.name} · {d.training.workout.day.exercises.length} exercises</Link> : "no plan"}{d.training.workout.session?.finishedAt && <Badge tone="positive" className="ml-2">done</Badge>}</p>
                      )}
                      {d.nutrition && <p className="mt-1 text-sm"><span className="text-[10.5px] font-medium uppercase tracking-wider muted">Nutrition · </span><AnimatedNumber value={d.nutrition.totals.calories} format={(v) => fmtNum(v, 0)} /> / {d.nutrition.goals.calories} kcal · {fmtNum(d.nutrition.totals.protein, 0)} g protein{d.nutrition.estimatedItems > 0 && <Source source="estimated" />}</p>}
                    </div>
                  </div>
                </Card>
              )}
              {has("finance") && d.finance && (
                <Card title="Finance" href="/finance" kind="interactive">
                  <div className="mb-2 grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-xs muted">Income</p><p className="font-semibold tnum text-positive">{fmtMoney(d.finance.income, cur)}</p></div>
                    <div><p className="text-xs muted">Expenses</p><p className="font-semibold tnum text-negative">{fmtMoney(d.finance.expenses, cur)}</p></div>
                    <div><p className="text-xs muted">Net</p><p className="font-semibold tnum">{fmtMoney(d.finance.net, cur)}</p></div>
                  </div>
                  {d.finance.recent.length ? <ul className="divide-y divide-border text-sm">{d.finance.recent.slice(0, 4).map((t) => <li key={t.id} className="flex justify-between py-1"><span className="truncate">{t.description || t.categoryName || t.type}</span><span className={t.type === "income" ? "text-positive tnum" : "tnum"}>{t.type === "income" ? "+" : "−"}{fmtMoney(t.amount, cur)}</span></li>)}</ul> : <p className="text-sm muted">No transactions yet. <Link className="link" href="/finance?new=tx">Add the first one</Link>.</p>}
                  {d.finance.savings.slice(0, 2).map((s) => <div key={s.id} className="mt-2"><div className="flex justify-between text-xs"><span>{s.name}</span><span className="muted">{fmtMoney(s.currentAmount, cur)} / {fmtMoney(s.targetAmount, cur)}</span></div><Bar value={s.targetAmount ? s.currentAmount / s.targetAmount : 0} tone="positive" /></div>)}
                </Card>
              )}
              {has("goals") && (
                <Card title="Goals" href="/goals" kind="interactive">
                  {d.goals.length === 0 ? <p className="text-sm muted">No active goals. <Link className="link" href="/goals">Set one</Link>.</p> : <ul className="space-y-2">{d.goals.slice(0, 5).map((g) => <li key={g.id}><Link href={`/goals/${g.id}`} className="flex justify-between text-sm hover:underline"><span className="truncate">{g.name}</span><span className="muted tnum">{g.progress}%{g.deadline ? ` · ${fmtDate(g.deadline)}` : ""}</span></Link><Bar value={g.progress / 100} h={4} /></li>)}</ul>}
                </Card>
              )}
              {has("projects") && (
                <Card title="Projects" href="/projects" kind="interactive">
                  {d.projects.length === 0 ? <p className="text-sm muted">No active projects.</p> : <ul className="space-y-1.5">{d.projects.slice(0, 5).map((p) => <li key={p.id}><Link href={`/projects/${p.id}`} className="flex items-center justify-between text-sm hover:underline"><span className="truncate">{p.name}</span><span className="muted text-xs">{p.openTasks} open · {p.computedProgress}%</span></Link></li>)}</ul>}
                </Card>
              )}
              {has("training") && (
                <Card title="Training" href="/training" kind="interactive">
                  {d.training.recent.length === 0 ? <p className="text-sm muted">No workouts logged yet. <Link className="link" href="/training">Open today&apos;s workout</Link>.</p> : <ul className="divide-y divide-border text-sm">{d.training.recent.map((s) => <li key={s.id} className="flex justify-between py-1"><Link href={`/training/sessions/${s.id}`} className="truncate hover:underline">{fmtDate(s.date)} · {s.dayName ?? "Workout"}</Link><span className="muted text-xs tnum">{s.isWorkout ? <>{s.sets} sets · {fmtNum(s.volume, 0)} kg</> : s.status === "started" ? "open · no sets" : "no sets logged"}</span></li>)}</ul>}
                </Card>
              )}
              {has("studies") && d.studies && (
                <Card title="Studies & German" href="/studies" kind="interactive">
                  <p className="text-sm"><AnimatedNumber value={d.studies.totalMinutes} /> min studied in the last 7 days</p>
                  <ul className="mt-1 space-y-1 text-sm">{d.studies.bySubject.slice(0, 4).map((s) => <li key={s.name} className="flex justify-between"><span>{s.name}</span><span className="muted tnum">{s.minutes} min{s.weeklyGoalMinutes ? ` / ${s.weeklyGoalMinutes}` : ""}</span></li>)}</ul>
                  {d.studies.german && <p className="mt-2 text-sm"><Link className="link" href="/german">German</Link>: 🔥 {d.studies.german.streak} · {d.studies.german.unitsPassed}/28 units · {d.studies.german.xp} XP</p>}
                  {d.studies.exams.length > 0 && <p className="mt-2 text-xs muted">Next exam: {d.studies.exams[0].title} · {fmtDate(d.studies.exams[0].date)}</p>}
                </Card>
              )}
              {has("investing") && (
                <Card title="Investing" href="/investing" kind="interactive">
                  {!d.investing || (d.investing.positions.length === 0 && d.investing.cash === 0) ? <p className="text-sm muted">No investments recorded.</p> : (
                    <>
                      <p className="text-xl font-semibold tnum"><AnimatedNumber value={d.investing.totalValue + d.investing.cash} format={(v) => fmtMoney(v, cur)} /></p>
                      <p className="text-xs muted">cost {fmtMoney(d.investing.totalCost, cur)} · unrealized <span className={d.investing.unrealized >= 0 ? "text-positive" : "text-negative"}>{fmtMoney(d.investing.unrealized, cur)}</span>{d.investing.unpriced.length > 0 && ` · ${d.investing.unpriced.length} unpriced`}</p>
                      <ul className="mt-2 space-y-1 text-sm">{d.investing.positions.slice(0, 4).map((p) => <li key={p.asset.id} className="flex justify-between"><span>{p.asset.symbol}</span><span className="muted tnum">{p.value != null ? fmtMoney(p.value, cur) : "no price"}</span></li>)}</ul>
                    </>
                  )}
                </Card>
              )}
              {has("trading") && (
                <Card title="Trading" href="/trading" kind="interactive">
                  <p className="mb-1 text-xs muted">Open positions: {d.trading.openTrades.length}</p>
                  {d.trading.openTrades.slice(0, 3).map((t) => <p key={t.id} className="text-sm">{t.symbol} {t.direction} <Badge tone={t.mode === "real" ? "warning" : "muted"}>{t.mode}</Badge></p>)}
                  <p className="mt-2 text-xs muted">Watchlist: {d.trading.watchlists.flatMap((w) => w.items).map((i) => i.symbol).join(", ") || "empty"}</p>
                  {d.trading.economicEvents.length > 0 && <p className="mt-2 text-xs">Upcoming: {d.trading.economicEvents.map((e) => e.title).join(" · ")}</p>}
                </Card>
              )}
              {has("news") && (
                <Card title="Market news" href="/news" kind="interactive" className="md:col-span-2 lg:col-span-3">
                  {d.news.length === 0 ? <p className="text-sm muted">No headlines cached yet. <Link className="link" href="/news">Open Market News</Link> to fetch the feeds.</p> : <ul className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">{d.news.map((n) => <li key={n.id} className="truncate"><a href={n.url} target="_blank" rel="noreferrer" className="group inline-flex max-w-full items-center gap-1 hover:underline"><span className="truncate">{n.headline}</span><ArrowUpRight size={12} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60" /></a> <span className="text-xs muted">· {n.source}</span></li>)}</ul>}
                </Card>
              )}
            </div>
          </StaggerItem>
          <StaggerItem><FadeIn><p className="text-xs muted">Configure widgets in <Link className="link" href="/settings">Settings</Link>.</p></FadeIn></StaggerItem>
        </>
      )}
    </Stagger>
  );
}
