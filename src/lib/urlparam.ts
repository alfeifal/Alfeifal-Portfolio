"use client";
/**
 * Reads a query parameter on the client for the initial state of a page.
 *
 * Used for the deep links search produces (`?tab=`, `?date=`, `?month=`, `?conversation=`). It runs
 * during the first render only, so it seeds state without fighting the user once they change it, and
 * falls back to the page's own default whenever the parameter is absent or not one of the allowed values.
 */
export function initialParam<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const v = new URLSearchParams(window.location.search).get(name);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Same idea for a free-form value (a date, a month), validated by shape rather than by a list. */
export function initialMatch(name: string, re: RegExp, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = new URLSearchParams(window.location.search).get(name);
  return v && re.test(v) ? v : fallback;
}
