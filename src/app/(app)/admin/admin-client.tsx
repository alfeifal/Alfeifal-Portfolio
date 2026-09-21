"use client";
import { useEffect, useMemo, useState } from "react";
import { Activity, Copy, KeyRound, LogOut, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorBox, Field, Modal, PageHeader, SkeletonList, Stat } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, fmtDate, useApi } from "@/lib/client";

export interface AdminUser {
  id: string; email: string; name: string; role: "admin" | "user"; isActive: boolean;
  deactivatedAt: string | null; lastLoginAt: string | null; mustChangePassword: boolean;
  timezone: string; currency: string; createdAt: string;
}
export interface Payload {
  users: AdminUser[];
  stats: { total: number; active: number; admins: number; users: number };
  /** Live sessions per account id. Counts only — never a token, an address or a device. */
  sessions: Record<string, number>;
}
interface DeletionSummary { user: AdminUser; items: { label: string; n: number }[]; total: number }
interface UsageTotals { requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
interface UsageRow extends UsageTotals { userId: string; email: string; name: string }
interface UsagePayload { from: string; totals: UsageTotals; users: UsageRow[] }

const compact = (n: number) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M" : n >= 1_000 ? (n / 1_000).toFixed(1) + "k" : String(n));

/**
 * Assistant usage per account.
 *
 * Five integers and a date, from a table that stores nothing else. An administrator can see that an
 * account made 60 requests and spent 400k tokens this month, and still cannot see one word of what
 * was asked or answered — there is no column here that could carry it.
 *
 * Cache reads and writes are shown apart from ordinary input because the provider prices them
 * differently; adding them together would give a number that is wrong in both directions.
 *
 * There is no limit here, and no control that would set one. Usage has never been recorded before
 * now, so there is nothing yet to justify a ceiling.
 */
function UsagePanel() {
  const { data, error, loading } = useApi<UsagePayload>("/api/admin/usage");
  if (error) return <Card title="Assistant usage"><p className="text-sm muted">{error}</p></Card>;
  if (!data) return loading ? <SkeletonList rows={3} /> : null;
  const { totals, users, from } = data;
  const cols: { key: keyof UsageTotals; label: string }[] = [
    { key: "requests", label: "Requests" },
    { key: "inputTokens", label: "Input" },
    { key: "outputTokens", label: "Output" },
    { key: "cacheReadTokens", label: "Cache read" },
    { key: "cacheWriteTokens", label: "Cache write" },
  ];
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Activity size={14} />Assistant usage since {from}</span>}>
      {users.length === 0 ? (
        <Empty title="No usage recorded yet">Counting started when this was deployed; nothing before that exists.</Empty>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider muted">
                <th className="px-1 pb-2 font-medium">Account</th>
                {cols.map((c) => <th key={c.key} className="px-1 pb-2 text-right font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.userId}>
                  <td className="px-1 py-2 truncate">{u.email}</td>
                  {cols.map((c) => <td key={c.key} className="px-1 py-2 text-right tnum">{compact(u[c.key])}</td>)}
                </tr>
              ))}
              <tr className="font-medium">
                <td className="px-1 py-2">All accounts</td>
                {cols.map((c) => <td key={c.key} className="px-1 py-2 text-right tnum">{compact(totals[c.key])}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs muted">
        Token counts only. This never shows what was asked or answered, and no per-account limit is in force — usage is being measured, not capped.
      </p>
    </Card>
  );
}

const EMPTY_FORM = { email: "", name: "", role: "user" as "admin" | "user", timezone: "", currency: "" };

/**
 * Accounts, not data. Everything on this screen comes from `/api/admin/*`, which returns the user rows
 * and — only when a deletion is being confirmed — row *counts* for the account about to be destroyed.
 * No task, no amount, no workout, no memory ever reaches this page.
 *
 * A generated password (at creation or at reset) is shown once and never fetched again: the list
 * endpoint does not return it and the server only ever stored its hash.
 */
export function AdminClient({ initial, meId }: { initial: Payload; meId: string }) {
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  // Debounced so typing a name is one request, not one per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const path = useMemo(() => (q ? `/api/admin/users?q=${encodeURIComponent(q)}` : "/api/admin/users"), [q]);
  const { data, error, loading, refresh, reload } = useApi<Payload>(path, [], q ? undefined : initial);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  /** The one-time secret panel, shared by account creation and password reset. */
  const [issued, setIssued] = useState<{ user: AdminUser; password: string; reason: "created" | "reset" } | null>(null);
  const [deactivating, setDeactivating] = useState<AdminUser | null>(null);
  const [revoking, setRevoking] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<{ user: AdminUser; summary: DeletionSummary | null } | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { email: form.email, name: form.name, role: form.role, ...(form.timezone ? { timezone: form.timezone } : {}), ...(form.currency ? { currency: form.currency.toUpperCase() } : {}) };
      const res = await api<{ user: AdminUser; temporaryPassword: string | null }>("/api/admin/users", { method: "POST", json: body });
      setOpen(false);
      setForm(EMPTY_FORM);
      if (res.temporaryPassword) setIssued({ user: res.user, password: res.temporaryPassword, reason: "created" });
      refresh();
      toast.success("Account created", `${res.user.email} can sign in now`);
    } catch (err) {
      toast.error("Account not created", (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const patch = async (u: AdminUser, body: Record<string, unknown>, ok: string) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", json: body });
      refresh();
      toast.success(ok, u.email);
    } catch (err) {
      toast.error("Nothing changed", (err as Error).message);
    }
  };

  const resetPassword = async (u: AdminUser) => {
    try {
      const res = await api<{ user: AdminUser; temporaryPassword: string }>(`/api/admin/users/${u.id}/password`, { method: "POST" });
      setIssued({ user: res.user, password: res.temporaryPassword, reason: "reset" });
      refresh();
      toast.success("New password issued", `${u.email} is signed out everywhere`);
    } catch (err) {
      toast.error("Password not reset", (err as Error).message);
    }
  };

  const revokeSessions = async (u: AdminUser) => {
    try {
      const res = await api<{ revoked: number }>(`/api/admin/users/${u.id}/sessions`, { method: "DELETE" });
      refresh();
      toast.success(res.revoked === 1 ? "1 session ended" : `${res.revoked} sessions ended`, u.email);
    } catch (err) {
      toast.error("Sessions not revoked", (err as Error).message);
    }
  };

  /** Opens the confirmation, then loads what the deletion would destroy so the dialog can name it. */
  const askDelete = async (u: AdminUser) => {
    setDeleting({ user: u, summary: null });
    try {
      setDeleting({ user: u, summary: await api<DeletionSummary>(`/api/admin/users/${u.id}/deletion-summary`) });
    } catch (err) {
      toast.error("Could not read what would be deleted", (err as Error).message);
      setDeleting(null);
    }
  };

  const doDelete = async (u: AdminUser) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      refresh();
      toast.success("Account deleted", `${u.email} and all of its data are gone`);
    } catch (err) {
      toast.error("Account not deleted", (err as Error).message);
    }
  };

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return loading ? <SkeletonList rows={6} /> : null;
  const { users, stats, sessions } = data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Administration"
        subtitle="Accounts on this instance. Administrators manage accounts — never the data inside them."
        action={<Button variant="primary" icon={<UserPlus size={14} />} onClick={() => setOpen(true)}>New user</Button>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Accounts" count={stats.total} />
        <Stat label="Active" count={stats.active} />
        <Stat label="Administrators" count={stats.admins} />
        <Stat label="Users" count={stats.users} />
      </div>

      {issued && (
        <Card title={issued.reason === "created" ? "Temporary password" : "New temporary password"} className="border-accent/40">
          <p className="text-sm">
            Give this to <span className="font-medium">{issued.user.email}</span> over a channel you trust. It is shown once and cannot be recovered — if it is lost, issue another one.
            {issued.reason === "reset" && " Their old password no longer works and they have been signed out everywhere."}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm">{issued.password}</code>
            <Button
              icon={<Copy size={14} />}
              onClick={() => { navigator.clipboard?.writeText(issued.password).then(() => toast.success("Copied"), () => toast.error("Could not copy")); }}
            >
              Copy
            </Button>
          </div>
          <Button className="mt-2" size="sm" onClick={() => setIssued(null)}>Done</Button>
        </Card>
      )}

      <Card
        title={q ? `Accounts matching “${q}” (${users.length})` : `Accounts (${users.length})`}
        action={
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 muted" />
            <input
              className="field !py-1.5 !pl-8 w-44 sm:w-56"
              placeholder="Search name or email"
              aria-label="Search accounts by name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        }
      >
        {users.length === 0 ? (
          <Empty title="No account matches">Nothing here is named or addressed like that.</Empty>
        ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider muted">
                <th className="px-1 pb-2 font-medium">Name</th>
                <th className="px-1 pb-2 font-medium">Email</th>
                <th className="px-1 pb-2 font-medium">Role</th>
                <th className="px-1 pb-2 font-medium">Status</th>
                <th className="px-1 pb-2 font-medium">Created</th>
                <th className="px-1 pb-2 font-medium">Last login</th>
                <th className="px-1 pb-2 font-medium">Sessions</th>
                <th className="px-1 pb-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className={u.isActive ? "" : "opacity-60"}>
                  <td className="px-1 py-2 font-medium">
                    {u.name}
                    {u.id === meId && <span className="ml-1.5 text-[11px] muted">(you)</span>}
                  </td>
                  <td className="px-1 py-2 truncate">{u.email}</td>
                  <td className="px-1 py-2">
                    {u.role === "admin" ? <Badge tone="accent"><ShieldCheck size={11} className="mr-1 inline" />Admin</Badge> : <Badge>User</Badge>}
                  </td>
                  <td className="px-1 py-2">
                    <div className="flex flex-wrap gap-1">
                      {u.isActive ? <Badge tone="positive">Active</Badge> : <Badge tone="negative">Deactivated</Badge>}
                      {/* Tells the administrator whether the password they handed over has been used yet. */}
                      {u.mustChangePassword && <Badge tone="warning">Password pending</Badge>}
                    </div>
                  </td>
                  <td className="px-1 py-2 tnum muted">{fmtDate(u.createdAt)}</td>
                  <td className="px-1 py-2 tnum muted">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "never"}</td>
                  <td className="px-1 py-2 tnum muted">{sessions[u.id] ?? 0}</td>
                  <td className="px-1 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button size="sm" disabled={u.id === meId} onClick={() => patch(u, { role: u.role === "admin" ? "user" : "admin" }, u.role === "admin" ? "Administrator role removed" : "Administrator role granted")}>
                        {u.role === "admin" ? "Make user" : "Make admin"}
                      </Button>
                      <Button size="sm" icon={<KeyRound size={13} />} onClick={() => setResetting(u)}>Reset password</Button>
                      <Button size="sm" icon={<LogOut size={13} />} disabled={u.id === meId || !(sessions[u.id] ?? 0)} onClick={() => setRevoking(u)}>
                        Revoke sessions
                      </Button>
                      {u.isActive ? (
                        <Button size="sm" variant="danger" disabled={u.id === meId} onClick={() => setDeactivating(u)}>Deactivate</Button>
                      ) : (
                        <Button size="sm" onClick={() => patch(u, { isActive: true }, "Account reactivated")}>Reactivate</Button>
                      )}
                      <Button size="sm" variant="danger" icon={<Trash2 size={13} />} disabled={u.id === meId} onClick={() => askDelete(u)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        <p className="mt-3 text-xs muted">
          Deactivating keeps every row the account owns and signs it out everywhere; it simply cannot log in again until it is reactivated. Deleting destroys the account and all of its data, permanently. Resetting a password is the only recovery path on this instance — there is no email here, so there is no reset link to send. Nothing on this page gives an administrator access to another account&apos;s data.
        </p>
      </Card>

      <UsagePanel />

      <Modal open={open} onClose={() => setOpen(false)} title="New user">
        <form className="space-y-3" onSubmit={create}>
          <Field label="Name"><input className="field" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><input className="field" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Timezone" hint="Defaults to the instance setting"><input className="field" placeholder="Europe/Madrid" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
            <Field label="Currency" hint="3 letters"><input className="field" maxLength={3} placeholder="EUR" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></Field>
          </div>
          <Field label="Role">
            <div className="flex gap-2">
              {(["user", "admin"] as const).map((r) => (
                <button type="button" key={r} className={"pill capitalize " + (form.role === r ? "!bg-accent !text-accent-fg" : "")} onClick={() => setForm({ ...form, role: r })}>{r}</button>
              ))}
            </div>
          </Field>
          <p className="text-xs muted">A temporary password is generated and shown once after the account is created. The new account starts empty, with only the standard defaults every account gets.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" loading={saving}>Create account</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={async () => { if (deactivating) await patch(deactivating, { isActive: false }, "Account deactivated"); }}
        title="Deactivate this account?"
        description={deactivating ? `${deactivating.email} will be signed out everywhere and will not be able to log in. All of their data is kept.` : undefined}
        confirmLabel="Deactivate"
      />

      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={async () => { if (revoking) await revokeSessions(revoking); }}
        title="End every session?"
        description={revoking ? `${revoking.email} will be signed out on all ${sessions[revoking.id] ?? 0} of their devices. They can sign straight back in with the password they already have — this does not change it.` : undefined}
        confirmLabel="Revoke sessions"
      />

      <ConfirmDialog
        open={!!resetting}
        onClose={() => setResetting(null)}
        onConfirm={async () => { if (resetting) await resetPassword(resetting); }}
        title="Issue a new password?"
        description={resetting ? `${resetting.email}'s current password stops working immediately and they are signed out everywhere. You will be shown a temporary password once, to give them; they must replace it before they can use the app.` : undefined}
        confirmLabel="Issue password"
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { if (deleting) await doDelete(deleting.user); }}
        title="Delete this account and all of its data?"
        description={
          deleting ? (
            <div className="space-y-2">
              <p>
                <span className="font-medium">{deleting.user.email}</span> will be erased. This cannot be undone and there is no backup here to restore from.
              </p>
              {deleting.summary === null ? (
                <p className="muted">Counting what would be deleted…</p>
              ) : deleting.summary.total === 0 ? (
                <p className="muted">This account has no data of its own beyond the defaults it started with.</p>
              ) : (
                <>
                  <p className="muted">{deleting.summary.total} records will be destroyed:</p>
                  <ul className="grid grid-cols-2 gap-x-4 text-xs tnum">
                    {deleting.summary.items.map((i) => (
                      <li key={i.label} className="flex justify-between gap-2 border-b border-border/50 py-0.5">
                        <span className="muted">{i.label}</span><span>{i.n}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : undefined
        }
        confirmLabel="Delete permanently"
      />
    </div>
  );
}
