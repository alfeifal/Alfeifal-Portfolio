import { UNITS, VOCAB, CONCEPTS } from '@german/content'
import type { AppState } from '@german/store'
import { isUnlocked, vocabLevel } from '@german/store'
import { isDue } from './srs'
import { dayKey } from './mastery'

export interface Action { kind: 'review' | 'weak' | 'lesson' | 'test' | 'daily' | 'exam'; title: string; detail: string; minutes: number; to: string; icon: string }

export function dueVocab(s: AppState, now = Date.now()) {
  // palabras de unidades desbloqueadas; nuevas cuentan si la unidad está empezada
  return VOCAB.filter(v => isUnlocked(s, v.unitId) && (s.lessons[v.unitId] || s.vocab[v.id]) && isDue(s.vocab[v.id]?.srs, now))
}
export function dueConcepts(s: AppState, now = Date.now()) {
  return CONCEPTS.filter(c => s.mastery[c.id]?.seen && isDue(s.conceptSrs[c.id], now))
}
export function weakConcepts(s: AppState, now = Date.now()) {
  const counts: Record<string, number> = {}
  for (const e of s.errors) if (!e.resolved && now - e.at < 7 * 86400000) for (const c of e.concepts) counts[c] = (counts[c] ?? 0) + 1
  return Object.entries(counts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ concept: CONCEPTS.find(c => c.id === id)!, n })).filter(x => x.concept)
}
export function nextUnit(s: AppState) {
  const started = UNITS.find(u => { const l = s.lessons[u.id]; return l && l.testBest < 70 && isUnlocked(s, u.id) })
  if (started) return started
  return UNITS.find(u => isUnlocked(s, u.id) && !s.lessons[u.id]) ?? UNITS.find(u => isUnlocked(s, u.id) && (s.lessons[u.id]?.testBest ?? 0) < 70) ?? null
}

export function plan(s: AppState): Action[] {
  const out: Action[] = []
  const dv = dueVocab(s); const dc = dueConcepts(s)
  if (dv.length + dc.length >= 8) out.push({ kind: 'review', title: `Repasar ${Math.min(dv.length, 20)} palabras${dc.length ? ` y ${dc.length} conceptos` : ''}`, detail: 'Repaso espaciado pendiente', minutes: Math.min(15, 2 + Math.ceil((dv.length + dc.length) / 3)), to: '/repasar', icon: '🔁' })
  const weak = weakConcepts(s)
  if (weak.length) out.push({ kind: 'weak', title: `Practicar ${weak[0].concept.nameEs}`, detail: `${weak[0].n} errores esta semana`, minutes: 8, to: `/practica?weak=1`, icon: '🎯' })
  const u = nextUnit(s)
  if (u) {
    const l = s.lessons[u.id]
    const done = l?.sectionsDone ?? []
    if (!done.includes('learn') || !done.includes('practice')) out.push({ kind: 'lesson', title: `${l ? 'Continuar' : 'Empezar'} Unidad ${u.number}: ${u.title}`, detail: l ? `Secciones hechas: ${done.length}/5` : `Nivel ${u.cefr}`, minutes: 15, to: `/curso/${u.id}`, icon: '📚' })
    else out.push({ kind: 'test', title: `Test de la Unidad ${u.number}`, detail: (l?.testBest ?? 0) > 0 ? `Mejor: ${l!.testBest}% — necesitas 70%` : 'Desbloquea la siguiente unidad', minutes: 10, to: `/curso/${u.id}?tab=test`, icon: '🧪' })
  }
  const today = dayKey()
  if (!(s.dailyChallenge?.date === today && s.dailyChallenge.done)) out.push({ kind: 'daily', title: 'Daily Challenge', detail: '10 preguntas mixtas de hoy', minutes: 6, to: '/retos/daily', icon: '🔥' })
  if (dv.length + dc.length > 0 && dv.length + dc.length < 8 && !out.some(a => a.kind === 'review')) out.push({ kind: 'review', title: `Repasar ${dv.length + dc.length} elementos`, detail: 'Repaso rápido', minutes: 3, to: '/repasar', icon: '🔁' })
  return out
}

export function continueTarget(s: AppState) { return plan(s)[0]?.to ?? '/curso' }

export function unitSkillProgress(s: AppState, unitId: string) {
  const u = UNITS.find(x => x.id === unitId)!
  const cm = u.concepts.map(c => (s.mastery[c]?.level ?? 0) / 4)
  const grammar = cm.length ? cm.reduce((a, b) => a + b, 0) / cm.length : 0
  const vs = VOCAB.filter(v => v.unitId === unitId).map(v => vocabLevel(s.vocab[v.id]) / 4)
  const vocab = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0
  const l = s.lessons[unitId]
  const test = (l?.testBest ?? 0) / 100
  return { grammar, vocab, test, overall: (grammar * 0.4 + vocab * 0.3 + test * 0.3) }
}

export function globalProgress(s: AppState) {
  const per = UNITS.map(u => unitSkillProgress(s, u.id).overall)
  const book = UNITS.filter(u => (s.lessons[u.id]?.testBest ?? 0) >= 70).length / UNITS.length
  const grammar = CONCEPTS.length ? CONCEPTS.reduce((a, c) => a + (s.mastery[c.id]?.level ?? 0), 0) / (CONCEPTS.length * 4) : 0
  const vocabLearned = VOCAB.filter(v => vocabLevel(s.vocab[v.id]) >= 3).length
  const cefr = book < 0.25 ? 'A1' : book < 0.65 ? 'A1+/A2' : book < 0.9 ? 'A2' : 'A2+/B1'
  return { overall: per.reduce((a, b) => a + b, 0) / per.length, book, grammar, vocabLearned, cefr, completedUnits: Math.round(book * UNITS.length) }
}
