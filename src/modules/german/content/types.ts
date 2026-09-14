// ===== Modelo de contenido =====
export type Origin = 'SOURCE' | 'AI'
export type Cefr = 'A1' | 'A1+' | 'A2' | 'A2+' | 'B1'
export type Difficulty = 1 | 2 | 3 | 4
export type Skill = 'grammar' | 'vocab' | 'reading' | 'writing' | 'translation'

export interface Section { title: string; body: string /* markdown-lite: **b**, *i*, saltos, "- " listas, "| a | b |" tablas */ }

export interface Unit {
  id: string          // 'u12'
  number: number
  block: 'A' | 'B' | 'C' | 'D'
  title: string       // español
  titleDe?: string
  cefr: Cefr
  page: number        // página del libro donde empieza
  objectives: string[]
  concepts: string[]  // conceptIds
  learn: Section[]
  understand: Section[]
  bookExercises: string[]  // tipos de ejercicio que propone el libro (SOURCE)
}

export interface Concept {
  id: string
  name: string       // nombre alemán/gramatical (Akkusativ)
  nameEs: string
  unitId: string
  summary: string
  mistakes: string[] // errores comunes (AI)
  related: string[]
}

export interface VocabItem {
  id: string
  de: string
  article?: 'der' | 'die' | 'das'
  plural?: string
  es: string
  pos: 'noun' | 'verb' | 'adj' | 'adv' | 'prep' | 'conj' | 'pron' | 'num' | 'phrase' | 'other'
  example: string
  exampleEs: string
  unitId: string
  category: string
  cefr: Cefr
}

export type Exercise =
  | MCExercise | GapExercise | TranslateExercise | OrderExercise | MatchExercise | ClassifyExercise | ReadingExercise | WriteExercise

interface Base {
  id: string
  unitId: string
  concepts: string[]
  difficulty: Difficulty
  skill: Skill
  origin: Origin
  prompt: string          // instrucción en español
  hint?: string
  explanation: string     // por qué (se muestra tras corregir)
  mixed?: boolean         // combina ≥2 unidades (Mixed / Boss)
}
export interface MCExercise extends Base { type: 'mc'; question: string; options: string[]; answer: number }
export interface GapExercise extends Base { type: 'gap'; text: string /* usa ___ por hueco */; answers: string[][] /* por hueco, alternativas */ }
export interface TranslateExercise extends Base { type: 'translate'; source: string; answers: string[]; direction: 'es-de' | 'de-es' | 'transform' }
export interface OrderExercise extends Base { type: 'order'; words: string[]; answers: string[] /* frases válidas */ }
export interface MatchExercise extends Base { type: 'match'; pairs: [string, string][] }
export interface ClassifyExercise extends Base { type: 'classify'; categories: string[]; items: [string, number][] }
export interface ReadingExercise extends Base { type: 'reading'; passage: string; questions: { q: string; options: string[]; answer: number }[] }
export interface WriteExercise extends Base { type: 'write'; task: string; rubric: string[] }
