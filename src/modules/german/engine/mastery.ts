export type MasteryLevel = 0 | 1 | 2 | 3 | 4
export interface MasteryRecord {
  level: MasteryLevel
  correct: number
  wrong: number
  streakWrong: number
  seen: boolean
  days: string[]            // días distintos con práctica (YYYY-MM-DD), máx 30
  examHits: number[]        // timestamps de aciertos en exámenes mixtos/adaptativos
  lastAt: number
}
export const MASTERY_LABELS = ['No aprendido', 'En progreso', 'Familiarizado', 'Dominado', 'Mastered']
export const MASTERY_COLORS = ['#C43D2A', '#E0961E', '#C9A800', '#1E8A5A', '#2F4BD6']
export const newMastery = (): MasteryRecord => ({ level: 0, correct: 0, wrong: 0, streakWrong: 0, seen: false, days: [], examHits: [], lastAt: 0 })

export const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)

export function computeLevel(m: MasteryRecord): MasteryLevel {
  const total = m.correct + m.wrong
  const acc = total ? m.correct / total : 0
  let lvl: MasteryLevel = m.seen ? 1 : 0
  if (total >= 3 && acc >= 0.7) lvl = 2
  if (total >= 8 && acc >= 0.85 && m.days.length >= 3) lvl = 3
  if (lvl === 3 && m.examHits.length >= 2) {
    const sorted = [...m.examHits].sort()
    if (sorted[sorted.length - 1] - sorted[0] >= 14 * 86400000) lvl = 4
  }
  if (m.streakWrong >= 3 && lvl > 0) lvl = (lvl - 1) as MasteryLevel
  return lvl
}

export function recordResult(m: MasteryRecord, correct: boolean, inExam = false, now = Date.now()): MasteryRecord {
  const r = { ...m, seen: true, lastAt: now, days: [...m.days], examHits: [...m.examHits] }
  if (correct) { r.correct++; r.streakWrong = 0; if (inExam) r.examHits.push(now) } else { r.wrong++; r.streakWrong++ }
  const d = dayKey(now); if (!r.days.includes(d)) r.days.push(d); if (r.days.length > 30) r.days.shift()
  r.level = computeLevel(r)
  return r
}
