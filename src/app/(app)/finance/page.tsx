"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { T } from "@/components/motion";
import { useToast } from "@/components/toast";
import { Badge, Bar, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Stat, Tabs, Source, Button, SkeletonStats, SkeletonList, useConfirm } from "@/components/ui";
import { api, fmtDate, fmtMoney, todayLocal, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";
import type { Transaction } from "@/lib/types";
import { MiniBars } from "@/components/charts";
import { useFocusParam } from "@/lib/focus";
import { cn } from "@/lib/utils";
import { initialMatch, initialParam } from "@/lib/urlparam";

interface Summary { range: { from: string; to: string }; income: number; expenses: number; net: number; savingsRate: number | null; byCategory: { categoryId: string | null; name: string; total: number; count: number }[]; budgets: { id: string; name: string; amount: number; spent: number; remaining: number; pct: number; categoryId: string | null }[]; accounts: { id: string; name: string; type: string; balance: number; isDefault: boolean }[]; financeBalance: number; daily: { date: string; type: string; total: number }[]; monthly: { month: string; income: number; expenses: number }[] }
interface Category { id: string; name: string; kind: string }
interface Recurring { id: string; type: string; amount: number; description: string; frequency: string; nextDate: string; active: boolean }
interface Savings { id: string; name: string; targetAmount: number; currentAmount: number; deadline: string | null }

function monthKey(offset = 0) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return d.toISOString().slice(0, 7); }
function monthRange(m: string) { const [y, mo] = m.split("-").map(Number); const last = new Date(y, mo, 0).getDate(); return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` }; }

export default function FinancePage() {
  const { user } = useShell();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [saving, setSaving] = useState(false);
  const cur = user.currency;
  const [tab, setTab] = useState<"overview" | "transactions" | "budgets" | "accounts" | "recurring" | "savings">(() => initialParam("tab", ["overview", "transactions", "budgets", "accounts", "recurring", "savings"] as const, "overview"));
  const [month, setMonth] = useState(() => initialMatch("month", /^\d{4}-\d{2}$/, monthKey()));
  const r = monthRange(month);
  const summary = useApi<Summary>(`/api/finance/summary?from=${r.from}&to=${r.to}`, [month]);
  const txs = useApi<Transaction[]>(`/api/finance/transactions?from=${r.from}&to=${r.to}&limit=500`, [month]);
  const focusProps = useFocusParam(Boolean(txs.data)); // deep link from a search result
  const cats = useApi<Category[]>("/api/finance/categories");
  const recurring = useApi<Recurring[]>("/api/finance/recurring");
  const savings = useApi<Savings[]>("/api/finance/savings");
  const [modal, setModal] = useState<null | "tx" | "account" | "budget" | "recurring" | "savings" | "category">(null);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const refreshAll = () => { summary.refresh(); txs.refresh(); recurring.refresh(); savings.refresh(); cats.refresh(); };
  const openTx = (t?: Transaction) => { setEditingTx(t ?? null); setForm(t ? { type: t.type, amount: String(t.amount), date: t.date, description: t.description, categoryId: t.categoryId ?? "", accountId: t.accountId ?? "", toAccountId: t.toAccountId ?? "", merchant: t.merchant ?? "" } : { type: "expense", amount: "", date: todayLocal(), description: "", categoryId: "", accountId: summary.data?.accounts.find((a) => a.isDefault)?.id ?? "", toAccountId: "", merchant: "" }); setModal("tx"); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setSaving(true);
    try {
      if (modal === "tx") { const body = { type: form.type, amount: Number(form.amount), date: form.date, description: form.description, categoryId: form.categoryId || null, accountId: form.accountId || null, toAccountId: form.toAccountId || null, merchant: form.merchant || null }; if (editingTx) { await api(`/api/finance/transactions/${editingTx.id}`, { method: "PATCH", json: body }); toast.success("Transaction updated"); } else { await api("/api/finance/transactions", { method: "POST", json: body }); toast.success(form.type === "expense" ? "Expense added" : form.type === "income" ? "Income added" : "Transfer recorded", `${fmtMoney(Number(form.amount), cur)}${form.description ? " · " + form.description : ""}`); } }
      if (modal === "account") await api("/api/finance/accounts", { method: "POST", json: { name: form.name, type: form.type ?? "checking", openingBalance: Number(form.openingBalance || 0), institution: form.institution || null, isDefault: form.isDefault === "1" } });
      if (modal === "budget") await api("/api/finance/budgets", { method: "POST", json: { categoryId: form.categoryId || null, amount: Number(form.amount), period: "monthly" } });
      if (modal === "recurring") await api("/api/finance/recurring", { method: "POST", json: { type: form.type ?? "expense", amount: Number(form.amount), description: form.description, categoryId: form.categoryId || null, frequency: form.frequency ?? "monthly", nextDate: form.nextDate, dayOfMonth: form.nextDate ? Number(form.nextDate.slice(8)) : null } });
      if (modal === "savings") await api("/api/finance/savings", { method: "POST", json: { name: form.name, targetAmount: Number(form.targetAmount), currentAmount: Number(form.currentAmount || 0), deadline: form.deadline || null, monthlyContribution: form.monthlyContribution ? Number(form.monthlyContribution) : null } });
      if (modal === "category") await api("/api/finance/categories", { method: "POST", json: { name: form.name, kind: form.kind ?? "expense" } });
      if (modal !== "tx") toast.success("Saved");
      setModal(null); setForm({}); refreshAll();
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };
  const del = (path: string, msg: string) => confirm(async () => { await api(path, { method: "DELETE" }); setModal(null); toast.success("Deleted"); refreshAll(); }, { title: msg });
  const s = summary.data;
  const expenseCats = cats.data?.filter((c) => c.kind === "expense") ?? [];
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "tx") setTimeout(() => openTx(), 50); }, []);
  return (
    <div className="space-y-4">
      <PageHeader title="Finance" subtitle="Accounts, income, expenses, budgets, recurring and savings." action={<><input type="month" className="field !w-auto !py-1.5 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} /><button className="btn-primary" onClick={() => openTx()}>+ Transaction</button></>} />
      <Tabs value={tab} onChange={setTab} options={[{ value: "overview", label: "Overview" }, { value: "transactions", label: "Transactions" }, { value: "budgets", label: "Budgets" }, { value: "accounts", label: "Accounts" }, { value: "recurring", label: "Recurring" }, { value: "savings", label: "Savings" }]} />
      {summary.error && <ErrorBox error={summary.error} retry={summary.reload} />}
      {summary.loading && !s && <><SkeletonStats /><div className="mt-3 grid gap-3 md:grid-cols-2">{[0, 1].map((i) => <div key={i} className="card h-48 shimmer" />)}</div></>}
      {s && tab === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Income" count={s.income} format={(v) => fmtMoney(v, cur)} tone="positive" />
            <Stat label="Expenses" count={s.expenses} format={(v) => fmtMoney(v, cur)} tone="negative" />
            <Stat label="Net" count={s.net} format={(v) => fmtMoney(v, cur)} sub={s.savingsRate != null ? `savings rate ${s.savingsRate}%` : "no income"} />
            <Stat label="Cash (Finance)" count={s.financeBalance} format={(v) => fmtMoney(v, cur)} sub={`${s.accounts.length} accounts · excludes investing & trading`} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Card title="Spending by category">
              {s.byCategory.length === 0 ? <p className="text-sm muted">No expenses this month.</p> : <ul className="space-y-2">{s.byCategory.map((c) => <li key={c.name}><div className="flex justify-between text-sm"><span>{c.name} <span className="muted">· {c.count}</span></span><span className="tnum">{fmtMoney(c.total, cur)}</span></div><Bar value={s.expenses ? c.total / s.expenses : 0} tone="negative" h={4} /></li>)}</ul>}
            </Card>
            <Card title="Income vs expenses · last months">
              {s.monthly.length ? <MiniBars series={s.monthly.map((m) => ({ label: m.month.slice(5), a: m.income, b: m.expenses }))} labels={["Income", "Expenses"]} format={(v) => fmtMoney(v, cur)} /> : <p className="text-sm muted">Not enough history.</p>}
            </Card>
            <Card title="Budgets" action={<button className="btn-ghost btn-sm" onClick={() => setTab("budgets")}>Manage</button>}>
              {s.budgets.length === 0 ? <p className="text-sm muted">No budgets set.</p> : <ul className="space-y-2">{s.budgets.map((b) => <li key={b.id}><div className="flex justify-between text-sm"><span>{b.name}</span><span className="tnum">{fmtMoney(b.spent, cur)} / {fmtMoney(b.amount, cur)}</span></div><Bar value={b.amount ? b.spent / b.amount : 0} tone={b.pct > 100 ? "negative" : b.pct > 80 ? "warning" : "positive"} h={4} /></li>)}</ul>}
            </Card>
            <Card title="Cash flow this month">
              <MiniBars series={Object.values(s.daily.reduce((acc, d) => { const k = d.date.slice(8); acc[k] = acc[k] ?? { label: k, a: 0, b: 0 }; if (d.type === "income") acc[k].a += d.total; else acc[k].b += d.total; return acc; }, {} as Record<string, { label: string; a: number; b: number }>))} labels={["Income", "Expenses"]} format={(v) => fmtMoney(v, cur)} />
            </Card>
          </div>
        </>
      )}
      {tab === "transactions" && (
        txs.error ? <ErrorBox error={txs.error} retry={txs.reload} /> : txs.loading && !txs.data ? <SkeletonList rows={6} /> : !txs.data?.length ? <Empty title={`No transactions in ${month}`} action={<Button variant="primary" size="sm" onClick={() => openTx()}>Add a transaction</Button>}>Expenses, income and transfers for this month will appear here.</Empty> : (
          <ul className="card divide-y divide-border overflow-hidden"><AnimatePresence initial={false}>{txs.data.map((t) => <m.li key={t.id} {...focusProps(t.id)} layout="position" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={T.enter} className={cn("row", focusProps(t.id).className)}><button className="flex w-full items-center gap-3 px-3 py-2 text-left" onClick={() => openTx(t)}><span className="w-12 shrink-0 text-xs muted">{fmtDate(t.date)}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{t.description || t.merchant || t.categoryName || t.type}</span><span className="block text-xs muted">{t.categoryName ?? (t.type === "transfer" ? "transfer" : "uncategorized")}{t.accountName ? ` · ${t.accountName}` : ""} <Source source={t.source === "ai" ? "ai" : null} /></span></span><span className={"tnum text-sm font-medium " + (t.type === "income" ? "text-positive" : t.type === "expense" ? "" : "muted")}>{t.type === "income" ? "+" : t.type === "expense" ? "−" : "↔"}{fmtMoney(t.amount, t.currency)}</span></button></m.li>)}</AnimatePresence></ul>
        )
      )}
      {tab === "budgets" && s && (
        <Card title="Monthly budgets" action={<button className="btn-primary btn-sm" onClick={() => { setForm({}); setModal("budget"); }}>+ Budget</button>}>
          {s.budgets.length === 0 ? <p className="text-sm muted">Set a total budget or per-category budgets.</p> : <ul className="divide-y divide-border">{s.budgets.map((b) => <li key={b.id} className="flex items-center gap-3 py-2 text-sm"><span className="flex-1">{b.name}</span><span className="tnum">{fmtMoney(b.spent, cur)} / {fmtMoney(b.amount, cur)}</span><Badge tone={b.pct > 100 ? "negative" : "muted"}>{b.pct}%</Badge><button className="btn-ghost btn-sm" onClick={() => del(`/api/finance/budgets/${b.id}`, "Remove budget?")}>✕</button></li>)}</ul>}
        </Card>
      )}
      {tab === "accounts" && s && (
        <Card title="Accounts" action={<button className="btn-primary btn-sm" onClick={() => { setForm({ type: "checking" }); setModal("account"); }}>+ Account</button>}>
          <ul className="divide-y divide-border">{s.accounts.map((a) => <li key={a.id} className="flex items-center gap-3 py-2 text-sm"><span className="flex-1">{a.name} {a.isDefault && <Badge>default</Badge>}<span className="block text-xs muted">{a.type}</span></span><span className="tnum font-medium">{fmtMoney(a.balance, cur)}</span><button className="btn-ghost btn-sm" onClick={() => del(`/api/finance/accounts/${a.id}`, "Delete account? Its transactions keep existing without account.")}>✕</button></li>)}</ul>
          <div className="mt-3 flex items-center justify-between"><p className="text-xs muted">Categories: {cats.data?.length ?? 0}</p><button className="btn-ghost btn-sm" onClick={() => { setForm({ kind: "expense" }); setModal("category"); }}>+ Category</button></div>
        </Card>
      )}
      {tab === "recurring" && (
        <Card title="Recurring transactions" action={<button className="btn-primary btn-sm" onClick={() => { setForm({ type: "expense", frequency: "monthly", nextDate: todayLocal() }); setModal("recurring"); }}>+ Recurring</button>}>
          {!recurring.data?.length ? <p className="text-sm muted">Rent, subscriptions, salary… they are posted automatically on their date.</p> : <ul className="divide-y divide-border">{recurring.data.map((x) => <li key={x.id} className="flex items-center gap-3 py-2 text-sm"><span className="flex-1">{x.description}<span className="block text-xs muted">{x.frequency} · next {fmtDate(x.nextDate)}</span></span><span className={"tnum " + (x.type === "income" ? "text-positive" : "")}>{fmtMoney(x.amount, cur)}</span><button className="btn-ghost btn-sm" onClick={() => del(`/api/finance/recurring/${x.id}`, "Delete recurring?")}>✕</button></li>)}</ul>}
        </Card>
      )}
      {tab === "savings" && (
        <Card title="Savings goals" action={<button className="btn-primary btn-sm" onClick={() => { setForm({}); setModal("savings"); }}>+ Goal</button>}>
          {!savings.data?.length ? <p className="text-sm muted">No savings goals yet.</p> : <ul className="space-y-3">{savings.data.map((g) => <li key={g.id}><div className="flex items-center justify-between text-sm"><span>{g.name}{g.deadline && <span className="muted"> · by {fmtDate(g.deadline)}</span>}</span><span className="tnum">{fmtMoney(g.currentAmount, cur)} / {fmtMoney(g.targetAmount, cur)}</span></div><Bar value={g.targetAmount ? g.currentAmount / g.targetAmount : 0} tone="positive" /><div className="mt-1 flex gap-2 text-xs"><button className="link" onClick={async () => { const v = prompt("New current amount", String(g.currentAmount)); if (v == null) return; await api(`/api/finance/savings/${g.id}`, { method: "PATCH", json: { currentAmount: Number(v), targetAmount: g.targetAmount } }); refreshAll(); }}>Update amount</button><button className="link" onClick={() => del(`/api/finance/savings/${g.id}`, "Delete savings goal?")}>Delete</button></div></li>)}</ul>}
        </Card>
      )}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === "tx" ? (editingTx ? "Edit transaction" : "New transaction") : modal === "account" ? "New account" : modal === "budget" ? "Budget" : modal === "recurring" ? "Recurring transaction" : modal === "savings" ? "Savings goal" : "Category"}>
        <form onSubmit={submit} className="space-y-3">
          {modal === "tx" && <>
            <div className="grid grid-cols-3 gap-1">{["expense", "income", "transfer"].map((t) => <button type="button" key={t} className={"rounded-lg border px-2 py-1.5 text-sm " + (form.type === t ? "border-accent bg-accent text-accent-fg" : "border-border")} onClick={() => setForm({ ...form, type: t })}>{t}</button>)}</div>
            <div className="grid grid-cols-2 gap-2"><Field label="Amount"><input className="field" type="number" step="0.01" min="0.01" required autoFocus inputMode="decimal" value={form.amount ?? ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Date"><input className="field" type="date" required value={form.date ?? ""} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field></div>
            <Field label="Description"><input className="field" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            {form.type !== "transfer" && <Field label="Category"><select className="field" value={form.categoryId ?? ""} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">—</option>{cats.data?.filter((c) => c.kind === form.type).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            <div className="grid grid-cols-2 gap-2"><Field label={form.type === "transfer" ? "From account" : "Account"}><select className="field" value={form.accountId ?? ""} onChange={(e) => setForm({ ...form, accountId: e.target.value })}><option value="">—</option>{s?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>{form.type === "transfer" ? <Field label="To account"><select className="field" required value={form.toAccountId ?? ""} onChange={(e) => setForm({ ...form, toAccountId: e.target.value })}><option value="">—</option>{s?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field> : <Field label="Merchant"><input className="field" value={form.merchant ?? ""} onChange={(e) => setForm({ ...form, merchant: e.target.value })} /></Field>}</div>
          </>}
          {modal === "account" && <><Field label="Name"><input className="field" required autoFocus value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Type"><select className="field" value={form.type ?? "checking"} onChange={(e) => setForm({ ...form, type: e.target.value })}>{["checking", "savings", "cash", "credit", "investment", "other"].map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Opening balance"><input className="field" type="number" step="0.01" value={form.openingBalance ?? ""} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} /></Field></div><Field label="Institution"><input className="field" value={form.institution ?? ""} onChange={(e) => setForm({ ...form, institution: e.target.value })} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isDefault === "1"} onChange={(e) => setForm({ ...form, isDefault: e.target.checked ? "1" : "0" })} />Default account</label></>}
          {modal === "budget" && <><Field label="Category" hint="Leave empty for the total monthly budget"><select className="field" value={form.categoryId ?? ""} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">Total</option>{expenseCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Monthly amount"><input className="field" type="number" step="0.01" required autoFocus value={form.amount ?? ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field></>}
          {modal === "recurring" && <><div className="grid grid-cols-2 gap-2"><Field label="Type"><select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="expense">expense</option><option value="income">income</option></select></Field><Field label="Amount"><input className="field" type="number" step="0.01" required value={form.amount ?? ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field></div><Field label="Description"><input className="field" required value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Frequency"><select className="field" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>{["monthly", "weekly", "yearly"].map((f) => <option key={f}>{f}</option>)}</select></Field><Field label="Next date"><input className="field" type="date" required value={form.nextDate ?? ""} onChange={(e) => setForm({ ...form, nextDate: e.target.value })} /></Field></div><Field label="Category"><select className="field" value={form.categoryId ?? ""} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">—</option>{cats.data?.filter((c) => c.kind === (form.type ?? "expense")).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></>}
          {modal === "savings" && <><Field label="Name"><input className="field" required autoFocus value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Target"><input className="field" type="number" step="0.01" required value={form.targetAmount ?? ""} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} /></Field><Field label="Current"><input className="field" type="number" step="0.01" value={form.currentAmount ?? ""} onChange={(e) => setForm({ ...form, currentAmount: e.target.value })} /></Field><Field label="Deadline"><input className="field" type="date" value={form.deadline ?? ""} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field><Field label="Monthly contribution"><input className="field" type="number" step="0.01" value={form.monthlyContribution ?? ""} onChange={(e) => setForm({ ...form, monthlyContribution: e.target.value })} /></Field></div></>}
          {modal === "category" && <><Field label="Name"><input className="field" required autoFocus value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Kind"><select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="expense">expense</option><option value="income">income</option></select></Field></>}
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-between">{modal === "tx" && editingTx ? <Button type="button" className="text-negative" onClick={() => del(`/api/finance/transactions/${editingTx.id}`, "Delete transaction?")}>Delete</Button> : <span />}<Button variant="primary" type="submit" loading={saving}>Save</Button></div>
        </form>
      </Modal>
      {dialog}
    </div>
  );
}
