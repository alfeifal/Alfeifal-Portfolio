/**
 * Client cache invalidation for AI-written data.
 *
 * Module pages read through `useApi`, whose cache is per-component React state. A write that happens
 * on the server — the assistant calling a tool — is therefore invisible to an already-mounted page
 * until it refetches. `router.refresh()` does not help: it re-renders server components, and these
 * pages are client components.
 *
 * So `useApi` registers its path here, and an AI action that really succeeded asks every hook whose
 * path belongs to the affected module to refetch. The refetch is a normal authenticated request, so
 * what lands in the UI is whatever the database actually holds — never an optimistic guess.
 */

/**
 * Tool module → the API path prefixes whose data that module can change.
 *
 * Keys are the `module` field of the tool registry, so adding a tool to an existing module needs no
 * change here; a genuinely new module does, and `tests/ai-sync.test.ts` fails until it is added.
 * Entries are deliberately generous: re-reading one extra list costs a request, while missing one
 * leaves a stale number on screen.
 */
export const MODULE_PATHS: Record<string, string[]> = {
  finance: ["/api/finance", "/api/dashboard", "/api/analytics"],
  tasks: ["/api/tasks", "/api/dashboard", "/api/analytics", "/api/planner"],
  calendar: ["/api/events", "/api/dashboard", "/api/analytics", "/api/planner"],
  training: ["/api/training", "/api/dashboard", "/api/analytics"],
  nutrition: ["/api/nutrition", "/api/dashboard", "/api/analytics"],
  studies: ["/api/studies", "/api/dashboard", "/api/analytics"],
  goals: ["/api/goals", "/api/milestones", "/api/dashboard", "/api/analytics"],
  projects: ["/api/projects", "/api/milestones", "/api/dashboard", "/api/analytics"],
  journal: ["/api/journal", "/api/dashboard", "/api/analytics"],
  trading: ["/api/trading", "/api/market", "/api/dashboard"],
  investing: ["/api/investing", "/api/dashboard", "/api/analytics"],
  market: ["/api/market"],
  german: ["/api/german", "/api/dashboard", "/api/analytics"],
  academy: ["/api/academy"],
  notifications: ["/api/notifications"],
  planner: ["/api/planner", "/api/tasks", "/api/events", "/api/dashboard"],
  settings: ["/api/me"],
  ai: ["/api/ai/memory"],
  analytics: ["/api/analytics"],
};

/** Every path prefix touched by the given tool modules, de-duplicated. Unknown modules contribute nothing. */
export function pathsForModules(modules: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const m of modules) for (const p of MODULE_PATHS[m] ?? []) out.add(p);
  return [...out];
}

/** True when `path` (which may carry a query string) sits under one of the prefixes. */
export function matchesPrefix(path: string, prefixes: readonly string[]): boolean {
  const clean = path.split("?")[0];
  return prefixes.some((p) => clean === p || clean.startsWith(p.endsWith("/") ? p : p + "/"));
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

/** Registers a live `useApi` hook. Returns the unsubscribe for the effect cleanup. */
export function subscribePath(path: string, fn: Listener): () => void {
  let set = listeners.get(path);
  if (!set) { set = new Set(); listeners.set(path, set); }
  set.add(fn);
  return () => {
    const s = listeners.get(path);
    if (!s) return;
    s.delete(fn);
    if (!s.size) listeners.delete(path);
  };
}

/** Refetches every mounted hook under these prefixes. Returns how many were told to reload. */
export function invalidatePaths(prefixes: readonly string[]): number {
  if (!prefixes.length) return 0;
  let n = 0;
  for (const [path, set] of listeners) {
    if (!matchesPrefix(path, prefixes)) continue;
    for (const fn of set) { fn(); n++; }
  }
  return n;
}

/** The entry point for AI actions: invalidate everything the given tool modules can have changed. */
export function invalidateModules(modules: Iterable<string>): number {
  return invalidatePaths(pathsForModules(modules));
}

/**
 * Modules touched by a batch of executed actions, counting only the ones that actually took effect.
 * A failed, rejected or still-pending action changed nothing, so it must not refresh anything —
 * that is what would let a stale read be presented as the result of a write that never happened.
 */
export function modulesOf(actions: readonly { module?: string | null; status?: string }[]): string[] {
  const out = new Set<string>();
  for (const a of actions) if (a.module && (a.status === "success" || a.status === "confirmed")) out.add(a.module);
  return [...out];
}

/** Test seam: drops every registration. */
export function __resetInvalidation() { listeners.clear(); }
