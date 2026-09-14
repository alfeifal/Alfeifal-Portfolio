"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ needsSetup: boolean; signupAllowed: boolean } | null>(null);
  useEffect(() => { api<{ needsSetup: boolean; signupAllowed: boolean }>("/api/auth/status").then((s) => { setStatus(s); if (s.needsSetup) router.replace("/setup"); }).catch(() => {}); }, [router]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await api("/api/auth/login", { method: "POST", json: { email, password } }); const next = sp.get("next"); router.replace(next && next.startsWith("/") ? next : "/"); router.refresh(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="card p-6">
      <h1 className="h1 mb-1">{process.env.NEXT_PUBLIC_APP_NAME ?? "Personal OS"}</h1>
      <p className="mb-5 text-sm muted">Private access. Sign in to continue.</p>
      <label className="mb-3 block text-sm"><span className="mb-1 block font-medium">Email</span><input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="mb-4 block text-sm"><span className="mb-1 block font-medium">Password</span><input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <p className="mb-3 text-sm text-negative">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      {status?.signupAllowed && !status.needsSetup && <p className="mt-4 text-center text-xs muted"><Link className="link" href="/setup">Create an account</Link></p>}
    </form>
  );
}
export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
