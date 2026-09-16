/**
 * Formatting that runs on the server as well as the client.
 *
 * `@/lib/client` is a "use client" module, so a Server Component cannot import `fmtDate` from it. The
 * formatting itself has no reason to be client-only — it is `Intl` — so the shared implementation
 * lives here and the client module keeps its own re-export for existing call sites.
 */
export function fmtDateServer(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!d) return "—";
  const date = typeof d === "string" ? (d.length === 10 ? new Date(d + "T00:00:00") : new Date(d)) : d;
  return new Intl.DateTimeFormat("es-ES", opts).format(date);
}

export function fmtMoneyServer(n: number | null | undefined, currency = "EUR") {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

export function fmtNumServer(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(n);
}
