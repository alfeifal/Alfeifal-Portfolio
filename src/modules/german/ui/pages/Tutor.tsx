import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '@german/store'
import { askTutor, buildSystem, type Msg } from '@german/tutor/client'
import { UNITS, CONCEPTS } from '@german/content'
import { Umlauts } from '../components/ExerciseRunner'

const SCENARIOS = [
  { id: 'cafe', title: 'En la cafetería', de: 'Im Café', desc: 'Pedir, preguntar precios, pagar' },
  { id: 'vorstellen', title: 'Presentarse', de: 'Sich vorstellen', desc: 'Nombre, origen, trabajo, aficiones' },
  { id: 'arbeit', title: 'En el trabajo', de: 'Bei der Arbeit', desc: 'Hablar con un compañero sobre el día en el resort' },
  { id: 'weg', title: 'Preguntar el camino', de: 'Nach dem Weg fragen', desc: 'Direcciones y preposiciones de lugar' },
  { id: 'arzt', title: 'En el médico', de: 'Beim Arzt', desc: 'Síntomas, tener + sustantivo, modales' },
  { id: 'wochenende', title: 'El fin de semana', de: 'Das Wochenende', desc: 'Contar lo que hiciste en Perfekt' },
]

export function Tutor({ conversation }: { conversation?: boolean }) {
  const s = useStore(); const [sp] = useSearchParams()
  const [msgs, setMsgs] = useState<Msg[]>([]); const [input, setInput] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [scenario, setScenario] = useState<typeof SCENARIOS[number] | null>(null)
  const unitId = sp.get('unit') ?? undefined; const conceptId = sp.get('concept') ?? undefined
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])
  const ctxLabel = unitId ? `Unidad ${UNITS.find(u => u.id === unitId)?.number}` : conceptId ? CONCEPTS.find(c => c.id === conceptId)?.nameEs : null
  async function send(text: string) {
    if (!text.trim() || busy) return
    
    const next = [...msgs, { role: 'user' as const, content: text }]; setMsgs(next); setInput(''); setBusy(true); setErr('')
    try { const sys = buildSystem(s, conversation ? { mode: 'conversation', scenario: scenario ? `${scenario.title} (${scenario.de}): ${scenario.desc}` : 'conversación libre' } : { mode: 'tutor', unitId, conceptId }); const reply = await askTutor(s.settings.apiKey, sys, next); setMsgs([...next, { role: 'assistant', content: reply }]) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const startScenario = (sc: typeof SCENARIOS[number]) => { setScenario(sc); setMsgs([]); setTimeout(() => send(`Empecemos el escenario «${sc.title}». Empieza tú en alemán.`), 0) }
  const suggestions = conversation ? [] : ['Explícame la diferencia entre Akkusativ y Dativ con ejemplos', '¿Por qué he fallado tanto últimamente? Dame un plan', 'Ponme 3 frases para traducir sobre mi rutina', 'Explícame los verbos separables como si fuera el español']
  return <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 140px)' }}>
    <h1 className="h1 mb-1">{conversation ? 'Conversación' : 'AI Tutor'}</h1>
    <p className="text-sm muted mb-3">{conversation ? 'Practica diálogos en alemán. El tutor corrige cada respuesta y sigue la conversación.' : `Conoce el temario del libro y tus errores.${ctxLabel ? ` Contexto: ${ctxLabel}.` : ''}`}</p>
    
    {conversation && !scenario && <div className="grid gap-2 mb-3">{SCENARIOS.map(sc => <button key={sc.id} className="card p-4 text-left" onClick={() => startScenario(sc)}><p className="font-semibold">{sc.title} <span className="muted font-normal text-sm">· {sc.de}</span></p><p className="text-xs muted">{sc.desc}</p></button>)}<button className="card p-4 text-left" onClick={() => { setScenario({ id: 'frei', title: 'Conversación libre', de: 'Freies Gespräch', desc: 'Sobre lo que quieras' }); setMsgs([]) }}><p className="font-semibold">Conversación libre</p></button></div>}
    {(!conversation || scenario) && <>
      {scenario && <p className="mb-2 text-xs"><span className="pill">{scenario.title}</span> <button className="underline muted ml-2" onClick={() => { setScenario(null); setMsgs([]) }}>cambiar escenario</button></p>}
      <div className="flex-1 space-y-3 mb-3">
        {msgs.length === 0 && !conversation && <div className="grid gap-2">{suggestions.map(q => <button key={q} className="card p-3 text-left text-sm" onClick={() => send(q)}>{q}</button>)}</div>}
        {msgs.map((m, i) => <div key={i} className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${m.role === 'user' ? 'ml-auto bg-primary text-white' : 'card'}`}>{m.content}</div>)}
        {busy && <div className="card px-4 py-2.5 text-sm muted w-fit">Escribiendo…</div>}
        {err && <p className="text-sm text-bad">{err}</p>}
        <div ref={bottom} />
      </div>
      <div className="sticky bottom-20 md:bottom-4"><div className="card p-2 flex gap-2 items-end"><textarea rows={2} className="field !border-0 !ring-0 resize-none" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }} placeholder={conversation ? 'Responde en alemán…' : 'Pregunta al tutor…'} /><button className="btn-primary" disabled={busy || !input.trim()} onClick={() => send(input)}>Enviar</button></div><Umlauts onInsert={c => setInput(t => t + c)} /></div>
    </>}
  </div>
}
