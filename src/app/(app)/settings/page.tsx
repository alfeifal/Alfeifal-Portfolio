"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, Card, ErrorBox, Field, PageHeader, Spinner, Source, AsyncButton } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, fmtDate, useApi } from "@/lib/client";
import { useTheme } from "@/components/theme";

interface Me { id: string; email: string; name: string; timezone: string; currency: string; locale: string; preferences: Record<string, unknown>; aiConfigured: boolean; marketProviders: Record<string, boolean> }
interface Memory { id: string; kind: string; key: string | null; content: string; importance: number; pinned: boolean; source: string; updatedAt: string }
interface ActionLog { id: string; tool: string; risk: string; status: string; summary: string | null; error: string | null; createdAt: string }
const WIDGETS = ["today", "finance", "goals", "projects", "training", "studies", "investing", "trading", "news"];

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const me = useApi<Me>("/api/me");
  const memory = useApi<Memory[]>("/api/ai/memory");
  const actions = useApi<ActionLog[]>("/api/ai/actions?limit=50");
  const { theme, setTheme } = useTheme();
  const [profile, setProfile] = useState({ name: "", timezone: "", currency: "" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [msg, setMsg] = useState("");
  const [mem, setMem] = useState({ kind: "fact", key: "", content: "" });
  const [del, setDel] = useState({ password: "", confirm: "" });
  useEffect(() => { if (me.data) setProfile({ name: me.data.name, timezone: me.data.timezone, currency: me.data.currency }); }, [me.data]);
  const d = me.data;
  const widgets = ((d?.preferences.dashboard as { widgets?: string[] } | undefined)?.widgets) ?? WIDGETS;
  const ai = (d?.preferences.ai as { confirmMedium?: boolean } | undefined) ?? {};
  const savePrefs = async (patch: Record<string, unknown>) => { await api("/api/me/preferences", { method: "PATCH", json: patch }); me.refresh(); };
  const flash = (m: string) => { setMsg(""); toast.success(m); };
  if (me.error) return <ErrorBox error={me.error} retry={me.reload} />;
  if (!d) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle={d.email} />
      {msg && <p className="rounded-xl bg-positive/10 p-2 text-sm text-positive">{msg}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Profile">
          <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); await api("/api/me", { method: "PATCH", json: profile }); flash("Profile saved"); router.refresh(); }}>
            <Field label="Name"><input className="field" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Timezone"><input className="field" value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} /></Field><Field label="Currency"><input className="field" maxLength={3} value={profile.currency} onChange={(e) => setProfile({ ...profile, currency: e.target.value.toUpperCase() })} /></Field></div>
            <button className="btn-primary btn-sm">Save</button>
          </form>
        </Card>
        <Card title="Appearance">
          <div className="flex gap-2">{(["light", "dark", "system"] as const).map((t) => <button key={t} className={"btn-ghost btn-sm capitalize " + (theme === t ? "!bg-accent !text-accent-fg" : "")} onClick={() => setTheme(t)}>{t}</button>)}</div>
          <p className="mt-3 mb-1 text-sm font-medium">Home widgets</p>
          <div className="flex flex-wrap gap-1.5">{WIDGETS.map((w) => <button key={w} className={"pill capitalize " + (widgets.includes(w) ? "!bg-accent !text-accent-fg" : "")} onClick={() => savePrefs({ dashboard: { widgets: widgets.includes(w) ? widgets.filter((x) => x !== w) : [...widgets, w] } })}>{w}</button>)}</div>
        </Card>
        <Card title="Security">
          <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); try { await api("/api/me/password", { method: "POST", json: pw }); setPw({ currentPassword: "", newPassword: "" }); flash("Password changed; other sessions signed out"); } catch (err) { toast.error("Password not changed", (err as Error).message); } }}>
            <Field label="Current password"><input className="field" type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
            <Field label="New password (10+ chars)"><input className="field" type="password" autoComplete="new-password" required minLength={10} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            <div className="flex gap-2"><button className="btn-primary btn-sm">Change password</button><button type="button" className="btn-ghost btn-sm" onClick={async () => { await api("/api/me/sessions", { method: "DELETE" }); flash("Other devices signed out"); }}>Sign out other devices</button></div>
          </form>
        </Card>
        <Card title="Integrations & providers">
          <ul className="space-y-1 text-sm">
            <li>AI assistant (Anthropic): {d.aiConfigured ? <Badge tone="positive">configured</Badge> : <Badge tone="warning">missing ANTHROPIC_API_KEY</Badge>}</li>
            <li>Quotes · Finnhub (realtime): {d.marketProviders.finnhub ? <Badge tone="positive">on</Badge> : <Badge>off — add FINNHUB_API_KEY</Badge>}</li>
            <li>Quotes · Stooq + Yahoo (delayed, no key): <Badge tone="positive">on</Badge> · CoinGecko (crypto): <Badge tone="positive">on</Badge></li>
            <li>News · RSS feeds: <Badge tone="positive">on</Badge></li>
          </ul>
          <p className="mt-2 text-xs muted">Keys live only in server environment variables. Providers are pluggable (src/server/market).</p>
          <label className="mt-3 flex items-center justify-between text-sm"><span>Ask confirmation for all medium-risk AI actions</span><input type="checkbox" checked={!!ai.confirmMedium} onChange={(e) => savePrefs({ ai: { confirmMedium: e.target.checked } })} /></label>
        </Card>
      </div>
      <Card title="AI memory" action={<span className="text-xs muted">What the assistant remembers about you — editable</span>}>
        <ul className="divide-y divide-border text-sm">{memory.data?.map((m) => <li key={m.id} className="flex items-start gap-2 py-1.5"><Badge>{m.kind}</Badge><span className="min-w-0 flex-1">{m.key && <span className="font-medium">{m.key}: </span>}{m.content}<span className="block text-[11px] muted">importance {m.importance} · <Source source={m.source} /> · {fmtDate(m.updatedAt)}</span></span><button className="btn-ghost btn-sm" onClick={async () => { const v = prompt("Edit memory", m.content); if (v == null) return; await api(`/api/ai/memory/${m.id}`, { method: "PATCH", json: { content: v } }); memory.refresh(); }}>edit</button><button className="btn-ghost btn-sm" onClick={async () => { await api(`/api/ai/memory/${m.id}`, { method: "DELETE" }); memory.refresh(); }}>✕</button></li>)}{memory.data?.length === 0 && <p className="py-2 muted">Nothing stored yet. Tell the assistant things like “I work Mon–Fri 10–18”.</p>}</ul>
        <form className="mt-2 grid gap-2 sm:grid-cols-[120px_160px_1fr_auto]" onSubmit={async (e) => { e.preventDefault(); await api("/api/ai/memory", { method: "POST", json: { kind: mem.kind, key: mem.key || null, content: mem.content, importance: 4, pinned: true } }); setMem({ kind: "fact", key: "", content: "" }); memory.refresh(); }}>
          <select className="field" value={mem.kind} onChange={(e) => setMem({ ...mem, kind: e.target.value })}>{["fact", "preference", "context", "goal", "routine", "person", "note"].map((k) => <option key={k}>{k}</option>)}</select>
          <input className="field" placeholder="key (optional)" value={mem.key} onChange={(e) => setMem({ ...mem, key: e.target.value })} />
          <input className="field" placeholder="Something the AI should always know" required value={mem.content} onChange={(e) => setMem({ ...mem, content: e.target.value })} />
          <button className="btn-ghost">Add</button>
        </form>
      </Card>
      <Card title="AI action log" action={<Link href="/assistant" className="btn-ghost btn-sm">Assistant</Link>}>
        {!actions.data?.length ? <p className="text-sm muted">No AI actions yet.</p> : <ul className="divide-y divide-border text-xs">{actions.data.map((a) => <li key={a.id} className="flex items-center gap-2 py-1.5"><span className="w-28 shrink-0 muted">{fmtDate(a.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><Badge tone={a.status === "failed" ? "negative" : a.status === "pending_confirmation" ? "warning" : "positive"}>{a.status.replace("_", " ")}</Badge><code className="shrink-0">{a.tool}</code><span className="min-w-0 flex-1 truncate muted">{a.summary ?? a.error ?? ""}</span><span className="muted">{a.risk}</span></li>)}</ul>}
      </Card>
      <Card title="Data: export, backup, delete">
        <div className="flex flex-wrap gap-2 text-sm">
          <a className="btn-ghost btn-sm" href="/api/me/export" download>Export everything (JSON)</a>
          {["transactions", "tasks", "events", "trades", "workout_sets", "study_sessions", "journal", "nutrition"].map((ds) => <a key={ds} className="btn-ghost btn-sm" href={`/api/me/export/csv?dataset=${ds}`} download>{ds} CSV</a>)}
        </div>
        <p className="mt-2 text-xs muted">Database backups: run <code>pnpm backup</code> (pg_dump) or the scheduled GitHub Action — see docs/DEPLOYMENT.md. The German course progress is included in the export.</p>
        <details className="mt-3"><summary className="cursor-pointer text-sm text-negative">Delete account and all data</summary>
          <form className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={async (e) => { e.preventDefault(); if (!confirm("This permanently deletes everything. Continue?")) return; try { await api("/api/me/delete", { method: "POST", json: del }); window.location.assign("/login"); } catch (err) { alert((err as Error).message); } }}>
            <input className="field" type="password" placeholder="Password" required value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} />
            <input className="field" placeholder='Type "DELETE"' required value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} />
            <button className="btn-danger btn-sm">Delete permanently</button>
          </form>
        </details>
      </Card>
    </div>
  );
}
