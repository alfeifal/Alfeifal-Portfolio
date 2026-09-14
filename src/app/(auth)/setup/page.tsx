"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

export default function SetupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid", currency: "EUR" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => { api<{ needsSetup: boolean; signupAllowed: boolean }>("/api/auth/status").then((s) => setAllowed(s.signupAllowed)).catch(() => setAllowed(false)); }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await api("/api/auth/signup", { method: "POST", json: form }); router.replace("/"); router.refresh(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  if (allowed === false) return <div className="card p-6 text-sm"><p className="font-semibold">Sign-up is closed</p><p className="muted">This is a private instance. Set ALLOW_SIGNUP=true on the server to allow more accounts.</p><a className="link mt-3 block" href="/login">Back to sign in</a></div>;
  return (
    <form onSubmit={submit} className="card p-6">
      <h1 className="h1 mb-1">Set up your Personal OS</h1>
      <p className="mb-5 text-sm muted">Create the owner account. Your training routine, finance categories and German course are prepared automatically.</p>
      {(["name", "email", "password"] as const).map((k) => (
        <label key={k} className="mb-3 block text-sm"><span className="mb-1 block font-medium capitalize">{k}</span><input className="field" type={k === "password" ? "password" : k === "email" ? "email" : "text"} autoComplete={k === "password" ? "new-password" : k} required minLength={k === "password" ? 10 : 1} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
      ))}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <label className="block text-sm"><span className="mb-1 block font-medium">Timezone</span><input className="field" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></label>
        <label className="block text-sm"><span className="mb-1 block font-medium">Currency</span><input className="field" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></label>
      </div>
      <p className="mb-3 text-xs muted">Password: at least 10 characters.</p>
      {error && <p className="mb-3 text-sm text-negative">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
    </form>
  );
}
