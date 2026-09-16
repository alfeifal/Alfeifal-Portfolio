"use client";
import { useState } from "react";
import { Copy, ShieldCheck, UserPlus } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, ErrorBox, Field, Modal, PageHeader, SkeletonList, Stat } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, fmtDate, useApi } from "@/lib/client";

export interface AdminUser {
  id: string; email: string; name: string; role: "admin" | "user"; isActive: boolean;
  deactivatedAt: string | null; lastLoginAt: string | null; timezone: string; currency: string; createdAt: string;
}
export interface Payload { users: AdminUser[]; stats: { total: number; active: number; admins: number; users: number } }

const EMPTY_FORM = { email: "", name: "", role: "user" as "admin" | "user", timezone: "", currency: "" };

/**
 * Accounts, not data. Everything on this screen comes from `/api/admin/users`, which returns the user
 * rows and nothing that belongs to them — no tasks, no money, no training, no memory.
 *
 * The generated password is shown once, right after the account is created, and is never fetched
 * again: the list endpoint does not return it and the server only ever stored its hash.
 */
export function AdminClient({ initial, meId }: { initial: Payload; meId: string }) {
  const { data, error, loading, refresh, reload } = useApi<Payload>("/api/admin/users", [], initial);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ user: AdminUser; temporaryPassword: string | null } | null>(null);
  const [pending, setPending] = useState<AdminUser | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { email: form.email, name: form.name, role: form.role, ...(form.timezone ? { timezone: form.timezone } : {}), ...(form.currency ? { currency: form.currency.toUpperCase() } : {}) };
      const res = await api<{ user: AdminUser; temporaryPassword: string | null }>("/api/admin/users", { method: "POST", json: body });
      setOpen(false);
      setForm(EMPTY_FORM);
      setCreated(res);
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

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return loading ? <SkeletonList rows={6} /> : null;
  const { users, stats } = data;

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

      {created && (
        <Card title="Temporary password" className="border-accent/40">
          <p className="text-sm">
            Give this to <span className="font-medium">{created.user.email}</span> over a channel you trust. It is shown once and cannot be recovered — if it is lost, create a new one by setting a password for the account.
          </p>
          {created.temporaryPassword && (
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm">{created.temporaryPassword}</code>
              <Button
                icon={<Copy size={14} />}
                onClick={() => { navigator.clipboard?.writeText(created.temporaryPassword!).then(() => toast.success("Copied"), () => toast.error("Could not copy")); }}
              >
                Copy
              </Button>
            </div>
          )}
          <Button className="mt-2" size="sm" onClick={() => setCreated(null)}>Done</Button>
        </Card>
      )}

      <Card title={`Accounts (${users.length})`}>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider muted">
                <th className="px-1 pb-2 font-medium">Name</th>
                <th className="px-1 pb-2 font-medium">Email</th>
                <th className="px-1 pb-2 font-medium">Role</th>
                <th className="px-1 pb-2 font-medium">Status</th>
                <th className="px-1 pb-2 font-medium">Created</th>
                <th className="px-1 pb-2 font-medium">Last login</th>
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
                  <td className="px-1 py-2">{u.isActive ? <Badge tone="positive">Active</Badge> : <Badge tone="negative">Deactivated</Badge>}</td>
                  <td className="px-1 py-2 tnum muted">{fmtDate(u.createdAt)}</td>
                  <td className="px-1 py-2 tnum muted">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "never"}</td>
                  <td className="px-1 py-2">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" disabled={u.id === meId} onClick={() => patch(u, { role: u.role === "admin" ? "user" : "admin" }, u.role === "admin" ? "Administrator role removed" : "Administrator role granted")}>
                        {u.role === "admin" ? "Make user" : "Make admin"}
                      </Button>
                      {u.isActive ? (
                        <Button size="sm" variant="danger" disabled={u.id === meId} onClick={() => setPending(u)}>Deactivate</Button>
                      ) : (
                        <Button size="sm" onClick={() => patch(u, { isActive: true }, "Account reactivated")}>Reactivate</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs muted">
          Deactivating keeps every row the account owns and signs it out everywhere; it simply cannot log in again until it is reactivated. Nothing here gives an administrator access to another account&apos;s data.
        </p>
      </Card>

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
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={async () => { if (pending) await patch(pending, { isActive: false }, "Account deactivated"); }}
        title="Deactivate this account?"
        description={pending ? `${pending.email} will be signed out everywhere and will not be able to log in. All of their data is kept.` : undefined}
        confirmLabel="Deactivate"
      />
    </div>
  );
}
