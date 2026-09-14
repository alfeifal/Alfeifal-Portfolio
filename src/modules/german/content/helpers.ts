import type { VocabItem, Exercise, Difficulty, Skill, Cefr } from './types'

let vc = 0
export function v(unitId: string, cefr: Cefr, category: string, article: 'der'|'die'|'das'|'' , de: string, plural: string, es: string, example: string, exampleEs: string, pos: VocabItem['pos'] = article ? 'noun' : 'other'): VocabItem {
  vc++
  return { id: `${unitId}-v${vc}`, de, article: article || undefined, plural: plural || undefined, es, pos, example, exampleEs, unitId, category, cefr }
}

type Meta = { u: string; c: string[]; d?: Difficulty; s?: Skill; mixed?: boolean; hint?: string }
const base = (m: Meta) => ({ unitId: m.u, concepts: m.c, difficulty: (m.d ?? 2) as Difficulty, skill: (m.s ?? 'grammar') as Skill, origin: 'AI' as const, mixed: m.mixed, hint: m.hint })
let ec = 0
const nid = (m: Meta) => `${m.u}-e${++ec}`

export const mc = (m: Meta, prompt: string, question: string, options: string[], answer: number, explanation: string): Exercise =>
  ({ ...base(m), id: nid(m), type: 'mc', prompt, question, options, answer, explanation })
export const gap = (m: Meta, prompt: string, text: string, answers: (string|string[])[], explanation: string): Exercise =>
  ({ ...base(m), id: nid(m), type: 'gap', prompt, text, answers: answers.map(a => Array.isArray(a) ? a : [a]), explanation })
export const tr = (m: Meta, source: string, answers: string[], explanation: string, direction: 'es-de'|'de-es'|'transform' = 'es-de', prompt?: string): Exercise =>
  ({ ...base({ s: direction === 'transform' ? 'grammar' : 'translation', ...m }), id: nid(m), type: 'translate', prompt: prompt ?? (direction === 'es-de' ? 'Traduce al alemán' : direction === 'de-es' ? 'Traduce al español' : 'Transforma la frase'), source, answers, direction, explanation })
export const order = (m: Meta, words: string[], answers: string[], explanation: string, prompt = 'Ordena las palabras para formar una frase correcta'): Exercise =>
  ({ ...base(m), id: nid(m), type: 'order', prompt, words, answers, explanation })
export const match = (m: Meta, prompt: string, pairs: [string, string][], explanation: string): Exercise =>
  ({ ...base(m), id: nid(m), type: 'match', prompt, pairs, explanation })
export const classify = (m: Meta, prompt: string, categories: string[], items: [string, number][], explanation: string): Exercise =>
  ({ ...base(m), id: nid(m), type: 'classify', prompt, categories, items, explanation })
export const reading = (m: Meta, passage: string, questions: { q: string; options: string[]; answer: number }[], explanation: string): Exercise =>
  ({ ...base({ s: 'reading', ...m }), id: nid(m), type: 'reading', prompt: 'Lee el texto y responde', passage, questions, explanation })
export const write = (m: Meta, task: string, rubric: string[], explanation: string): Exercise =>
  ({ ...base({ s: 'writing', ...m }), id: nid(m), type: 'write', prompt: 'Escribe en alemán', task, rubric, explanation })
