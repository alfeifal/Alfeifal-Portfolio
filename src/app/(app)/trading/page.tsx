"use client";
import { useState } from "react";
import { useToast } from "@/components/toast";
import Link from "next/link";
import { Badge, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Stat, Tabs, Markdown, Button, SkeletonStats } from "@/components/ui";
import { api, fmtDate, fmtMoney, fmtNum, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";
import { MiniLine } from "@/components/charts";
import { initialParam } from "@/lib/urlparam";

type Mode = "paper" | "real";
interface Trade { id: string; symbol: string; direction: string; status: string; mode: Mode; entryPrice: number | null; exitPrice: number | null; stopLoss: number | null; target: number | null; quantity: number | null; pnl: number | null; rMultiple: number | null; riskAmount: number | null; strategyName: string | null; timeframe: string | null; openedAt: string | null; closedAt: string | null; accountName: string | null }
interface Stats { mode: Mode; trades: number; wins: number; losses: number; openTrades: number; winRate: number; avgWin: number; avgLoss: number; expectancy: number; profitFactor: number | null; totalPnl: number; maxDrawdown: number; avgR: number | null; equityCurve: { at: string; equity: number }[]; byStrategy: { key: string; trades: number; winRate: number; pnl: number }[]; bySymbol: { key: string; trades: number; winRate: number; pnl: number }[]; byTimeframe: { key: string; trades: number; winRate: number; pnl: number }[] }
interface Watchlist { id: string; name: string; items: { id: string; symbol: string; assetClass: string; notes: string | null }[] }
interface Quote { symbol: string; price: number; changePct: number | null; provider: string; freshness: string; asOf: string }
interface Alert { id: string; symbol: string; condition: string; price: number; active: boolean; triggeredAt: string | null }
interface Account { id: string; name: string; mode: Mode; startingBalance: number; riskPerTradePct: number }
interface Strategy { id: string; name: string; description: string | null; rules: string | null; timeframes: string | null }
interface Econ { id: string; title: string; at: string; importance: string }

export default function TradingPage() {
  const { user, aiConfigured } = useShell();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const cur = user.currency;
  const [mode, setMode] = useState<Mode>("paper");
  const [tab, setTab] = useState<"dashboard" | "journal" | "analytics" | "strategies" | "watchlist" | "brief">(() => initialParam("tab", ["dashboard", "journal", "analytics", "strategies", "watchlist", "brief"] as const, "dashboard"));
  const stats = useApi<Stats>(`/api/trading/stats?mode=${mode}`, [mode]);
  const trades = useApi<Trade[]>(`/api/trading/trades?mode=${mode}&limit=100`, [mode]);
  const watchlists = useApi<Watchlist[]>("/api/trading/watchlist");
  const alerts = useApi<Alert[]>("/api/trading/alerts");
  const accounts = useApi<Account[]>("/api/trading/accounts");
  const strategies = useApi<Strategy[]>("/api/trading/strategies");
  const econ = useApi<Econ[]>("/api/market/events?days=7");
  const brief = useApi<{ content: string; createdAt: string } | null>("/api/ai/reports/market_brief");
  const [quotes, setQuotes] = useState<{ quotes: Quote[]; missing: string[] } | null>(null);
  const [quoteErr, setQuoteErr] = useState("");
  const [modal, setModal] = useState<null | "trade" | "watch" | "alert" | "account" | "econ" | "strategy">(null);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const all = () => { stats.refresh(); trades.refresh(); watchlists.refresh(); alerts.refresh(); accounts.refresh(); econ.refresh(); strategies.refresh(); };
  const loadQuotes = async () => { const items = watchlists.data?.flatMap((w) => w.items) ?? []; if (!items.length) return; setQuoteErr(""); try { setQuotes(await api("/api/market/quotes", { method: "POST", json: { symbols: items.map((i) => ({ symbol: i.symbol, assetClass: i.assetClass })) } })); } catch (e) { setQuoteErr((e as Error).message); } };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setSaving(true);
    const num = (k: string) => (form[k] ? Number(form[k]) : null);
    try {
      if (modal === "trade") await api("/api/trading/trades", { method: "POST", json: { accountId: form.accountId || undefined, mode, symbol: form.symbol, assetClass: form.assetClass || "stock", direction: form.direction || "long", status: form.status || "open", strategy: form.strategy || null, timeframe: form.timeframe || null, setup: form.setup || null, entryPrice: num("entryPrice"), exitPrice: num("exitPrice"), stopLoss: num("stopLoss"), target: num("target"), quantity: num("quantity"), fees: Number(form.fees || 0), entryReason: form.entryReason || null, exitReason: form.exitReason || null, emotionalState: form.emotionalState || null, notes: form.notes || null } });
      if (modal === "watch") await api("/api/trading/watchlist", { method: "POST", json: { symbol: form.symbol, assetClass: form.assetClass || "stock", notes: form.notes || null, name: form.name || null } });
      if (modal === "alert") await api("/api/trading/alerts", { method: "POST", json: { symbol: form.symbol, assetClass: form.assetClass || "stock", condition: form.condition || "above", price: Number(form.price), note: form.note || null } });
      if (modal === "account") await api("/api/trading/accounts", { method: "POST", json: { name: form.name, mode: form.mode || "paper", broker: form.broker || null, startingBalance: Number(form.startingBalance || 0), riskPerTradePct: Number(form.riskPerTradePct || 1) } });
      if (modal === "econ") await api("/api/market/events", { method: "POST", json: { title: form.title, at: new Date(form.at).toISOString(), importance: form.importance || "medium", category: form.category || "macro", country: form.country || null } });
      if (modal === "strategy") {
        const body = { name: form.name, description: form.description || null, rules: form.rules || null, timeframes: form.timeframes || null };
        if (editingStrategy) await api(`/api/trading/strategies/${editingStrategy.id}`, { method: "PATCH", json: body });
        else await api("/api/trading/strategies", { method: "POST", json: body });
      }
      if (modal === "strategy") toast.success(editingStrategy ? "Strategy updated" : "Strategy created", form.name);
      else toast.success(modal === "trade" ? "Trade logged" : modal === "watch" ? "Added to watchlist" : modal === "alert" ? "Alert created" : modal === "account" ? "Account created" : "Event added", modal === "trade" ? `${form.symbol} ${form.direction ?? "long"} · ${mode === "real" ? "REAL" : "simulated"}` : form.symbol ?? form.name ?? form.title);
      setModal(null); setForm({}); setEditingStrategy(null); all();
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };
  const genBrief = async () => { setBusy(true); try { await api("/api/ai/reports/market_brief", { method: "POST" }); brief.refresh(); toast.success("Market brief generated"); } catch (e) { toast.error("Brief failed", (e as Error).message); } finally { setBusy(false); } };
  const s = stats.data;
  const open = trades.data?.filter((t) => t.status === "open") ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Trading" subtitle="Education, research, journaling and analysis. Real and simulated results are never mixed." action={<><div className="flex overflow-hidden rounded-xl border border-border text-sm"><button className={"px-3 py-1.5 " + (mode === "paper" ? "bg-accent text-accent-fg" : "")} onClick={() => setMode("paper")}>SIMULATED</button><button className={"px-3 py-1.5 " + (mode === "real" ? "bg-warning text-white" : "")} onClick={() => setMode("real")}>REAL</button></div><button className="btn-primary btn-sm" onClick={() => { setForm({ direction: "long", status: "open", assetClass: "stock", accountId: accounts.data?.find((a) => a.mode === mode)?.id ?? "" }); setModal("trade"); }}>+ Trade</button><Link href="/trading/academy" className="btn-ghost btn-sm">Academy</Link></>} />
      <Tabs value={tab} onChange={setTab} options={[{ value: "dashboard", label: "Dashboard" }, { value: "journal", label: "Journal" }, { value: "analytics", label: "Analytics" }, { value: "strategies", label: "Strategies" }, { value: "watchlist", label: "Watchlist & alerts" }, { value: "brief", label: "Daily brief" }]} />
      {stats.error && <ErrorBox error={stats.error} retry={stats.reload} />}
      {stats.loading && !s && tab === "dashboard" && <SkeletonStats />}
      {tab === "dashboard" && s && (
        <>
          <p className="text-xs"><Badge tone={mode === "real" ? "warning" : "muted"}>{mode === "real" ? "REAL account" : "SIMULATED (paper) account"}</Badge> {accounts.data?.filter((a) => a.mode === mode).map((a) => <span key={a.id} className="ml-2 muted">{a.name} · start {fmtMoney(a.startingBalance, cur)} · risk/trade {a.riskPerTradePct}%</span>)}{!accounts.data?.some((a) => a.mode === mode) && <button className="link ml-2" onClick={() => { setForm({ mode }); setModal("account"); }}>Create {mode} account</button>}</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Closed P&L" count={s.totalPnl} format={(v) => fmtMoney(v, cur)} tone={s.totalPnl >= 0 ? "positive" : "negative"} sub={`${s.trades} closed · ${s.openTrades} open`} />
            <Stat label="Win rate" value={`${s.winRate}%`} sub={`${s.wins}W / ${s.losses}L`} />
            <Stat label="Expectancy" value={fmtMoney(s.expectancy, cur)} sub={`PF ${s.profitFactor ?? "∞"} · avg R ${s.avgR ?? "—"}`} />
            <Stat label="Max drawdown" value={fmtMoney(s.maxDrawdown, cur)} tone="warning" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Card title="Open positions">{open.length === 0 ? <p className="text-sm muted">No open trades.</p> : <ul className="divide-y divide-border text-sm">{open.map((t) => <li key={t.id} className="py-1.5"><Link href={`/trading/journal/${t.id}`} className="flex justify-between hover:underline"><span>{t.symbol} <Badge tone={t.direction === "long" ? "positive" : "negative"}>{t.direction}</Badge> {t.strategyName && <span className="muted">· {t.strategyName}</span>}</span><span className="tnum muted">entry {t.entryPrice ?? "—"} · stop {t.stopLoss ?? "—"} · risk {t.riskAmount != null ? fmtMoney(t.riskAmount, cur) : "—"}</span></Link></li>)}</ul>}</Card>
            <Card title="Recent trades">{!trades.data?.length ? <p className="text-sm muted">Nothing journaled yet.</p> : <ul className="divide-y divide-border text-sm">{trades.data.filter((t) => t.status === "closed").slice(0, 6).map((t) => <li key={t.id} className="py-1.5"><Link href={`/trading/journal/${t.id}`} className="flex justify-between hover:underline"><span>{t.symbol} {t.direction} <span className="muted">· {fmtDate(t.closedAt)}</span></span><span className={"tnum " + ((t.pnl ?? 0) >= 0 ? "text-positive" : "text-negative")}>{fmtMoney(t.pnl ?? 0, cur)}{t.rMultiple != null && <span className="muted"> · {t.rMultiple}R</span>}</span></Link></li>)}</ul>}</Card>
            <Card title="Watchlist" action={<button className="btn-ghost btn-sm" onClick={loadQuotes}>Quotes</button>}><WatchlistView watchlists={watchlists.data ?? []} quotes={quotes} err={quoteErr} /></Card>
            <Card title="Important events" action={<button className="btn-ghost btn-sm" onClick={() => { setForm({ importance: "medium", category: "macro" }); setModal("econ"); }}>+ Event</button>}>{!econ.data?.length ? <p className="text-sm muted">No upcoming events registered (FOMC, CPI, earnings…).</p> : <ul className="space-y-1 text-sm">{econ.data.map((e) => <li key={e.id} className="flex justify-between"><span>{e.title} <Badge tone={e.importance === "high" ? "negative" : "muted"}>{e.importance}</Badge></span><span className="muted">{fmtDate(e.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></li>)}</ul>}</Card>
          </div>
        </>
      )}
      {tab === "journal" && (trades.loading && !trades.data ? <Spinner /> : !trades.data?.length ? <Empty>No {mode} trades yet.</Empty> : <ul className="card divide-y divide-border">{trades.data.map((t) => <li key={t.id}><Link href={`/trading/journal/${t.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2"><span className="w-14 text-xs muted">{fmtDate(t.closedAt ?? t.openedAt)}</span><span className="flex-1"><span className="font-medium">{t.symbol}</span> <Badge tone={t.direction === "long" ? "positive" : "negative"}>{t.direction}</Badge> <Badge>{t.status}</Badge>{t.strategyName && <span className="muted"> · {t.strategyName}</span>}{t.timeframe && <span className="muted"> · {t.timeframe}</span>}</span>{t.pnl != null && <span className={"tnum " + (t.pnl >= 0 ? "text-positive" : "text-negative")}>{fmtMoney(t.pnl, cur)}{t.rMultiple != null ? ` · ${t.rMultiple}R` : ""}</span>}</Link></li>)}</ul>)}
      {tab === "analytics" && s && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card title="Equity curve (closed P&L)"><MiniLine series={s.equityCurve.map((p, i) => ({ label: p.at ? fmtDate(p.at) : String(i), v: p.equity }))} label="Equity" format={(v) => fmtMoney(v, cur)} /></Card>
          <Card title="Key metrics"><dl className="grid grid-cols-2 gap-y-1 text-sm">{[["Trades", s.trades], ["Win rate", `${s.winRate}%`], ["Average win", fmtMoney(s.avgWin, cur)], ["Average loss", fmtMoney(s.avgLoss, cur)], ["Expectancy", fmtMoney(s.expectancy, cur)], ["Profit factor", s.profitFactor ?? "∞"], ["Total P&L", fmtMoney(s.totalPnl, cur)], ["Max drawdown", fmtMoney(s.maxDrawdown, cur)], ["Average R", s.avgR ?? "—"]].map(([k, v]) => <div key={String(k)} className="contents"><dt className="muted">{k}</dt><dd className="tnum text-right">{String(v)}</dd></div>)}</dl></Card>
          {[["By strategy", s.byStrategy], ["By asset", s.bySymbol], ["By timeframe", s.byTimeframe]].map(([title, rows]) => <Card key={String(title)} title={String(title)}>{(rows as Stats["byStrategy"]).length === 0 ? <p className="text-sm muted">No closed trades.</p> : <table className="w-full text-sm"><thead><tr className="text-left text-xs muted"><th>Key</th><th>Trades</th><th>Win %</th><th className="text-right">P&L</th></tr></thead><tbody>{(rows as Stats["byStrategy"]).map((r) => <tr key={r.key} className="border-t border-border"><td className="py-1">{r.key}</td><td>{r.trades}</td><td>{r.winRate}%</td><td className={"tnum text-right " + (r.pnl >= 0 ? "text-positive" : "text-negative")}>{fmtMoney(r.pnl, cur)}</td></tr>)}</tbody></table>}</Card>)}
        </div>
      )}
      {tab === "strategies" && (
        <div className="space-y-3">
          <Card
            title="Strategies"
            action={<Button size="sm" variant="primary" onClick={() => { setEditingStrategy(null); setForm({}); setModal("strategy"); }}>+ Strategy</Button>}
          >
            {strategies.error ? (
              <ErrorBox error={strategies.error} retry={strategies.reload} />
            ) : strategies.loading && !strategies.data ? (
              <Spinner />
            ) : !strategies.data?.length ? (
              <Empty title="No strategies yet" action={<Button size="sm" variant="primary" onClick={() => { setEditingStrategy(null); setForm({}); setModal("strategy"); }}>Describe your first strategy</Button>}>
                A strategy is the setup you are trading and the rules you follow. Typing a name in the trade form creates one automatically — this is where you write down what it actually means, and what your analytics are grouping by.
              </Empty>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {strategies.data.map((st) => {
                  const perf = s?.byStrategy.find((r) => r.key === st.name);
                  return (
                    <li key={st.id} className="flex items-start gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{st.name}</span>
                        {st.timeframes && <span className="muted"> · {st.timeframes}</span>}
                        {perf && <span className="muted"> · {perf.trades} {mode} trades · {perf.winRate}% win · <span className={perf.pnl >= 0 ? "text-positive" : "text-negative"}>{fmtMoney(perf.pnl, cur)}</span></span>}
                        {st.description && <span className="block text-xs muted">{st.description}</span>}
                        {st.rules && <span className="mt-0.5 block whitespace-pre-wrap text-xs muted">{st.rules}</span>}
                      </span>
                      <span className="flex shrink-0 gap-1.5">
                        <Button size="sm" onClick={() => { setEditingStrategy(st); setForm({ name: st.name, description: st.description ?? "", rules: st.rules ?? "", timeframes: st.timeframes ?? "" }); setModal("strategy"); }}>Edit</Button>
                        <Button size="sm" variant="danger" onClick={async () => { try { await api(`/api/trading/strategies/${st.id}`, { method: "DELETE" }); strategies.refresh(); toast.success("Strategy archived", st.name); } catch (e) { toast.error("Not archived", (e as Error).message); } }}>Archive</Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs muted">Archiving hides a strategy from the picker. Trades already taken keep naming it, so your history and analytics do not change.</p>
          </Card>
        </div>
      )}
      {tab === "watchlist" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card title="Watchlist" action={<><button className="btn-ghost btn-sm" onClick={loadQuotes}>Quotes</button><button className="btn-primary btn-sm" onClick={() => { setForm({ assetClass: "stock" }); setModal("watch"); }}>+ Symbol</button></>}><WatchlistView watchlists={watchlists.data ?? []} quotes={quotes} err={quoteErr} onRemove={async (id) => { await api(`/api/trading/watchlist/${id}`, { method: "DELETE" }); all(); }} onNote={async (id, notes) => { await api(`/api/trading/watchlist/${id}`, { method: "PATCH", json: { notes } }); all(); }} /></Card>
          <Card title="Price alerts" action={<><button className="btn-ghost btn-sm" onClick={async () => { const r = await api<{ fired: number }>("/api/market/alerts/check", { method: "POST" }); toast.info(`${r.fired} alert(s) triggered`); all(); }}>Check now</button><button className="btn-primary btn-sm" onClick={() => { setForm({ condition: "above", assetClass: "stock" }); setModal("alert"); }}>+ Alert</button></>}>{!alerts.data?.length ? <p className="text-sm muted">No alerts. Alerts are checked hourly by the cron job and on demand.</p> : <ul className="divide-y divide-border text-sm">{alerts.data.map((a) => <li key={a.id} className="flex items-center gap-2 py-1.5"><span className="flex-1">{a.symbol} {a.condition} {a.price} {a.triggeredAt && <Badge tone="warning">triggered {fmtDate(a.triggeredAt)}</Badge>}{!a.active && !a.triggeredAt && <Badge>inactive</Badge>}</span><button className="btn-ghost btn-sm" onClick={async () => { await api(`/api/trading/alerts/${a.id}`, { method: "DELETE" }); all(); }}>✕</button></li>)}</ul>}</Card>
        </div>
      )}
      {tab === "brief" && (
        <Card title="Daily Market Brief" action={<button className="btn-primary btn-sm" disabled={busy || !aiConfigured} onClick={genBrief}>{busy ? "Generating…" : "Generate today's brief"}</button>}>
          <p className="mb-2 text-xs muted">Built only from the aggregated RSS headlines, your watchlist quotes and your registered events. Interpretation sections are AI and labelled as such. No buy/sell recommendations.</p>
          {brief.data ? <><p className="mb-2 text-xs muted">Generated {fmtDate(brief.data.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p><Markdown text={brief.data.content} /></> : <p className="text-sm muted">No brief yet.</p>}
        </Card>
      )}
      <Modal open={modal !== null} onClose={() => { setModal(null); setEditingStrategy(null); }} title={modal === "trade" ? `New ${mode} trade` : modal === "watch" ? "Add to watchlist" : modal === "alert" ? "Price alert" : modal === "account" ? "Trading account" : modal === "strategy" ? (editingStrategy ? "Edit strategy" : "New strategy") : "Economic event"} wide={modal === "trade" || modal === "strategy"}>
        <form onSubmit={submit} className="space-y-3">
          {modal === "trade" && <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Field label="Symbol"><input className="field" required autoFocus value={form.symbol ?? ""} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} /></Field>
              <Field label="Class"><select className="field" value={form.assetClass} onChange={(e) => setForm({ ...form, assetClass: e.target.value })}>{["stock", "etf", "crypto", "forex", "commodity", "index"].map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="Direction"><select className="field" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option value="long">long</option><option value="short">short</option></select></Field>
              <Field label="Status"><select className="field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["planned", "open", "closed"].map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="Account"><select className="field" value={form.accountId ?? ""} onChange={(e) => setForm({ ...form, accountId: e.target.value })}><option value="">default {mode}</option>{accounts.data?.filter((a) => a.mode === mode).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              <Field label="Strategy"><input className="field" value={form.strategy ?? ""} onChange={(e) => setForm({ ...form, strategy: e.target.value })} /></Field>
              <Field label="Timeframe"><input className="field" placeholder="1H, 4H, D" value={form.timeframe ?? ""} onChange={(e) => setForm({ ...form, timeframe: e.target.value })} /></Field>
              <Field label="Setup"><input className="field" value={form.setup ?? ""} onChange={(e) => setForm({ ...form, setup: e.target.value })} /></Field>
              {["entryPrice", "stopLoss", "target", "quantity", "exitPrice", "fees"].map((k) => <Field key={k} label={k.replace(/([A-Z])/g, " $1").toLowerCase()}><input className="field" type="number" step="any" value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>)}
              <Field label="Emotional state"><input className="field" value={form.emotionalState ?? ""} onChange={(e) => setForm({ ...form, emotionalState: e.target.value })} /></Field>
            </div>
            <Field label="Entry reason"><textarea className="field" rows={2} value={form.entryReason ?? ""} onChange={(e) => setForm({ ...form, entryReason: e.target.value })} /></Field>
            <Field label="Exit reason"><textarea className="field" rows={2} value={form.exitReason ?? ""} onChange={(e) => setForm({ ...form, exitReason: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="field" rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <p className="text-xs muted">P&L, risk and R multiple are calculated from entry/exit/stop/quantity — nothing is estimated.</p>
          </>}
          {modal === "watch" && <><div className="grid grid-cols-2 gap-2"><Field label="Symbol" hint="US stocks: AAPL · ETFs via stooq: vwce.de · crypto: BTC"><input className="field" required autoFocus value={form.symbol ?? ""} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} /></Field><Field label="Class"><select className="field" value={form.assetClass} onChange={(e) => setForm({ ...form, assetClass: e.target.value })}>{["stock", "etf", "crypto", "forex", "commodity", "index"].map((t) => <option key={t}>{t}</option>)}</select></Field></div><Field label="Notes"><input className="field" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></>}
          {modal === "alert" && <><div className="grid grid-cols-3 gap-2"><Field label="Symbol"><input className="field" required autoFocus value={form.symbol ?? ""} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} /></Field><Field label="Condition"><select className="field" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}><option value="above">above</option><option value="below">below</option></select></Field><Field label="Price"><input className="field" type="number" step="any" required value={form.price ?? ""} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field></div><Field label="Class"><select className="field" value={form.assetClass} onChange={(e) => setForm({ ...form, assetClass: e.target.value })}>{["stock", "etf", "crypto", "forex", "commodity", "index"].map((t) => <option key={t}>{t}</option>)}</select></Field></>}
          {modal === "account" && <><Field label="Name"><input className="field" required autoFocus value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><div className="grid grid-cols-3 gap-2"><Field label="Mode"><select className="field" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="paper">paper</option><option value="real">real</option></select></Field><Field label="Starting balance"><input className="field" type="number" step="0.01" value={form.startingBalance ?? ""} onChange={(e) => setForm({ ...form, startingBalance: e.target.value })} /></Field><Field label="Risk/trade %"><input className="field" type="number" step="0.1" value={form.riskPerTradePct ?? ""} onChange={(e) => setForm({ ...form, riskPerTradePct: e.target.value })} /></Field></div></>}
          {modal === "econ" && <><Field label="Title"><input className="field" required autoFocus value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field><div className="grid grid-cols-3 gap-2"><Field label="When"><input className="field" type="datetime-local" required value={form.at ?? ""} onChange={(e) => setForm({ ...form, at: e.target.value })} /></Field><Field label="Importance"><select className="field" value={form.importance} onChange={(e) => setForm({ ...form, importance: e.target.value })}>{["low", "medium", "high"].map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Category"><input className="field" value={form.category ?? ""} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field></div></>}
          {modal === "strategy" && <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Name"><input className="field" required autoFocus maxLength={100} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Timeframes" hint="Optional, e.g. 4H, D"><input className="field" maxLength={100} value={form.timeframes ?? ""} onChange={(e) => setForm({ ...form, timeframes: e.target.value })} /></Field>
            </div>
            <Field label="Description" hint="What setup is this?"><textarea className="field" rows={2} maxLength={5000} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Rules" hint="Entry, stop, target, invalidation — your own checklist"><textarea className="field" rows={5} maxLength={10000} value={form.rules ?? ""} onChange={(e) => setForm({ ...form, rules: e.target.value })} /></Field>
            <p className="text-xs muted">Renaming keeps every trade attached: analytics regroup under the new name rather than losing history.</p>
          </>}
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end"><Button variant="primary" type="submit" loading={saving}>Save</Button></div>
        </form>
      </Modal>
    </div>
  );
}

function WatchlistView({ watchlists, quotes, err, onRemove, onNote }: { watchlists: Watchlist[]; quotes: { quotes: Quote[]; missing: string[] } | null; err: string; onRemove?: (id: string) => void; onNote?: (id: string, notes: string) => void }) {
  const items = watchlists.flatMap((w) => w.items);
  if (!items.length) return <p className="text-sm muted">Watchlist is empty.</p>;
  return (
    <div>
      {err && <p className="mb-1 text-xs text-negative">{err}</p>}
      <ul className="divide-y divide-border text-sm">{items.map((i) => { const q = quotes?.quotes.find((x) => x.symbol === i.symbol); return <li key={i.id} className="flex items-center gap-2 py-1.5"><span className="flex-1"><span className="font-medium">{i.symbol}</span> <span className="text-xs muted">{i.assetClass}</span>{i.notes && <span className="block text-xs muted">{i.notes}</span>}</span>{q ? <span className="tnum text-right"><span>{fmtNum(q.price, 2)}</span> <span className={(q.changePct ?? 0) >= 0 ? "text-positive" : "text-negative"}>{q.changePct != null ? `${q.changePct >= 0 ? "+" : ""}${fmtNum(q.changePct, 2)}%` : ""}</span><span className="block text-[10px] muted">{q.provider} · {q.freshness}</span></span> : quotes?.missing.includes(i.symbol) ? <span className="text-xs muted">no price</span> : null}{onNote && <button className="btn-ghost btn-sm" onClick={() => { const v = prompt("Notes", i.notes ?? ""); if (v != null) onNote(i.id, v); }}>note</button>}{onRemove && <button className="btn-ghost btn-sm" onClick={() => onRemove(i.id)}>✕</button>}</li>; })}</ul>
    </div>
  );
}
