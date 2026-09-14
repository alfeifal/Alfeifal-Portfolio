import { EXERCISES, UNITS, CONCEPTS } from '@german/content'
import type { Exercise, Skill, Difficulty } from '@german/content/types'
import type { AppState } from '@german/store'
import { isUnlocked } from '@german/store'
import { isDue } from './srs'

export interface ExamConfig {
  skills: Skill[]
  units: string[]           // unitIds incluidas
  difficulty: 'easy' | 'normal' | 'hard' | 'adaptive'
  count: number
  mode: 'lesson' | 'unit' | 'cumulative' | 'global' | 'adaptive' | 'mixed' | 'mock' | 'boss' | 'daily' | 'practice' | 'retake' | 'weak'
  concepts?: string[]       // restringir a conceptos (retake / weak)
  includeMixed?: boolean
  seed?: number
}

const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
function shuffle<T>(a: T[], r: () => number) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } return b }

/** Peso por concepto: errores recientes, dominio bajo, tiempo sin practicar, repaso vencido. */
export function conceptWeight(s: AppState, cid: string, now = Date.now()) {
  const m = s.mastery[cid]
  const recentErrors = s.errors.filter(e => !e.resolved && e.concepts.includes(cid) && now - e.at < 7 * 86400000).length
  const level = m?.level ?? 0
  const daysSince = m?.lastAt ? (now - m.lastAt) / 86400000 : 10
  const due = isDue(s.conceptSrs[cid], now) ? 1.5 : 0
  return 1 + recentErrors * 3 + (4 - level) * 2 + Math.min(daysSince, 30) * 0.5 + due
}

export function completedUnits(s: AppState) { return UNITS.filter(u => (s.lessons[u.id]?.testBest ?? 0) >= 70 || (s.lessons[u.id]?.sectionsDone.length ?? 0) >= 2).map(u => u.id) }
export function studiedUnits(s: AppState) { return UNITS.filter(u => isUnlocked(s, u.id)).map(u => u.id) }

export function generateExam(s: AppState, cfg: ExamConfig): Exercise[] {
  const r = rng(cfg.seed ?? Date.now())
  const unitSet = new Set(cfg.units)
  let pool = EXERCISES.filter(e => cfg.skills.includes(e.skill) && e.type !== 'write' || (cfg.skills.includes('writing') && e.type === 'write'))
  pool = pool.filter(e => cfg.skills.includes(e.skill))
  if (cfg.mode === 'mixed' || cfg.mode === 'boss') pool = pool.filter(e => e.mixed)
  else if (!cfg.includeMixed) pool = pool.filter(e => !e.mixed || cfg.mode === 'global' || cfg.mode === 'adaptive' || cfg.mode === 'mock' || cfg.mode === 'daily')
  // mixed: los conceptos deben pertenecer a unidades estudiadas
  pool = pool.filter(e => e.mixed ? e.concepts.every(c => unitSet.has(CONCEPTS.find(k => k.id === c)?.unitId ?? '')) : unitSet.has(e.unitId))
  if (cfg.concepts?.length) { const cs = new Set(cfg.concepts); pool = pool.filter(e => e.concepts.some(c => cs.has(c))) }
  if (cfg.difficulty === 'easy') pool = pool.filter(e => e.difficulty <= 2)
  if (cfg.difficulty === 'hard') pool = pool.filter(e => e.difficulty >= 3)
  if (cfg.difficulty === 'normal') pool = pool.filter(e => e.difficulty >= 1 && e.difficulty <= 3)
  if (pool.length === 0) return []
  // ponderación
  const weighted = cfg.mode === 'adaptive' || cfg.mode === 'weak' || cfg.mode === 'daily' || cfg.mode === 'global' || cfg.mode === 'retake'
  let ordered: Exercise[]
  if (weighted) {
    const scored = pool.map(e => ({ e, w: e.concepts.reduce((a, c) => a + conceptWeight(s, c), 0) / e.concepts.length * (0.6 + r() * 0.8) }))
    scored.sort((a, b) => b.w - a.w)
    ordered = scored.map(x => x.e)
  } else ordered = shuffle(pool, r)
  // diversidad de tipos: evitar más de 40% del mismo tipo si hay alternativas
  const out: Exercise[] = []; const typeCount: Record<string, number> = {}
  const maxSame = Math.max(2, Math.ceil(cfg.count * 0.4))
  for (const e of ordered) { if (out.length >= cfg.count) break; if ((typeCount[e.type] ?? 0) >= maxSame && ordered.length > cfg.count) continue; out.push(e); typeCount[e.type] = (typeCount[e.type] ?? 0) + 1 }
  for (const e of ordered) { if (out.length >= cfg.count) break; if (!out.includes(e)) out.push(e) }
  if (cfg.mode === 'adaptive') return out // el runner ajusta en vivo
  // ordenar de fácil a difícil suavemente
  return out.sort((a, b) => a.difficulty - b.difficulty)
}

/** Selección adaptativa en vivo: dado el pool y el nivel actual, el siguiente ejercicio */
export function nextAdaptive(pool: Exercise[], used: Set<string>, level: Difficulty): Exercise | null {
  const cand = pool.filter(e => !used.has(e.id))
  if (!cand.length) return null
  const exact = cand.filter(e => e.difficulty === level)
  const near = cand.filter(e => Math.abs(e.difficulty - level) === 1)
  const pick = exact.length ? exact : near.length ? near : cand
  return pick[Math.floor(Math.random() * pick.length)]
}

export function summarize(s: AppState, answers: { ex: Exercise; correct: boolean }[]) {
  const by: Record<string, { c: number; w: number }> = {}
  for (const a of answers) for (const c of a.ex.concepts) { by[c] = by[c] ?? { c: 0, w: 0 }; if (a.correct) by[c].c++; else by[c].w++ }
  const strong = Object.entries(by).filter(([, v]) => v.w === 0 && v.c >= 1).map(([k]) => k)
  const weak = Object.entries(by).filter(([, v]) => v.w >= 1).sort((a, b) => b[1].w - a[1].w).map(([k]) => k)
  const recommended = weak.slice(0, 2).map(c => CONCEPTS.find(k => k.id === c)).filter(Boolean)
  return { by, strong, weak, recommended: recommended as NonNullable<typeof recommended[number]>[], failedIds: answers.filter(a => !a.correct).map(a => a.ex.id) }
}
