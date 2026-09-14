export interface SrsState { interval: number; ease: number; dueAt: number; reps: number; lapses: number; lastAt: number }
export type Grade = 0 | 1 | 2 | 3 // Otra vez / Difícil / Bien / Fácil
const DAY = 86400000
const BASE = [1, 3, 7, 14, 30, 60]

export const newSrs = (now = Date.now()): SrsState => ({ interval: 0, ease: 2.3, dueAt: now, reps: 0, lapses: 0, lastAt: 0 })

export function review(s: SrsState, g: Grade, now = Date.now()): SrsState {
  let { interval, ease, reps, lapses } = s
  if (g === 0) { lapses++; reps = 0; interval = 1; ease = Math.max(1.3, ease - 0.2) }
  else {
    if (g === 1) ease = Math.max(1.3, ease - 0.15)
    if (g === 3) ease = Math.min(2.6, ease + 0.1)
    if (reps < BASE.length) interval = BASE[reps]
    else interval = Math.round(interval * ease)
    if (g === 1) interval = Math.max(1, Math.round(interval * 0.6))
    if (g === 3) interval = Math.round(interval * 1.3)
    reps++
  }
  return { interval, ease, reps, lapses, lastAt: now, dueAt: now + interval * DAY }
}
export const isDue = (s: SrsState | undefined, now = Date.now()) => !s || s.dueAt <= now
