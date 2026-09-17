"use client";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Stat, Tabs, Source, Button, SkeletonStats, useConfirm, usePrompt } from "@/components/ui";
import { api, fmtDate, fmtMoney, fmtNum, todayLocal, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";
import { MiniLine } from "@/components/charts";
import { initialParam } from "@/lib/urlparam";

interface Portfolio { positions: { asset: { id: string; symbol: string; name: string; assetClass: string; currency: string }; quantity: number; costBasis: number; avgCost: number | null; price: number | null; priceSource: string | null; priceAt: string | null; value: number | null; unrealized: number | null; unrealizedPct: number | null; realized: number }[]; accounts: { id: string; name: string; broker: string | null; cashBalance: number }[]; cash: number; totalValue: number; totalCost: number; unrealized: number; unpriced: string[]; allocation: { symbol: string; assetClass: string; value: number; pct: number }[]; netContributions: number; history: { date: string; totalValue: number; cash: number }[] }
interface Tx { id: string; type: string; date: string; quantity: number | null; price: number | null; amount: number; fees: number; symbol: string | null; accountName: string | null; source: string }
interface Asset { id: string; symbol: string; name: string; assetClass: string; manualPrice: number | null; providerSymbols: Record<string, string> }

export default function InvestingPage() {
  const { user } = useShell();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { ask, dialog: promptDialog } = usePrompt();
  const [editingAccount, setEditingAccount] = useState<{ id: string; name: string; broker: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const cur = user.currency;
  const [tab, setTab] = useState<"portfolio" | "transactions" | "assets">(() => initialParam("tab", ["portfolio", "transactions", "assets"] as const, "portfolio"));
  const [refresh, setRefresh] = useState(0);
  const p = useApi<Portfolio>(`/api/investing/portfolio${refresh ? "?refresh=1" : ""}`, [refresh]);
  const txs = useApi<Tx[]>("/api/investing/transactions");
  const assets = useApi<Asset[]>("/api/investing/assets");
  const [modal, setModal] = useState<null | "tx" | "asset" | "account">(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const all = () => { p.refresh(); txs.refresh(); assets.refresh(); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setSaving(true);
    try {
      if (modal === "tx") await api("/api/investing/transactions", { method: "POST", json: { accountId: form.accountId, assetId: form.assetId || null, type: form.type, date: form.date, quantity: form.quantity ? Number(form.quantity) : null, price: form.price ? Number(form.price) : null, amount: form.amount ? Number(form.amount) : undefined, fees: Number(form.fees || 0), notes: form.notes || null } });
      if (modal === "asset") await api("/api/investing/assets", { method: "POST", json: { symbol: form.symbol, name: form.name, assetClass: form.assetClass ?? "etf", currency: form.currency || "EUR", providerSymbols: form.stooq ? { stooq: form.stooq } : {}, manualPrice: form.manualPrice ? Number(form.manualPrice) : null } });
      if (modal === "account") {
        // The cash balance follows from the transactions, so it is only an opening figure at creation.
        if (editingAccount) await api(`/api/investing/accounts/${editingAccount.id}`, { method: "PATCH", json: { name: form.name, broker: form.broker || null } });
        else await api("/api/investing/accounts", { method: "POST", json: { name: form.name, broker: form.broker || null, currency: "EUR", cashBalance: Number(form.cashBalance || 0) } });
      }
      toast.success(modal === "tx" ? "Transaction recorded" : modal === "asset" ? "Asset added" : "Account created");
      toast.success(modal === "account" ? (editingAccount ? "Account updated" : "Account created") : "Saved", form.name ?? form.symbol ?? undefined);
      setModal(null); setForm({}); setEditingAccount(null); all();
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };
  const d = p.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Investing" subtitle="Long-term portfolio. Separate from active trading." action={<><button className="btn-ghost btn-sm" onClick={() => setRefresh((n) => n + 1)} disabled={p.loading}>Refresh prices</button><button className="btn-primary btn-sm" onClick={() => { setForm({ type: "buy", date: todayLocal(), accountId: d?.accounts[0]?.id ?? "" }); setModal("tx"); }}>+ Transaction</button></>} />
      <Tabs value={tab} onChange={setTab} options={[{ value: "portfolio", label: "Portfolio" }, { value: "transactions", label: "Transactions" }, { value: "assets", label: "Assets & accounts" }]} />
      {p.error && <ErrorBox error={p.error} retry={p.reload} />}
      {p.loading && !d && <SkeletonStats />}
      {d && tab === "portfolio" && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Total value" count={d.totalValue + d.cash} format={(v) => fmtMoney(v, cur)} sub={`incl. cash ${fmtMoney(d.cash, cur)}`} />
            <Stat label="Cost basis" count={d.totalCost} format={(v) => fmtMoney(v, cur)} sub={`net contributions ${fmtMoney(d.netContributions, cur)}`} />
            <Stat label="Unrealized" count={d.unrealized} format={(v) => fmtMoney(v, cur)} tone={d.unrealized >= 0 ? "positive" : "negative"} sub={d.unpriced.length ? `${d.unpriced.length} position(s) without price` : "priced positions"} />
            <Stat label="Positions" value={d.positions.filter((x) => x.quantity > 0).length} sub={`${d.accounts.length} accounts`} />
          </div>
          {d.accounts.length === 0 && <Empty>Create an investment account first.<button className="btn-ghost btn-sm ml-2" onClick={() => { setForm({}); setModal("account"); }}>+ Account</button></Empty>}
          <Card title="Positions">
            {d.positions.filter((x) => x.quantity > 0).length === 0 ? <p className="text-sm muted">No open positions. Record a buy and the position, its average cost and its value appear here.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs muted"><th className="py-1">Asset</th><th>Qty</th><th>Avg cost</th><th>Price</th><th>Value</th><th>P&L</th></tr></thead><tbody>
                {d.positions.filter((x) => x.quantity > 0).map((x) => <tr key={x.asset.id} className="border-t border-border"><td className="py-1.5"><span className="font-medium">{x.asset.symbol}</span> <span className="muted">{x.asset.name}</span> <Badge>{x.asset.assetClass}</Badge></td><td className="tnum">{fmtNum(x.quantity, 4)}</td><td className="tnum">{x.avgCost != null ? fmtNum(x.avgCost, 2) : "—"}</td><td className="tnum">{x.price != null ? <>{fmtNum(x.price, 2)} <span className="text-[10px] muted">{x.priceSource}{x.priceAt ? " · " + fmtDate(x.priceAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span></> : <span className="muted">no price</span>}</td><td className="tnum">{x.value != null ? fmtMoney(x.value, cur) : "—"}</td><td className={"tnum " + ((x.unrealized ?? 0) >= 0 ? "text-positive" : "text-negative")}>{x.unrealized != null ? `${fmtMoney(x.unrealized, cur)} (${x.unrealizedPct}%)` : "—"}</td></tr>)}
              </tbody></table></div>
            )}
            {d.unpriced.length > 0 && <p className="mt-2 text-xs muted">No provider price for: {d.unpriced.join(", ")}. Set a stooq symbol (e.g. vwce.de) or a manual price on the asset. Prices are never estimated.</p>}
          </Card>
          <div className="grid gap-3 md:grid-cols-2">
            <Card title="Allocation">{d.allocation.length ? <ul className="space-y-1 text-sm">{d.allocation.map((a) => <li key={a.symbol} className="flex justify-between"><span>{a.symbol} <span className="muted">· {a.assetClass}</span></span><span className="tnum">{a.pct}% · {fmtMoney(a.value, cur)}</span></li>)}</ul> : <p className="text-sm muted">Nothing priced yet.</p>}</Card>
            <Card title="Portfolio history"><MiniLine series={d.history.map((h) => ({ label: h.date.slice(5), v: h.totalValue + h.cash }))} label="Value" format={(v) => fmtMoney(v, cur)} />{d.history.length === 0 && <p className="text-xs muted">Snapshots are taken when you refresh prices or by the hourly cron.</p>}</Card>
          </div>
        </>
      )}
      {tab === "transactions" && (txs.loading && !txs.data ? <Spinner /> : !txs.data?.length ? <Empty title="No investment transactions">Record a buy, a contribution or a dividend and your positions, cost basis and cash balance follow from it.</Empty> : <ul className="card divide-y divide-border">{txs.data.map((t) => <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="w-12 text-xs muted">{fmtDate(t.date)}</span><span className="flex-1"><Badge tone={t.type === "buy" || t.type === "contribution" ? "positive" : t.type === "sell" || t.type === "withdrawal" ? "warning" : "muted"}>{t.type}</Badge> {t.symbol ?? ""} {t.quantity ? `${fmtNum(t.quantity, 4)} @ ${fmtNum(t.price ?? 0, 2)}` : ""}<span className="ml-1 text-xs muted">{t.accountName}</span> <Source source={t.source === "ai" ? "ai" : null} /></span><span className="tnum">{fmtMoney(t.amount, cur)}</span><button className="btn-ghost btn-sm" onClick={() => confirm(async () => { await api(`/api/investing/transactions/${t.id}`, { method: "DELETE" }); toast.success("Transaction deleted"); all(); }, { title: "Delete transaction?" })}>✕</button></li>)}</ul>)}
      {tab === "assets" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card title="Assets" action={<button className="btn-primary btn-sm" onClick={() => { setForm({ assetClass: "etf", currency: "EUR" }); setModal("asset"); }}>+ Asset</button>}>{!assets.data?.length ? <p className="text-sm muted">Add ETFs, stocks, commodities…</p> : <ul className="divide-y divide-border text-sm">{assets.data.map((a) => <li key={a.id} className="flex items-center gap-2 py-2"><span className="flex-1"><span className="font-medium">{a.symbol}</span> {a.name} <Badge>{a.assetClass}</Badge>{a.providerSymbols.stooq && <span className="text-xs muted"> · stooq {a.providerSymbols.stooq}</span>}{a.manualPrice != null && <span className="text-xs muted"> · manual {a.manualPrice}</span>}</span><button className="btn-ghost btn-sm" onClick={() => ask(async (v) => { await api(`/api/investing/assets/${a.id}`, { method: "PATCH", json: { manualPrice: v ? Number(v) : null } }); all(); toast.success(v ? "Manual price set" : "Manual price cleared", a.symbol); }, { title: `${a.symbol} manual price`, label: "Price", hint: "Leave it empty to go back to the provider price.", type: "number", step: "any", min: "0", initial: a.manualPrice?.toString() ?? "" })}>price</button><button className="btn-ghost btn-sm" onClick={() => confirm(async () => { await api(`/api/investing/assets/${a.id}`, { method: "DELETE" }); toast.success("Asset deleted"); all(); }, { title: "Delete asset?", description: a.symbol })}>✕</button></li>)}</ul>}</Card>
          <Card title="Accounts" action={<button className="btn-primary btn-sm" onClick={() => { setForm({}); setModal("account"); }}>+ Account</button>}>{!d?.accounts.length ? <p className="text-sm muted">No investment accounts yet — add one to record contributions, buys and dividends against it.</p> : <ul className="divide-y divide-border text-sm">{d.accounts.map((a) => <li key={a.id} className="flex items-center gap-2 py-2"><span className="flex-1">{a.name}{a.broker && <span className="muted"> · {a.broker}</span>}</span><span className="tnum">cash {fmtMoney(a.cashBalance, cur)}</span><button className="btn-ghost btn-sm" onClick={() => { setEditingAccount(a); setForm({ name: a.name, broker: a.broker ?? "" }); setModal("account"); }}>edit</button><button className="btn-ghost btn-sm" onClick={() => confirm(async () => { await api(`/api/investing/accounts/${a.id}`, { method: "DELETE" }); toast.success("Account deleted"); all(); }, { title: "Delete account and its transactions?", description: a.name })}>✕</button></li>)}</ul>}</Card>
        </div>
      )}
      <Modal open={modal !== null} onClose={() => { setModal(null); setEditingAccount(null); }} title={modal === "tx" ? "Investment transaction" : modal === "asset" ? "New asset" : editingAccount ? "Edit investment account" : "New investment account"}>
        <form onSubmit={submit} className="space-y-3">
          {modal === "tx" && <>
            <div className="grid grid-cols-2 gap-2"><Field label="Account"><select className="field" required value={form.accountId ?? ""} onChange={(e) => setForm({ ...form, accountId: e.target.value })}><option value="">—</option>{d?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><Field label="Type"><select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{["buy", "sell", "contribution", "withdrawal", "dividend", "fee", "interest"].map((t) => <option key={t}>{t}</option>)}</select></Field></div>
            {(form.type === "buy" || form.type === "sell" || form.type === "dividend") && <Field label="Asset"><select className="field" required={form.type !== "dividend"} value={form.assetId ?? ""} onChange={(e) => setForm({ ...form, assetId: e.target.value })}><option value="">—</option>{assets.data?.map((a) => <option key={a.id} value={a.id}>{a.symbol} · {a.name}</option>)}</select></Field>}
            <div className="grid grid-cols-2 gap-2"><Field label="Date"><input className="field" type="date" required value={form.date ?? ""} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field><Field label="Fees"><input className="field" type="number" step="0.01" value={form.fees ?? ""} onChange={(e) => setForm({ ...form, fees: e.target.value })} /></Field>
            {(form.type === "buy" || form.type === "sell") ? <><Field label="Quantity"><input className="field" type="number" step="any" required value={form.quantity ?? ""} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field><Field label="Price"><input className="field" type="number" step="any" required value={form.price ?? ""} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field></> : <Field label="Amount"><input className="field" type="number" step="0.01" required value={form.amount ?? ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>}</div>
          </>}
          {modal === "asset" && <><div className="grid grid-cols-2 gap-2"><Field label="Symbol"><input className="field" required autoFocus value={form.symbol ?? ""} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} /></Field><Field label="Class"><select className="field" value={form.assetClass} onChange={(e) => setForm({ ...form, assetClass: e.target.value })}>{["etf", "stock", "bond", "commodity", "crypto", "fund", "cash", "real_estate", "other"].map((t) => <option key={t}>{t}</option>)}</select></Field></div><Field label="Name"><input className="field" required value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Stooq symbol" hint="e.g. vwce.de, aapl.us, xauusd"><input className="field" value={form.stooq ?? ""} onChange={(e) => setForm({ ...form, stooq: e.target.value })} /></Field><Field label="Manual price" hint="Used when no provider price"><input className="field" type="number" step="any" value={form.manualPrice ?? ""} onChange={(e) => setForm({ ...form, manualPrice: e.target.value })} /></Field></div></>}
          {modal === "account" && <><Field label="Name"><input className="field" required autoFocus value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Broker"><input className="field" value={form.broker ?? ""} onChange={(e) => setForm({ ...form, broker: e.target.value })} /></Field>{!editingAccount && <Field label="Opening cash" hint="After this, the balance follows the transactions."><input className="field" type="number" step="0.01" value={form.cashBalance ?? ""} onChange={(e) => setForm({ ...form, cashBalance: e.target.value })} /></Field>}</div></>}
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end"><Button variant="primary" type="submit" loading={saving}>Save</Button></div>
        </form>
      </Modal>
      {dialog}
      {promptDialog}
    </div>
  );
}
