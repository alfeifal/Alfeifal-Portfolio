import type { Exercise } from '@german/content/types'

/** Normaliza para comparar: minúsculas, espacios, puntuación final. Mantiene umlauts y ß. */
export function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?,;:]+$/g, '').replace(/\s*([,.!?;:])\s*/g, '$1 ').replace(/\s+/g, ' ').trim()
}
/** Versión que también tolera ae/oe/ue/ss — se usa solo para detectar "casi correcto" */
export function loose(s: string): string {
  return norm(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
}

export type Verdict = { correct: boolean; almost?: string; expected: string; given: string }

export function gradeText(given: string, answers: string[]): Verdict {
  const g = norm(given)
  for (const a of answers) if (norm(a) === g) return { correct: true, expected: a, given }
  const gl = loose(given)
  for (const a of answers) if (loose(a) === gl) return { correct: false, almost: 'Casi: revisa umlauts (ä ö ü) o ß.', expected: answers[0], given }
  // capitalización de sustantivos
  return { correct: false, expected: answers[0], given }
}

export function gradeGaps(given: string[], answers: string[][]): { correct: boolean; perGap: Verdict[] } {
  const perGap = answers.map((alts, i) => gradeText(given[i] ?? '', alts))
  return { correct: perGap.every(p => p.correct), perGap }
}

export function gradeOrder(given: string[], answers: string[]): Verdict {
  const g = norm(given.join(' '))
  const ok = answers.some(a => norm(a) === g)
  return { correct: ok, expected: answers[0], given: given.join(' ') }
}

/** Para MC/match/classify/reading la corrección es índice a índice */
export function gradeIndices(given: (number | null)[], expected: number[]): { correct: boolean; per: boolean[] } {
  const per = expected.map((e, i) => given[i] === e)
  return { correct: per.every(Boolean), per }
}

export function difficultyLabel(d: Exercise['difficulty']) { return '⭐'.repeat(d) }
