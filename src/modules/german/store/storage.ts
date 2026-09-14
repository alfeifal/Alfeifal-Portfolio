// Persistence adapter (original file: "Cambia este fichero para migrar a un backend").
// Personal OS version: state lives in PostgreSQL (per user, via /api/german/state) with IndexedDB as
// a local cache so the module keeps working instantly and offline. Conflicts between devices are
// resolved last-writer-wins with a revision number reported by the server.
import { get, set, del } from 'idb-keyval'
import type { StateStorage } from 'zustand/middleware'

let revision = 0
let pending: ReturnType<typeof setTimeout> | null = null
let queued: string | null = null

async function pushToServer(value: string) {
  try {
    const parsed = JSON.parse(value) as { state?: Record<string, unknown> }
    const res = await fetch('/api/german/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ state: parsed.state ?? {}, baseRevision: revision }) })
    if (res.ok) { const r = (await res.json()) as { revision: number }; revision = r.revision }
  } catch (e) { console.warn('[german] sync failed, kept locally', e) }
}

export const idbStorage: StateStorage = {
  getItem: async (name) => {
    // Server first (source of truth across devices), local cache as fallback.
    try {
      const res = await fetch('/api/german/state', { credentials: 'same-origin' })
      if (res.ok) {
        const r = (await res.json()) as { state: Record<string, unknown> | null; revision: number }
        revision = r.revision
        if (r.state && Object.keys(r.state).length) { const wrapped = JSON.stringify({ state: r.state, version: (r.state as { version?: number }).version ?? 1 }); await set(name, wrapped); return wrapped }
      }
    } catch { /* offline: use cache */ }
    return (await get(name)) ?? null
  },
  setItem: async (name, value) => {
    await set(name, value)
    queued = value
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => { pending = null; if (queued) { const v = queued; queued = null; pushToServer(v) } }, 800)
  },
  removeItem: async (name) => { await del(name) },
}

/** Flush a pending write immediately (used before navigating away). */
export function flushGermanStorage() { if (pending && queued) { clearTimeout(pending); pending = null; const v = queued; queued = null; return pushToServer(v) } return Promise.resolve() }
