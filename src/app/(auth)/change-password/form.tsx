"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { MotionProvider, FadeIn } from "@/components/motion";
import { Button } from "@/components/ui";

const MIN = 10;

/**
 * Replaces the password an administrator handed over.
 *
 * It goes through the ordinary `/api/me/password` route — current password, new password, the same
 * scrypt hashing — so there is no second, weaker path into changing credentials. The server drops
 * every other session on success, which is what actually ends the administrator's copy of the
 * temporary password.
 */
export function ChangePasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = repeat.length > 0 && repeat !== newPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < MIN;
  const same = newPassword.length > 0 && newPassword === currentPassword;
  const ready = currentPassword.length > 0 && newPassword.length >= MIN && repeat === newPassword && !same;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/me/password", { method: "POST", json: { currentPassword, newPassword } });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <MotionProvider>
      <FadeIn variant="scale">
        <form onSubmit={submit} className="card p-6 shadow-xl shadow-black/5">
          <h1 className="h1 mb-1">Set your password</h1>
          <p className="mb-5 text-sm muted">
            This account was created for <span className="font-medium">{email}</span> with a temporary password. Choose your own before you start — whoever set it up knows the current one.
          </p>

          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium">Temporary password</span>
            <input className="field" type="password" autoComplete="current-password" required autoFocus value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
          </label>

          <label className="mb-1 block text-sm">
            <span className="mb-1 block font-medium">New password</span>
            <input className="field" type="password" autoComplete="new-password" required minLength={MIN} aria-invalid={tooShort || same} value={newPassword} onChange={(e) => setNext(e.target.value)} />
          </label>
          <p className="mb-3 text-xs muted">{MIN} characters or more. {same ? <span className="text-negative">It has to be different from the temporary one.</span> : tooShort ? <span className="text-negative">{MIN - newPassword.length} more to go.</span> : null}</p>

          <label className="mb-1 block text-sm">
            <span className="mb-1 block font-medium">Repeat new password</span>
            <input className="field" type="password" autoComplete="new-password" required aria-invalid={mismatch} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </label>
          {mismatch && <p className="mb-3 text-xs text-negative">The two do not match.</p>}

          {error && <p className="mb-3 mt-3 text-sm text-negative" role="alert">{error}</p>}

          <Button className="mt-3 w-full" variant="primary" type="submit" loading={busy} loadingText="Saving…" disabled={!ready}>
            Save and continue
          </Button>
          <p className="mt-3 text-xs muted">Saving signs you out everywhere else, so the temporary password stops working immediately.</p>
        </form>
      </FadeIn>
    </MotionProvider>
  );
}
