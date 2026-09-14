import * as A from './units/blockA'
import * as B from './units/blockB'
import * as C from './units/blockC'
import * as D from './units/blockD'
import type { Unit, Concept, VocabItem, Exercise } from './types'

export const UNITS: Unit[] = [...A.units, ...B.units, ...C.units, ...D.units]
export const CONCEPTS: Concept[] = [...A.concepts, ...B.concepts, ...C.concepts, ...D.concepts]
export const VOCAB: VocabItem[] = [...A.vocab, ...B.vocab, ...C.vocab, ...D.vocab]
export const EXERCISES: Exercise[] = [...A.exercises, ...B.exercises, ...C.exercises, ...D.exercises]

export const BLOCKS: Record<string, { title: string; cefr: string; units: string[] }> = {
  A: { title: 'Fundamentos y verbo en presente', cefr: 'A1', units: UNITS.filter(u => u.block === 'A').map(u => u.id) },
  B: { title: 'Sustantivos, género y casos', cefr: 'A1 → A2', units: UNITS.filter(u => u.block === 'B').map(u => u.id) },
  C: { title: 'Ampliación: tiempos, modales, preposiciones', cefr: 'A2', units: UNITS.filter(u => u.block === 'C').map(u => u.id) },
  D: { title: 'Sintaxis avanzada', cefr: 'A2 → B1', units: UNITS.filter(u => u.block === 'D').map(u => u.id) },
}

export const SOURCE = {
  title: 'Basic German: A Grammar and Workbook',
  authors: 'Heiner Schenke & Karen Seago',
  publisher: 'Routledge, 2004',
  note: 'La estructura de 28 unidades, los conceptos gramaticales y los tipos de ejercicio proceden del libro (SOURCE). Todas las explicaciones en español, ejemplos, ejercicios y el vocabulario han sido escritos para esta app (AI), basados en los conceptos de cada unidad.'
}

export const unitById = (id: string) => UNITS.find(u => u.id === id)
export const conceptById = (id: string) => CONCEPTS.find(c => c.id === id)
export const exercisesOfUnit = (id: string) => EXERCISES.filter(e => e.unitId === id && !e.mixed)
export const vocabOfUnit = (id: string) => VOCAB.filter(v => v.unitId === id)
export const exerciseById = (id: string) => EXERCISES.find(e => e.id === id)
export const vocabById = (id: string) => VOCAB.find(v => v.id === id)
export const unitIndex = (id: string) => UNITS.findIndex(u => u.id === id)
