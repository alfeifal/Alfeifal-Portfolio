import { UNITS, CONCEPTS, SOURCE } from '@german/content'
import type { AppState } from '@german/store'
import { weakConcepts } from '@german/engine/recommend'

export interface Msg { role: 'user' | 'assistant'; content: string }

export function buildSystem(s: AppState, ctx?: { unitId?: string; conceptId?: string; mode?: 'tutor' | 'conversation'; scenario?: string }) {
  const unit = ctx?.unitId ? UNITS.find(u => u.id === ctx.unitId) : null
  const concept = ctx?.conceptId ? CONCEPTS.find(c => c.id === ctx.conceptId) : null
  const weak = weakConcepts(s).slice(0, 5).map(w => `${w.concept.name} (${w.n} errores)`).join(', ') || 'ninguno registrado'
  const errs = s.errors.slice(0, 12).map(e => `- escribió «${e.given}» / correcto «${e.expected}» [${e.concepts.join(', ')}]`).join('\n') || '(sin errores recientes)'
  const studied = UNITS.filter(u => s.lessons[u.id]).map(u => `U${u.number} ${u.title}`).join(', ') || 'ninguna todavía'
  const syllabus = UNITS.map(u => `U${u.number}: ${u.titleDe ?? u.title} — conceptos: ${u.concepts.join(', ')}`).join('\n')
  const base = `Eres el tutor de alemán de Ayoub, hispanohablante (vive en Girona), nivel principiante–A2. Respondes en español, breve y claro, comparando con el español cuando ayuda. El curso sigue la estructura del libro «${SOURCE.title}» (${SOURCE.authors}, ${SOURCE.publisher}); prioriza siempre los conceptos y el orden de ese temario, y cita la unidad correspondiente (p. ej. «→ Unidad 12, Akkusativ»). No inventes reglas. Insiste en artículo + sustantivo, umlauts y ß, y el verbo en 2ª posición.

TEMARIO:\n${syllabus}\n\nUNIDADES QUE HA ESTUDIADO: ${studied}\nCONCEPTOS DÉBILES: ${weak}\nERRORES RECIENTES:\n${errs}`
  if (ctx?.mode === 'conversation') return base + `\n\nMODO CONVERSACIÓN. Escenario: ${ctx.scenario}. Interpreta al otro personaje en alemán sencillo (1–3 frases por turno, nivel A1–A2). Ayoub responde en alemán. Tras cada respuesta suya, antes de continuar el diálogo, incluye un bloque de corrección en español con este formato exacto:\n✅ Correcto / ✏️ Corrección: <frase corregida>\nErrores: <lista breve con el concepto y unidad>\nNaturalidad: <1 frase>\nLuego continúa el diálogo en alemán. Si Ayoub escribe en español, ayúdale a decirlo en alemán y sigue.`
  if (ctx?.mode === 'tutor' && (unit || concept)) return base + `\n\nCONTEXTO ACTUAL: ${unit ? `Unidad ${unit.number} — ${unit.title}` : ''}${concept ? `; concepto ${concept.name} (${concept.nameEs}): ${concept.summary}` : ''}`
  return base
}

/**
 * Personal OS: the tutor call goes through the server (/api/german/tutor) which holds the Anthropic
 * key; nothing secret lives in the browser. The `apiKey` argument is kept for signature
 * compatibility with the original code and is ignored.
 */
export async function askTutor(_apiKey: string, system: string, messages: Msg[], maxTokens = 900): Promise<string> {
  const res = await fetch('/api/german/tutor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ system, messages, maxTokens }) })
  if (!res.ok) { let msg = `API ${res.status}`; try { msg = ((await res.json()) as { error?: string }).error ?? msg } catch {} throw new Error(msg) }
  return ((await res.json()) as { text: string }).text
}

/** Evaluación estructurada de una respuesta libre (escritura) */
export async function evaluateWriting(apiKey: string, s: AppState, task: string, rubric: string[], answer: string) {
  const system = buildSystem(s) + `\n\nEVALÚA un texto escrito por Ayoub. Devuelve SOLO JSON válido sin markdown con este esquema: {"score":0-100,"corrected":"texto corregido","errors":[{"wrong":"","right":"","concept":"id de concepto del temario si aplica","explanation":""}],"feedback":"2-3 frases en español","natural":"comentario breve sobre naturalidad"}`
  const user = `TAREA: ${task}\nRÚBRICA: ${rubric.join('; ')}\nTEXTO DE AYOUB:\n${answer}`
  const raw = await askTutor(apiKey, system, [{ role: 'user', content: user }], 1200)
  const clean = raw.replace(/```json|```/g, '').trim()
  return JSON.parse(clean) as { score: number; corrected: string; errors: { wrong: string; right: string; concept?: string; explanation: string }[]; feedback: string; natural: string }
}
