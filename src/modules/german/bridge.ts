/**
 * Bridge between the German module and the rest of Personal OS (spec §20).
 * Learning events are posted to the server, which turns them into study sessions,
 * goal progress and analytics. Fire-and-forget: the learning flow never blocks on it.
 */
export type GermanEventKind = 'session' | 'unit_test' | 'exam' | 'daily_challenge' | 'section' | 'review'

export function emitGermanEvent(e: { kind: GermanEventKind; unitId?: string | null; label?: string | null; score?: number | null; durationSec?: number | null; data?: Record<string, unknown> }) {
  if (typeof window === 'undefined') return
  if (e.kind === 'session' && (!e.durationSec || e.durationSec < 30)) return // ignore accidental opens
  fetch('/api/german/events', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(e), keepalive: true }).catch(() => {})
}
