"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return <div className="card p-6 text-sm"><p className="font-semibold text-negative">Something went wrong</p><p className="muted">{error.message}</p><button className="btn-ghost btn-sm mt-3" onClick={reset}>Try again</button></div>;
}
