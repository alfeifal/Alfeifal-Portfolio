"use client";
import { useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { Card, ErrorBox, PageHeader, Stat, Tabs, SkeletonStats, SkeletonCards, Badge, Bar } from "@/components/ui";
import { T } from "@/components/motion";
import { fmtMoney, fmtNum, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";
import { MiniBars, MiniLine } from "@/components/charts";
import type { Analytics, Period, Section } from "@/lib/types";

/** Below this many days with data a trend is noise, so the card says so instead of drawing a line. */
const MIN_POINTS = 3;

const change = (v: number | null, suffix = "vs previous") => (v === null ? "no comparison yet" : `${v >= 0 ? "+" : ""}${v}% ${suffix}`);
const share = (v: number | null) => (v === null ? "—" : `${v}%`);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm muted">{children}</p>;

export default function AnalyticsPage() {
  const { user } = useShell();
  const cur = user.currency;
  const [period, setPeriod] = useState<Period>("month");
  const [section, setSection] = useState<Section>("overview");
  const a = useApi<Analytics>(`/api/analytics?period=${period}`, [period]);
  const d = a.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        subtitle={d ? `${d.range.from} → ${d.range.to} · ${d.rangeDays} days · compared with the ${d.rangeDays} days before` : "Everything computed from your own records"}
      />
      <Tabs value={period} onChange={setPeriod} options={[{ value: "week", label: "7 days" }, { value: "month", label: "30 days" }, { value: "quarter", label: "90 days" }, { value: "year", label: "12 months" }]} />
      <Tabs
        value={section}
        onChange={setSection}
        options={[
          { value: "overview", label: "Overview" }, { value: "training", label: "Training" }, { value: "nutrition", label: "Nutrition" },
          { value: "finance", label: "Finance" }, { value: "studies", label: "Studies" }, { value: "productivity", label: "Productivity" },
          { value: "goals", label: "Goals & projects" },
        ]}
      />
      {a.error && <ErrorBox error={a.error} retry={a.reload} />}
      {!d ? (
        <><SkeletonStats /><div className="mt-3"><SkeletonCards n={4} /></div></>
      ) : (
        <AnimatePresence mode="wait">
          <m.div key={period + section} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.enter} className="space-y-4">

            {section === "overview" && (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="Net cash flow" count={d.finance.current.net} format={(v) => fmtMoney(v, cur)} tone={d.finance.current.net >= 0 ? "positive" : "negative"} sub={change(d.finance.change.net)} />
                  <Stat label="Workouts" count={d.training.current.sessions} format={(v) => String(Math.round(v))} sub={d.training.perWeek != null ? `${d.training.perWeek}/week · ${change(d.training.change.sessions)}` : change(d.training.change.sessions)} />
                  <Stat label="Study time" count={d.studies.current.totalMinutes} format={(v) => `${Math.round(v)} min`} sub={`${d.studies.consistency.daysStudied}/${d.studies.consistency.daysInRange} days · ${change(d.studies.change.minutes)}`} />
                  <Stat label="Tasks done" count={d.productivity.done} format={(v) => String(Math.round(v))} sub={`${share(d.productivity.completionRate)} of ${d.productivity.created} created · ${d.productivity.overdue} overdue`} tone={d.productivity.overdue ? "warning" : undefined} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Card title="Where the time went (calendar)">
                    {d.calendar.events === 0 ? <Empty>No events in this period.</Empty> : (
                      <>
                        <ul className="space-y-1 text-sm">{d.calendar.byKind.map((k) => <li key={k.kind} className="flex items-center justify-between gap-2"><span className="capitalize">{k.kind}</span><span className="tnum muted">{fmtNum(k.hours, 1)} h · {k.events}</span></li>)}</ul>
                        <p className="mt-1 text-xs muted">{fmtNum(d.calendar.totalHours, 1)} h scheduled in total. Events are counted by their start date.</p>
                      </>
                    )}
                  </Card>
                  <Card title="Journal & mood">
                    {d.journal.entries === 0 ? <Empty>No journal entries in this period.</Empty> : (
                      <>
                        <p className="text-sm">{d.journal.entries} entries on {d.journal.daysWithEntry} of {d.journal.daysInRange} days.</p>
                        <p className="mt-1 text-sm">{d.journal.avgMood == null ? "No mood recorded." : <>Average mood <span className="tnum font-medium">{d.journal.avgMood}</span> / 5 over {d.journal.withMood} entries.</>}</p>
                      </>
                    )}
                  </Card>
                  <Card title="Nutrition coverage">
                    {d.nutrition.daysLogged === 0 ? <Empty>Nothing logged in this period.</Empty> : (
                      <>
                        <p className="text-sm">Logged on {d.nutrition.coverage.daysLogged} of {d.nutrition.coverage.daysInRange} days ({share(d.nutrition.coverage.pct)}).</p>
                        <p className="mt-1 text-sm tnum">{fmtNum(d.nutrition.average.calories, 0)} kcal · P {fmtNum(d.nutrition.average.protein, 0)} · C {fmtNum(d.nutrition.average.carbs, 0)} · F {fmtNum(d.nutrition.average.fat, 0)} per logged day</p>
                        {!d.nutrition.consistency.ok && <p className="mt-1 text-xs text-warning">The average macros imply {fmtNum(d.nutrition.consistency.macroCalories, 0)} kcal; some entries disagree with their own macros.</p>}
                      </>
                    )}
                  </Card>
                  <Card title="Goals & projects">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><p className="text-xs muted">Active goals</p><p className="font-semibold tnum">{d.goals.active}</p></div>
                      <div><p className="text-xs muted">Avg progress</p><p className="font-semibold tnum">{d.goals.active === 0 ? "—" : `${d.goals.avgProgress}%`}</p></div>
                      <div><p className="text-xs muted">Active projects</p><p className="font-semibold tnum">{d.projects.active}</p></div>
                      <div><p className="text-xs muted">Completed in period</p><p className="font-semibold tnum">{d.goals.completedInRange}</p></div>
                    </div>
                  </Card>
                  {(["paper", "real"] as const).map((mode) => (
                    <Card key={mode} title={`Trading · ${mode === "real" ? "REAL money" : "SIMULATED"}`}>
                      {d.trading[mode].trades === 0 ? <Empty>No closed {mode} trades in this period.</Empty> : (
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div><p className="text-xs muted">Trades</p><p className="font-semibold tnum">{d.trading[mode].trades}</p></div>
                          <div><p className="text-xs muted">Win rate</p><p className="font-semibold tnum">{d.trading[mode].winRate}%</p></div>
                          <div><p className="text-xs muted">P&L</p><p className={`font-semibold tnum ${d.trading[mode].totalPnl >= 0 ? "text-positive" : "text-negative"}`}>{fmtMoney(d.trading[mode].totalPnl, cur)}</p></div>
                        </div>
                      )}
                    </Card>
                  ))}
                  <Card title="Investing">
                    {d.investing.snapshots.length < 2 ? <Empty>Portfolio history needs at least two daily snapshots. {d.investing.snapshots.length === 1 ? "There is one so far." : "None yet."}</Empty> : (
                      <>
                        <MiniLine series={d.investing.snapshots.map((s) => ({ label: s.date.slice(5), v: s.totalValue }))} label="Portfolio" format={(v) => fmtMoney(v, cur)} />
                        <p className="mt-1 text-xs muted">{d.investing.first!.date} → {d.investing.last!.date} · {change(d.investing.changePct, "over the recorded history")}</p>
                      </>
                    )}
                  </Card>
                </div>
              </>
            )}

            {section === "training" && (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="Workouts" count={d.training.current.sessions} format={(v) => String(Math.round(v))} sub={change(d.training.change.sessions)} />
                  <Stat label="Volume" value={`${fmtNum(d.training.current.volume / 1000, 1)} t`} sub={change(d.training.change.volume)} />
                  <Stat label="Working sets" count={d.training.current.sets} format={(v) => String(Math.round(v))} sub={d.training.current.emptySessions ? `${d.training.current.emptySessions} empty sessions ignored` : "every session had sets"} />
                  <Stat label="Adherence" value={d.training.adherence.adherencePct == null ? "—" : `${d.training.adherence.adherencePct}%`} sub={d.training.adherence.plannedDays == null ? "no active plan" : `${d.training.adherence.completedDays} of ${d.training.adherence.plannedSoFar} training days so far`} tone={d.training.adherence.adherencePct != null && d.training.adherence.adherencePct < 70 ? "warning" : undefined} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Card title="Weekly volume">
                    {d.training.current.weekly.length < 2 ? <Empty>Not enough weeks in this period to show a trend.</Empty> : <MiniBars series={d.training.current.weekly.map((w) => ({ label: w.week.slice(5), a: w.volume }))} labels={["kg"]} format={(v) => `${fmtNum(v, 0)} kg`} />}
                  </Card>
                  <Card title="Adherence to the cycle">
                    {d.training.adherence.plannedDays == null ? <Empty>No active training plan, so there is no target to measure against.</Empty> : (
                      <>
                        <div className="flex items-center gap-3"><Bar value={(d.training.adherence.adherencePct ?? 0) / 100} tone={(d.training.adherence.adherencePct ?? 0) >= 70 ? "positive" : "accent"} h={10} /><span className="tnum text-sm font-semibold">{share(d.training.adherence.adherencePct)}</span></div>
                        <ul className="mt-2 space-y-0.5 text-sm">
                          <li className="flex justify-between"><span>Training days in the period</span><span className="tnum">{d.training.adherence.plannedDays}</span></li>
                          <li className="flex justify-between"><span>Already due</span><span className="tnum">{d.training.adherence.plannedSoFar}</span></li>
                          <li className="flex justify-between"><span>Trained</span><span className="tnum">{d.training.adherence.completedDays}</span></li>
                          <li className="flex justify-between"><span>Missed</span><span className="tnum">{d.training.adherence.missedDays ?? 0}</span></li>
                          <li className="flex justify-between"><span>Extra days</span><span className="tnum">{d.training.adherence.extraDays ?? 0}</span></li>
                        </ul>
                      </>
                    )}
                  </Card>
                  <Card title="Totals">
                    <ul className="space-y-0.5 text-sm">
                      <li className="flex justify-between"><span>Sets</span><span className="tnum">{d.training.current.sets}</span></li>
                      <li className="flex justify-between"><span>Volume</span><span className="tnum">{fmtNum(d.training.current.volume, 0)} kg</span></li>
                      <li className="flex justify-between"><span>Time logged</span><span className="tnum">{d.training.current.minutes} min</span></li>
                      <li className="flex justify-between"><span>Sessions per week</span><span className="tnum">{d.training.perWeek ?? "—"}</span></li>
                    </ul>
                  </Card>
                </div>
              </>
            )}

            {section === "nutrition" && (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
                    <Stat key={k} label={`Avg ${k}`} count={d.nutrition.average[k]} format={(v) => (k === "calories" ? `${fmtNum(v, 0)} kcal` : `${fmtNum(v, 0)} g`)}
                      sub={d.nutrition.compliance[k].target ? `target ${d.nutrition.compliance[k].target}${k === "calories" ? " kcal" : " g"} · ${share(d.nutrition.compliance[k].pct)} of days on target` : "no target set"} />
                  ))}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Card title="Calories per day">
                    {d.nutrition.daily.length < MIN_POINTS ? <Empty>Only {d.nutrition.daily.length} day(s) logged in this period — not enough to show a trend.</Empty> : <MiniBars series={d.nutrition.daily.map((x) => ({ label: x.date.slice(5), a: x.calories }))} labels={["kcal"]} format={(v) => `${fmtNum(v, 0)} kcal`} />}
                  </Card>
                  <Card title="Coverage and consistency">
                    <p className="text-sm">Logged on <span className="tnum font-medium">{d.nutrition.coverage.daysLogged}</span> of {d.nutrition.coverage.daysInRange} days ({share(d.nutrition.coverage.pct)}).</p>
                    <p className="mt-1 text-sm">Days where the stored calories disagree with their own macros: <span className="tnum font-medium">{d.nutrition.daily.filter((x) => !x.consistency.ok).length}</span>.</p>
                    <p className="mt-1 text-xs muted">Averages are over logged days only, never over the whole period.</p>
                  </Card>
                  <Card title="Macros per day">
                    {d.nutrition.daily.length < MIN_POINTS ? <Empty>Not enough logged days.</Empty> : <MiniBars series={d.nutrition.daily.map((x) => ({ label: x.date.slice(5), a: x.protein, b: x.carbs }))} labels={["protein g", "carbs g"]} />}
                  </Card>
                  <Card title="Against the previous period">
                    {d.nutrition.previous.daysLogged === 0 ? <Empty>Nothing logged in the previous period to compare with.</Empty> : (
                      <ul className="space-y-0.5 text-sm">
                        <li className="flex justify-between"><span>Calories</span><span className="tnum">{fmtNum(d.nutrition.previous.average.calories, 0)} → {fmtNum(d.nutrition.average.calories, 0)} ({change(d.nutrition.change.calories, "")})</span></li>
                        <li className="flex justify-between"><span>Protein</span><span className="tnum">{fmtNum(d.nutrition.previous.average.protein, 0)} → {fmtNum(d.nutrition.average.protein, 0)} g</span></li>
                        <li className="flex justify-between"><span>Days logged</span><span className="tnum">{d.nutrition.previous.daysLogged} → {d.nutrition.daysLogged}</span></li>
                      </ul>
                    )}
                  </Card>
                </div>
              </>
            )}

            {section === "finance" && (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="Income" count={d.finance.current.income} format={(v) => fmtMoney(v, cur)} tone="positive" sub={change(d.finance.change.income)} />
                  <Stat label="Expenses" count={d.finance.current.expenses} format={(v) => fmtMoney(v, cur)} tone="negative" sub={change(d.finance.change.expenses)} />
                  <Stat label="Net" count={d.finance.current.net} format={(v) => fmtMoney(v, cur)} tone={d.finance.current.net >= 0 ? "positive" : "negative"} sub={d.finance.current.savingsRate == null ? "no income in the period" : `savings rate ${d.finance.current.savingsRate}%`} />
                  <Stat label="Cash (Finance)" count={d.finance.financeBalance} format={(v) => fmtMoney(v, cur)} sub="excludes investing & trading" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Card title="Income vs expenses (12 months)"><MiniBars series={d.finance.monthly.map((mm) => ({ label: mm.month.slice(2), a: mm.income, b: mm.expenses }))} labels={["Income", "Expenses"]} format={(v) => fmtMoney(v, cur)} /></Card>
                  <Card title="Spending by category">
                    {d.finance.current.byCategory.length === 0 ? <Empty>No spending recorded in this period.</Empty> : <ul className="space-y-1 text-sm">{d.finance.current.byCategory.slice(0, 8).map((c) => <li key={c.name} className="flex justify-between"><span>{c.name}</span><span className="tnum">{fmtMoney(c.total, cur)}</span></li>)}</ul>}
                  </Card>
                  <Card title="Budgets vs spending">
                    {d.finance.budgets.length === 0 ? <Empty>No budgets set. Create one in Finance to track a limit here.</Empty> : (
                      <ul className="space-y-2 text-sm">{d.finance.budgets.map((b) => (
                        <li key={b.id}>
                          <div className="flex justify-between"><span>{b.name}</span><span className="tnum muted">{fmtMoney(b.spent, cur)} / {fmtMoney(b.amount, cur)}</span></div>
                          <div className="mt-1 flex items-center gap-2"><Bar value={Math.min(b.pct, 100) / 100} tone={b.pct >= 100 ? "negative" : b.pct >= 80 ? "warning" : "accent"} /><span className="w-10 text-right text-xs tnum">{b.pct}%</span></div>
                        </li>
                      ))}</ul>
                    )}
                  </Card>
                </div>
              </>
            )}

            {section === "studies" && (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="Study time" count={d.studies.current.totalMinutes} format={(v) => `${Math.round(v)} min`} sub={change(d.studies.change.minutes)} />
                  <Stat label="Days studied" value={`${d.studies.consistency.daysStudied}/${d.studies.consistency.daysInRange}`} sub={`${share(d.studies.consistency.pct)} of the period`} />
                  <Stat label="Per study day" value={d.studies.consistency.avgMinutesPerStudyDay == null ? "—" : `${fmtNum(d.studies.consistency.avgMinutesPerStudyDay, 0)} min`} sub="average on days with a session" />
                  <Stat label="German" count={d.german.totalMinutes} format={(v) => `${Math.round(v)} min`} sub={`streak ${d.german.streak} · ${d.german.unitsPassed} units passed`} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Card title="Minutes per day">
                    {d.studies.current.daily.length < MIN_POINTS ? <Empty>Only {d.studies.current.daily.length} day(s) with sessions — not enough for a trend.</Empty> : <MiniBars series={d.studies.current.daily.map((x) => ({ label: x.date.slice(5), a: x.minutes }))} labels={["min"]} />}
                  </Card>
                  <Card title="By subject">
                    {d.studies.current.bySubject.length === 0 ? <Empty>No study sessions in this period.</Empty> : (
                      <ul className="space-y-1 text-sm">{d.studies.current.bySubject.map((s) => (
                        <li key={s.name} className="flex justify-between"><span>{s.name}</span><span className="tnum muted">{s.minutes} min · {s.days} days{s.weeklyGoalMinutes ? ` · goal ${s.weeklyGoalMinutes}/week` : ""}</span></li>
                      ))}</ul>
                    )}
                  </Card>
                  <Card title="Exams & assignments">
                    <ul className="space-y-0.5 text-sm">
                      <li className="flex justify-between"><span>Upcoming exams</span><span className="tnum">{d.studies.exams.upcoming}</span></li>
                      <li className="flex justify-between"><span>Exams in this period</span><span className="tnum">{d.studies.exams.inRange}</span></li>
                      <li className="flex justify-between"><span>Open assignments</span><span className="tnum">{d.studies.assignments.open}{d.studies.assignments.overdue ? ` (${d.studies.assignments.overdue} overdue)` : ""}</span></li>
                      <li className="flex justify-between"><span>Completed in period</span><span className="tnum">{d.studies.assignments.completedInRange}</span></li>
                    </ul>
                  </Card>
                </div>
              </>
            )}

            {section === "productivity" && (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="Completed" count={d.productivity.done} format={(v) => String(Math.round(v))} sub={`${d.productivity.perDay ?? "—"} per day`} />
                  <Stat label="Created" count={d.productivity.created} format={(v) => String(Math.round(v))} sub="in this period" />
                  <Stat label="Completion rate" value={share(d.productivity.completionRate)} sub={d.productivity.created === 0 ? "nothing created in the period" : "completed vs created"} />
                  <Stat label="Overdue now" count={d.productivity.overdue} format={(v) => String(Math.round(v))} tone={d.productivity.overdue ? "warning" : undefined} sub={`${d.productivity.open} still open`} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Card title="Completed per day">
                    {d.productivity.daily.length < MIN_POINTS ? <Empty>Only {d.productivity.daily.length} day(s) with completions — not enough for a trend.</Empty> : <MiniBars series={d.productivity.daily.map((x) => ({ label: x.date.slice(5), a: x.n }))} labels={["done"]} />}
                  </Card>
                  <Card title="By weekday">
                    {d.productivity.done === 0 ? <Empty>No tasks completed in this period.</Empty> : <MiniBars series={d.productivity.byWeekday.map((x) => ({ label: x.day, a: x.n }))} labels={["done"]} />}
                  </Card>
                </div>
              </>
            )}

            {section === "goals" && (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="Active goals" count={d.goals.active} format={(v) => String(Math.round(v))} sub={`${d.goals.linked} tracked automatically`} />
                  <Stat label="Avg progress" value={d.goals.active === 0 ? "—" : `${d.goals.avgProgress}%`} sub={d.goals.pastDeadline ? `${d.goals.pastDeadline} past their deadline` : "none past deadline"} tone={d.goals.pastDeadline ? "warning" : undefined} />
                  <Stat label="Completed in period" count={d.goals.completedInRange} format={(v) => String(Math.round(v))} sub={`${d.goals.completed} completed in total`} />
                  <Stat label="Active projects" count={d.projects.active} format={(v) => String(Math.round(v))} sub={`${d.projects.completed} completed · ${d.projects.total} total`} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Card title="Milestones">
                    {d.goals.milestones.total + d.projects.milestones.total === 0 ? <Empty>No milestones yet.</Empty> : (
                      <ul className="space-y-0.5 text-sm">
                        <li className="flex justify-between"><span>On goals</span><span className="tnum">{d.goals.milestones.total}</span></li>
                        <li className="flex justify-between"><span>On projects</span><span className="tnum">{d.projects.milestones.total}</span></li>
                        <li className="flex justify-between"><span>Completed</span><span className="tnum">{d.goals.milestones.completed}</span></li>
                        <li className="flex justify-between"><span>Completed in this period</span><span className="tnum">{d.goals.milestones.completedInRange}</span></li>
                      </ul>
                    )}
                  </Card>
                  <Card title="Projects">
                    {d.projects.total === 0 ? <Empty>No projects yet.</Empty> : (
                      <>
                        <div className="flex items-center gap-3"><Bar value={d.projects.avgProgress / 100} tone="accent" h={10} /><span className="tnum text-sm font-semibold">{d.projects.active === 0 ? "—" : `${d.projects.avgProgress}%`}</span></div>
                        <p className="mt-1 text-xs muted">Average stored progress of active projects. The project screen also computes progress from its tasks.</p>
                      </>
                    )}
                  </Card>
                </div>
              </>
            )}

            <p className="text-xs muted">
              Every figure is computed from your stored records for {d.range.from} → {d.range.to}. Nothing here is estimated or filled in.
              {d.rangeDays > 0 && <> Percentages are shown only when their denominator exists. <Badge tone="muted" className="ml-1">{d.rangeDays} days</Badge></>}
            </p>
          </m.div>
        </AnimatePresence>
      )}
    </div>
  );
}
