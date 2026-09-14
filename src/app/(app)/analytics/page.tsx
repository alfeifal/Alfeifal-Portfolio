"use client";
import { useState } from "react";
import { Card, ErrorBox, PageHeader, Stat, Tabs, SkeletonStats, SkeletonCards } from "@/components/ui";
import { AnimatePresence, m } from "motion/react";
import { T } from "@/components/motion";
import { fmtMoney, fmtNum, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";
import { MiniBars, MiniLine } from "@/components/charts";

type Period = "week" | "month" | "quarter" | "year";
interface Overview {
  period: Period; range: { from: string; to: string };
  finance: { current: { income: number; expenses: number; net: number; savingsRate: number | null; byCategory: { name: string; total: number }[] }; previous: { income: number; expenses: number; net: number }; monthly: { month: string; income: number; expenses: number }[]; financeBalance: number };
  training: { current: { sessions: number; emptySessions: number; sets: number; volume: number; minutes: number; weekly: { week: string; sessions: number; volume: number }[] }; previous: { sessions: number; volume: number; sets: number } };
  studies: { current: { totalMinutes: number; bySubject: { name: string; minutes: number; days: number }[]; daily: { date: string; minutes: number }[] }; previous: { totalMinutes: number } };
  german: { totalMinutes: number; xp: number; streak: number; unitsPassed: number; byKind: { kind: string; count: number; minutes: number; avgScore: number | null }[] };
  trading: Record<"real" | "paper", { trades: number; winRate: number; totalPnl: number; maxDrawdown: number; expectancy: number; byStrategy: { key: string; trades: number; winRate: number; pnl: number }[]; equityCurve: { at: string; equity: number }[] }>;
  nutrition: { average: { calories: number; protein: number }; daysLogged: number; goals: { calories: number; protein: number } };
  tasks: { done: number; created: number; open: number; overdue: number; daily: { date: string; n: number }[] };
  goals: { active: number; completed: number; avgProgress: number };
  projects: { active: number; completed: number };
}
const delta = (a: number, b: number) => (b === 0 ? (a === 0 ? "—" : "new") : `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}% vs prev`);

export default function AnalyticsPage() {
  const { user } = useShell();
  const cur = user.currency;
  const [period, setPeriod] = useState<Period>("month");
  const a = useApi<Overview>(`/api/analytics?period=${period}`, [period]);
  const d = a.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Analytics" subtitle={d ? `${d.range.from} → ${d.range.to} · compared with the previous ${period}` : "Trends across every module"} />
      <Tabs value={period} onChange={setPeriod} options={[{ value: "week", label: "7 days" }, { value: "month", label: "30 days" }, { value: "quarter", label: "90 days" }, { value: "year", label: "365 days" }]} />
      {a.error && <ErrorBox error={a.error} retry={a.reload} />}
      {!d ? <><SkeletonStats /><div className="mt-3"><SkeletonCards n={4} /></div></> : (
        <AnimatePresence mode="wait"><m.div key={period} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.enter} className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Net cash flow" count={d.finance.current.net} format={(v) => fmtMoney(v, cur)} tone={d.finance.current.net >= 0 ? "positive" : "negative"} sub={delta(d.finance.current.net, d.finance.previous.net)} />
            <Stat label="Training volume" value={`${fmtNum(d.training.current.volume / 1000, 1)} t`} sub={`${d.training.current.sessions} workouts${d.training.current.emptySessions ? ` · ${d.training.current.emptySessions} empty sessions` : ""} · ${delta(d.training.current.volume, d.training.previous.volume)}`} />
            <Stat label="Study time" count={d.studies.current.totalMinutes} format={(v) => `${Math.round(v)} min`} sub={delta(d.studies.current.totalMinutes, d.studies.previous.totalMinutes)} />
            <Stat label="Tasks done" count={d.tasks.done} format={(v) => String(Math.round(v))} sub={`${d.tasks.open} open · ${d.tasks.overdue} overdue`} tone={d.tasks.overdue ? "warning" : undefined} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Card title="Finance · income vs expenses (12 months)"><MiniBars series={d.finance.monthly.map((m) => ({ label: m.month.slice(2), a: m.income, b: m.expenses }))} labels={["Income", "Expenses"]} format={(v) => fmtMoney(v, cur)} /><p className="mt-1 text-xs muted">Savings rate this period: {d.finance.current.savingsRate ?? "n/a"}% · cash in Finance accounts {fmtMoney(d.finance.financeBalance, cur)} (investing and trading shown separately)</p></Card>
            <Card title="Spending by category"><ul className="space-y-1 text-sm">{d.finance.current.byCategory.slice(0, 8).map((c) => <li key={c.name} className="flex justify-between"><span>{c.name}</span><span className="tnum">{fmtMoney(c.total, cur)}</span></li>)}{d.finance.current.byCategory.length === 0 && <p className="muted">No expenses.</p>}</ul></Card>
            <Card title="Training · weekly volume"><MiniBars series={d.training.current.weekly.map((w) => ({ label: w.week.slice(5), a: w.volume }))} labels={["kg"]} format={(v) => `${fmtNum(v, 0)} kg`} /><p className="mt-1 text-xs muted">{d.training.current.sets} sets · {d.training.current.minutes} min · frequency {d.training.current.weekly.length ? fmtNum(d.training.current.sessions / d.training.current.weekly.length, 1) : 0}/week</p></Card>
            <Card title="Studies · minutes per day"><MiniBars series={d.studies.current.daily.map((x) => ({ label: x.date.slice(5), a: x.minutes }))} labels={["min"]} /><ul className="mt-1 text-xs muted">{d.studies.current.bySubject.map((s) => <li key={s.name}>{s.name}: {s.minutes} min over {s.days} days</li>)}</ul></Card>
            <Card title="German"><div className="grid grid-cols-2 gap-2 text-sm"><div><p className="text-xs muted">Minutes</p><p className="font-semibold tnum">{d.german.totalMinutes}</p></div><div><p className="text-xs muted">Streak</p><p className="font-semibold tnum">🔥 {d.german.streak}</p></div><div><p className="text-xs muted">Units passed</p><p className="font-semibold tnum">{d.german.unitsPassed}/28</p></div><div><p className="text-xs muted">XP</p><p className="font-semibold tnum">{d.german.xp}</p></div></div><ul className="mt-2 text-xs muted">{d.german.byKind.map((k) => <li key={k.kind}>{k.kind.replace("_", " ")}: {k.count}{k.avgScore != null ? ` · avg ${k.avgScore}%` : ""}</li>)}</ul></Card>
            <Card title="Goals & projects"><div className="grid grid-cols-2 gap-2 text-sm"><div><p className="text-xs muted">Active goals</p><p className="font-semibold tnum">{d.goals.active}</p></div><div><p className="text-xs muted">Avg progress</p><p className="font-semibold tnum">{d.goals.avgProgress}%</p></div><div><p className="text-xs muted">Goals completed</p><p className="font-semibold tnum">{d.goals.completed}</p></div><div><p className="text-xs muted">Projects active / done</p><p className="font-semibold tnum">{d.projects.active} / {d.projects.completed}</p></div></div></Card>
            {(["paper", "real"] as const).map((m) => <Card key={m} title={`Trading · ${m === "real" ? "REAL" : "SIMULATED"}`}>{d.trading[m].trades === 0 ? <p className="text-sm muted">No closed {m} trades in this period.</p> : <><div className="grid grid-cols-2 gap-2 text-sm"><div><p className="text-xs muted">P&L</p><p className={"font-semibold tnum " + (d.trading[m].totalPnl >= 0 ? "text-positive" : "text-negative")}>{fmtMoney(d.trading[m].totalPnl, cur)}</p></div><div><p className="text-xs muted">Win rate</p><p className="font-semibold tnum">{d.trading[m].winRate}%</p></div><div><p className="text-xs muted">Max drawdown</p><p className="font-semibold tnum">{fmtMoney(d.trading[m].maxDrawdown, cur)}</p></div><div><p className="text-xs muted">Expectancy</p><p className="font-semibold tnum">{fmtMoney(d.trading[m].expectancy, cur)}</p></div></div><MiniLine series={d.trading[m].equityCurve.map((p, i) => ({ label: String(i + 1), v: p.equity }))} label="Equity" height={120} format={(v) => fmtMoney(v, cur)} /></>}</Card>)}
            <Card title="Tasks completed per day"><MiniBars series={d.tasks.daily.map((x) => ({ label: x.date.slice(5), a: x.n }))} labels={["done"]} /></Card>
            <Card title="Nutrition"><p className="text-sm">Average over {d.nutrition.daysLogged} logged days: <span className="tnum font-medium">{fmtNum(d.nutrition.average.calories, 0)} kcal</span> · <span className="tnum font-medium">{fmtNum(d.nutrition.average.protein, 0)} g</span> protein (goals {d.nutrition.goals.calories} / {d.nutrition.goals.protein} g)</p></Card>
          </div>
          <p className="text-xs muted">All figures are calculated from your stored records; nothing here is estimated.</p>
        </m.div></AnimatePresence>
      )}
    </div>
  );
}
