"use client";
import { useCallback, useEffect, useRef, useState } from "react";

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
    const d = data as { error?: string; details?: unknown } | null;
    throw new ApiError(res.status, d?.error ?? `Request failed (${res.status})`, d?.details);
  }
  return data as T;
}

interface State<T> { data: T | null; error: string | null; loading: boolean }

/** Tiny data hook: fetch on mount / when the key changes, expose refresh() and setData(). */
export function useApi<T = unknown>(path: string | null, deps: unknown[] = []) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: !!path });
  const seq = useRef(0);
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
  useEffect(() => { load(); }, [load]);
  const setData = useCallback((updater: T | ((prev: T | null) => T)) => setState((s) => ({ ...s, data: typeof updater === "function" ? (updater as (p: T | null) => T)(s.data) : updater })), []);
  return { ...state, refresh: () => load(true), reload: () => load(false), setData };
}

export function fmtMoney(n: number | null | undefined, currency = "EUR") {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}
export function fmtNum(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(n);
}
export function fmtDate(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!d) return "—";
  const date = typeof d === "string" ? (d.length === 10 ? new Date(d + "T00:00:00") : new Date(d)) : d;
  return new Intl.DateTimeFormat("es-ES", opts).format(date);
}
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
