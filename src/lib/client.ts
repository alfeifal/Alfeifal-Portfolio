"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribePath } from "./invalidate";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

/** JSON fetch with uniform error handling. Same-origin cookies are sent automatically. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, { ...rest, headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) }, body: json !== undefined ? JSON.stringify(json) : rest.body, credentials: "same-origin" });
  if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) { window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`); }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const d = data as { error?: string; details?: unknown; code?: string } | null;
    // An account that still owes a password change gets 403 on everything else. Send it to the one
    // screen it may use rather than surfacing a refusal it cannot act on.
    if (res.status === 403 && d?.code === "password_change_required" && typeof window !== "undefined" && location.pathname !== "/change-password") {
      window.location.assign("/change-password");
    }
    throw new ApiError(res.status, d?.error ?? `Request failed (${res.status})`, d?.details);
  }
  return data as T;
}

interface State<T> { data: T | null; error: string | null; loading: boolean }

/**
 * Tiny data hook: fetch on mount / when the key changes, expose refresh() and setData().
 *
 * `initialData` is how a Server Component hands over what it already loaded. When it is supplied the
 * hook starts with that data and skips the fetch on mount — the page paints with real content instead
 * of a skeleton, and the request that used to run after hydration does not happen at all. Everything
 * else is unchanged: `refresh`, `reload`, the sequence guard and the module invalidation all still
 * work, so a mutation still re-reads from the server.
 *
 * The skip applies only to the first mount of that path. Changing the key, refreshing, or an
 * invalidation all fetch normally, so server-seeded data can never become permanently stale.
 */
export function useApi<T = unknown>(path: string | null, deps: unknown[] = [], initialData?: T | null) {
  const [state, setState] = useState<State<T>>({ data: initialData ?? null, error: null, loading: !!path && initialData == null });
  const seq = useRef(0);
  // Consumed once: the very first load for this path is the one the server already did.
  const seeded = useRef(initialData != null);
  const load = useCallback(async (silent = false) => {
    if (!path) return;
    const id = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api<T>(path);
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (id === seq.current) setState((s) => ({ ...s, error: (e as Error).message, loading: false }));
    }
  }, [path, ...deps]);
  useEffect(() => {
    if (seeded.current) { seeded.current = false; return; }
    load();
  }, [load]);
  // Refetch when something else (an AI action) changed this module's data server-side.
  useEffect(() => {
    if (!path) return;
    return subscribePath(path, () => { load(true); });
  }, [path, load]);
  const setData = useCallback((updater: T | ((prev: T | null) => T)) => setState((s) => ({ ...s, data: typeof updater === "function" ? (updater as (p: T | null) => T)(s.data) : updater })), []);
  return { ...state, refresh: () => load(true), reload: () => load(false), setData };
}

// One implementation, in @/lib/format, so a Server Component and a Client Component format alike.
export { fmtDateServer as fmtDate, fmtMoneyServer as fmtMoney, fmtNumServer as fmtNum } from "./format";
export function fmtTime(d: string | Date) {
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(typeof d === "string" ? new Date(d) : d);
}
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(key: string, n: number) {
  const d = new Date(key + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Local ISO datetime without timezone (what the API expects for calendar events). */
export function toLocalIso(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}
