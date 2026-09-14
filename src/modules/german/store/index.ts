import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { idbStorage } from './storage'
import { newSrs, review, type SrsState, type Grade } from '@german/engine/srs'
import { newMastery, recordResult, dayKey, type MasteryRecord } from '@german/engine/mastery'
import { UNITS, exerciseById } from '@german/content'
import type { Exercise } from '@german/content/types'
import { emitGermanEvent } from '@german/bridge'

export interface LessonProgress { sectionsDone: string[]; testBest: number; attempts: number; lastAt: number; timeSec: number }
export interface VocabProgress { srs: SrsState; correct: number; wrong: number }
export interface ErrorLog { id: string; exerciseId: string; concepts: string[]; given: string; expected: string; at: number; resolved: boolean; unitId: string }
export interface ExamResult { id: string; mode: string; label: string; score: number; correct: number; total: number; timeSec: number; byConcept: Record<string, { c: number; w: number }>; failedIds: string[]; at: number }
export interface DailyStat { sec: number; ex: number; correct: number; xp: number }

export interface AppState {
  version: number
  settings: { dailyGoalMin: number; dark: boolean; apiKey: string; unlockAll: boolean; goals: { vocab: number; grammar: number } }
  lessons: Record<string, LessonProgress>
  mastery: Record<string, MasteryRecord>
  conceptSrs: Record<string, SrsState>
  vocab: Record<string, VocabProgress>
  exerciseStats: Record<string, { attempts: number; correct: number; lastAt: number }>
  errors: ErrorLog[]
  results: ExamResult[]
  xp: number
  streak: number
  maxStreak: number
  lastStudyDay: string
  daily: Record<string, DailyStat>
  totalTimeSec: number
  lastPosition: { unitId: string; tab: string } | null
  bookmarks: string[]
  dailyChallenge: { date: string; ids: string[]; done: boolean; score: number } | null
  achievements: string[]
  // acciones
  setSettings: (p: Partial<AppState['settings']>) => void
  touchDay: () => void
  addTime: (sec: number) => void
  addXp: (n: number, reason?: string) => void
  markSection: (unitId: string, section: string) => void
  recordTest: (unitId: string, score: number) => void
  recordAnswer: (ex: Exercise, correct: boolean, given: string, expected: string, opts?: { inExam?: boolean; skipError?: boolean }) => void
  reviewConcept: (conceptId: string, g: Grade) => void
  reviewVocab: (vocabId: string, g: Grade) => void
  resolveError: (id: string) => void
  addResult: (r: Omit<ExamResult, 'id' | 'at'>) => void
  setPosition: (unitId: string, tab: string) => void
  toggleBookmark: (id: string) => void
  setDailyChallenge: (d: AppState['dailyChallenge']) => void
  resetUnit: (unitId: string) => void
  importState: (s: Partial<AppState>) => void
  resetAll: () => void
}

const initial = {
  version: 1,
  settings: { dailyGoalMin: 20, dark: false, apiKey: '', unlockAll: false, goals: { vocab: 15, grammar: 10 } },
  lessons: {}, mastery: {}, conceptSrs: {}, vocab: {}, exerciseStats: {}, errors: [], results: [],
  xp: 0, streak: 0, maxStreak: 0, lastStudyDay: '', daily: {}, totalTimeSec: 0, lastPosition: null, bookmarks: [], dailyChallenge: null, achievements: [] as string[],
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

export const useStore = create<AppState>()(persist((set, get) => ({
  ...initial,
  setSettings: (p) => set(s => ({ settings: { ...s.settings, ...p } })),
  touchDay: () => {
    const today = dayKey(); const s = get()
    if (s.lastStudyDay === today) return
    const yesterday = dayKey(Date.now() - 86400000)
    const streak = s.lastStudyDay === yesterday ? s.streak + 1 : 1
    set({ lastStudyDay: today, streak, maxStreak: Math.max(s.maxStreak, streak), daily: { ...s.daily, [today]: s.daily[today] ?? { sec: 0, ex: 0, correct: 0, xp: 0 } } })
  },
  addTime: (sec) => { get().touchDay(); emitGermanEvent({ kind: 'session', durationSec: sec, unitId: get().lastPosition?.unitId ?? null, label: get().lastPosition ? `Unidad ${get().lastPosition!.unitId} · ${get().lastPosition!.tab}` : 'Sesión de alemán' }); set(s => { const d = dayKey(); const t = s.daily[d] ?? { sec: 0, ex: 0, correct: 0, xp: 0 }; return { totalTimeSec: s.totalTimeSec + sec, daily: { ...s.daily, [d]: { ...t, sec: t.sec + sec } } } }) },
  addXp: (n) => { get().touchDay(); set(s => { const d = dayKey(); const t = s.daily[d] ?? { sec: 0, ex: 0, correct: 0, xp: 0 }; return { xp: s.xp + n, daily: { ...s.daily, [d]: { ...t, xp: t.xp + n } } } }) },
  markSection: (unitId, section) => set(s => {
    const l = s.lessons[unitId] ?? { sectionsDone: [], testBest: 0, attempts: 0, lastAt: 0, timeSec: 0 }
    if (l.sectionsDone.includes(section)) return {}
    const mastery = { ...s.mastery }
    if (section === 'learn') for (const c of UNITS.find(u => u.id === unitId)?.concepts ?? []) { const m = mastery[c] ?? newMastery(); mastery[c] = { ...m, seen: true, level: m.level === 0 ? 1 : m.level } }
    return { lessons: { ...s.lessons, [unitId]: { ...l, sectionsDone: [...l.sectionsDone, section], lastAt: Date.now() } }, mastery }
  }),
  recordTest: (unitId, score) => { emitGermanEvent({ kind: 'unit_test', unitId, score, label: `Test ${unitId}` }); return set(s => {
    const l = s.lessons[unitId] ?? { sectionsDone: [], testBest: 0, attempts: 0, lastAt: 0, timeSec: 0 }
    return { lessons: { ...s.lessons, [unitId]: { ...l, testBest: Math.max(l.testBest, score), attempts: l.attempts + 1, lastAt: Date.now() } } }
  }) },
  recordAnswer: (ex, correct, given, expected, opts) => {
    get().touchDay()
    set(s => {
      const mastery = { ...s.mastery }; const conceptSrs = { ...s.conceptSrs }
      for (const c of ex.concepts) {
        mastery[c] = recordResult(mastery[c] ?? newMastery(), correct, opts?.inExam)
        conceptSrs[c] = review(conceptSrs[c] ?? newSrs(), correct ? 2 : 0)
      }
      const es = s.exerciseStats[ex.id] ?? { attempts: 0, correct: 0, lastAt: 0 }
      const d = dayKey(); const t = s.daily[d] ?? { sec: 0, ex: 0, correct: 0, xp: 0 }
      const errors = (!correct && !opts?.skipError) ? [{ id: uid(), exerciseId: ex.id, concepts: ex.concepts, given, expected, at: Date.now(), resolved: false, unitId: ex.unitId }, ...s.errors].slice(0, 500) : s.errors
      return { mastery, conceptSrs, errors, exerciseStats: { ...s.exerciseStats, [ex.id]: { attempts: es.attempts + 1, correct: es.correct + (correct ? 1 : 0), lastAt: Date.now() } }, daily: { ...s.daily, [d]: { ...t, ex: t.ex + 1, correct: t.correct + (correct ? 1 : 0) } } }
    })
    if (correct) get().addXp(10)
  },
  reviewConcept: (conceptId, g) => set(s => ({ conceptSrs: { ...s.conceptSrs, [conceptId]: review(s.conceptSrs[conceptId] ?? newSrs(), g) } })),
  reviewVocab: (vocabId, g) => { get().touchDay(); set(s => { const v = s.vocab[vocabId] ?? { srs: newSrs(), correct: 0, wrong: 0 }; return { vocab: { ...s.vocab, [vocabId]: { srs: review(v.srs, g), correct: v.correct + (g > 0 ? 1 : 0), wrong: v.wrong + (g === 0 ? 1 : 0) } } } }); if (g > 0) get().addXp(2) },
  resolveError: (id) => set(s => ({ errors: s.errors.map(e => e.id === id ? { ...e, resolved: true } : e) })),
  addResult: (r) => { emitGermanEvent({ kind: r.mode === 'daily' ? 'daily_challenge' : 'exam', score: r.score, label: r.label, data: { mode: r.mode, correct: r.correct, total: r.total } }); return set(s => ({ results: [{ ...r, id: uid(), at: Date.now() }, ...s.results].slice(0, 200) })) },
  setPosition: (unitId, tab) => set({ lastPosition: { unitId, tab } }),
  toggleBookmark: (id) => set(s => ({ bookmarks: s.bookmarks.includes(id) ? s.bookmarks.filter(b => b !== id) : [...s.bookmarks, id] })),
  setDailyChallenge: (d) => set({ dailyChallenge: d }),
  resetUnit: (unitId) => set(s => { const lessons = { ...s.lessons }; delete lessons[unitId]; return { lessons } }),
  importState: (imp) => set(s => ({ ...s, ...imp })),
  resetAll: () => set({ ...initial }),
}), { name: 'deutsch-progress', storage: createJSONStorage(() => idbStorage) }))

// ===== selectores =====
export function isUnlocked(s: AppState, unitId: string) {
  if (s.settings.unlockAll) return true
  const i = UNITS.findIndex(u => u.id === unitId)
  if (i <= 0) return true
  const prev = UNITS[i - 1]
  return (s.lessons[prev.id]?.testBest ?? 0) >= 70
}
export const unitStatus = (s: AppState, unitId: string): 'locked' | 'new' | 'started' | 'done' => {
  if (!isUnlocked(s, unitId)) return 'locked'
  const l = s.lessons[unitId]; if (!l) return 'new'
  return l.testBest >= 70 ? 'done' : 'started'
}
export const vocabLevel = (v?: VocabProgress): 0|1|2|3|4 => { if (!v) return 0; const r = v.srs.reps; if (r === 0) return v.wrong ? 1 : 0; if (r < 2) return 1; if (r < 4) return 2; if (r < 6) return 3; return 4 }
export function exerciseAccuracy(s: AppState, id: string) { const e = s.exerciseStats[id]; return e && e.attempts ? e.correct / e.attempts : null }
export { exerciseById }
