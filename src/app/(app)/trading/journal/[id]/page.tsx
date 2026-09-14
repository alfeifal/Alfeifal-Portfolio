"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, ErrorBox, Field, PageHeader, Spinner } from "@/components/ui";
import { api, fmtDate, fmtMoney, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";

interface Trade { id: string; symbol: string; direction: string; status: string; mode: string; assetClass: string; timeframe: string | null; setup: string | null; entryPrice: number | null; exitPrice: number | null; stopLoss: number | null; target: number | null; quantity: number | null; fees: number; riskAmount: number | null; pnl: number | null; rMultiple: number | null; openedAt: string | null; closedAt: string | null; entryReason: string | null; exitReason: string | null; emotionalState: string | null; notes: string | null; screenshots: string[]; source: string }

export default function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useShell();
  const router = useRouter();
  const t = useApi<Trade>(`/api/trading/trades/${id}`);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");
  const d = t.data;
  const startEdit = () => d && setForm({ exitPrice: d.exitPrice?.toString() ?? "", stopLoss: d.stopLoss?.toString() ?? "", target: d.target?.toString() ?? "", quantity: d.quantity?.toString() ?? "", entryPrice: d.entryPrice?.toString() ?? "", fees: String(d.fees), status: d.status, exitReason: d.exitReason ?? "", entryReason: d.entryReason ?? "", emotionalState: d.emotionalState ?? "", notes: d.notes ?? "", timeframe: d.timeframe ?? "", setup: d.setup ?? "", screenshots: d.screenshots.join("\n") });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return; setError("");
    const num = (k: string) => (form[k] ? Number(form[k]) : null);
    try { await api(`/api/trading/trades/${id}`, { method: "PATCH", json: { entryPrice: num("entryPrice"), exitPrice: num("exitPrice"), stopLoss: num("stopLoss"), target: num("target"), quantity: num("quantity"), fees: Number(form.fees || 0), status: form.status, exitReason: form.exitReason || null, entryReason: form.entryReason || null, emotionalState: form.emotionalState || null, notes: form.notes || null, timeframe: form.timeframe || null, setup: form.setup || null, screenshots: form.screenshots.split("\n").map((s) => s.trim()).filter(Boolean) } }); setForm(null); t.refresh(); } catch (err) { setError((err as Error).message); }
  };
  if (t.error) return <ErrorBox error={t.error} retry={t.reload} />;
  if (!d) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/trading", label: "Trading" }} title={<>{d.symbol} <Badge tone={d.direction === "long" ? "positive" : "negative"}>{d.direction}</Badge> <Badge tone={d.mode === "real" ? "warning" : "muted"}>{d.mode === "real" ? "REAL" : "SIMULATED"}</Badge> <Badge>{d.status}</Badge></>} subtitle={`${d.assetClass}${d.timeframe ? " · " + d.timeframe : ""}${d.setup ? " · " + d.setup : ""} · opened ${fmtDate(d.openedAt)}${d.closedAt ? " · closed " + fmtDate(d.closedAt) : ""}`} action={<><button className="btn-ghost btn-sm" onClick={startEdit}>Edit / close</button><button className="btn-ghost btn-sm text-negative" onClick={async () => { if (confirm("Delete trade?")) { await api(`/api/trading/trades/${id}`, { method: "DELETE" }); router.push("/trading"); } }}>Delete</button></>} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[["Entry", d.entryPrice], ["Exit", d.exitPrice], ["Stop", d.stopLoss], ["Target", d.target], ["Quantity", d.quantity], ["Risk", d.riskAmount != null ? fmtMoney(d.riskAmount, user.currency) : null], ["P&L", d.pnl != null ? fmtMoney(d.pnl, user.currency) : null], ["R multiple", d.rMultiple != null ? `${d.rMultiple}R` : null]].map(([k, v]) => <div key={String(k)} className="card p-3"><p className="text-xs muted">{k}</p><p className={"font-semibold tnum " + (k === "P&L" && d.pnl != null ? (d.pnl >= 0 ? "text-positive" : "text-negative") : "")}>{v ?? "—"}</p></div>)}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Entry reason"><p className="whitespace-pre-wrap text-sm">{d.entryReason || <span className="muted">—</span>}</p></Card>
        <Card title="Exit reason"><p className="whitespace-pre-wrap text-sm">{d.exitReason || <span className="muted">—</span>}</p></Card>
        <Card title="Emotional state & notes"><p className="text-sm">{d.emotionalState && <Badge>{d.emotionalState}</Badge>}</p><p className="mt-1 whitespace-pre-wrap text-sm">{d.notes || <span className="muted">—</span>}</p></Card>
        <Card title="Screenshots">{d.screenshots.length ? <ul className="space-y-1 text-sm">{d.screenshots.map((s) => <li key={s}><a className="link" href={s} target="_blank" rel="noreferrer">{s}</a></li>)}</ul> : <p className="text-sm muted">Add image URLs in edit mode.</p>}</Card>
      </div>
      {form && (
        <form onSubmit={save} className="card space-y-3 p-4">
          <h2 className="h2">Edit trade</h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {["entryPrice", "exitPrice", "stopLoss", "target", "quantity", "fees"].map((k) => <Field key={k} label={k}><input className="field" type="number" step="any" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>)}
            <Field label="Status"><select className="field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["planned", "open", "closed", "cancelled"].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Timeframe"><input className="field" value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value })} /></Field>
            <Field label="Setup"><input className="field" value={form.setup} onChange={(e) => setForm({ ...form, setup: e.target.value })} /></Field>
            <Field label="Emotional state"><input className="field" value={form.emotionalState} onChange={(e) => setForm({ ...form, emotionalState: e.target.value })} /></Field>
          </div>
          <Field label="Entry reason"><textarea className="field" rows={2} value={form.entryReason} onChange={(e) => setForm({ ...form, entryReason: e.target.value })} /></Field>
          <Field label="Exit reason"><textarea className="field" rows={2} value={form.exitReason} onChange={(e) => setForm({ ...form, exitReason: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="field" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <Field label="Screenshot URLs (one per line)"><textarea className="field" rows={2} value={form.screenshots} onChange={(e) => setForm({ ...form, screenshots: e.target.value })} /></Field>
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn-primary">Save</button></div>
        </form>
      )}
    </div>
  );
}
