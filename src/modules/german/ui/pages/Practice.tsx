import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { UNITS, CONCEPTS } from '@german/content'
import type { Skill } from '@german/content/types'
import { useStore, isUnlocked } from '@german/store'
import { generateExam, type ExamConfig } from '@german/engine/exam'
import { weakConcepts } from '@german/engine/recommend'
import { Session, SessionSummary, type SessionResult } from '../components/Session'

const SKILLS: [Skill, string][] = [['grammar', 'Gramática'], ['vocab', 'Vocabulario'], ['translation', 'Traducción'], ['reading', 'Lectura'], ['writing', 'Escritura']]

export function Practice() {
  const s = useStore(); const [sp] = useSearchParams()
  const weak = sp.get('weak') === '1'; const concept = sp.get('concept')
  const unlocked = UNITS.filter(u => isUnlocked(s, u.id)).map(u => u.id)
  const [skills, setSkills] = useState<Skill[]>(['grammar', 'translation', 'vocab'])
  const [units, setUnits] = useState<string[]>(unlocked)
  const [difficulty, setDifficulty] = useState<ExamConfig['difficulty']>('normal')
  const [count, setCount] = useState(10)
  const [concepts, setConcepts] = useState<string[]>(concept ? [concept] : weak ? weakConcepts(s).map(w => w.concept.id) : [])
  const [phase, setPhase] = useState<'config' | 'run' | 'done'>(concept || weak ? 'run' : 'config')
  const [result, setResult] = useState<SessionResult | null>(null); const [run, setRun] = useState(0)
  const exs = useMemo(() => phase === 'run' ? generateExam(s, { skills: concepts.length ? ['grammar', 'vocab', 'translation', 'reading'] : skills, units: concepts.length ? UNITS.map(u => u.id) : units, difficulty, count, mode: concepts.length ? 'weak' : 'practice', concepts: concepts.length ? concepts : undefined, includeMixed: true }) : [], [phase, run])
  const toggle = <T,>(arr: T[], v: T) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]
  if (phase === 'run') return <Session key={run} exercises={exs} title={concepts.length ? `Práctica · ${concepts.map(c => CONCEPTS.find(k => k.id === c)?.nameEs).join(', ')}` : 'Práctica libre'} onFinish={r => { setResult(r); setPhase('done') }} onExit={() => setPhase('config')} />
  if (phase === 'done' && result) return <SessionSummary result={result} label="Práctica libre" onAgain={() => { setRun(r => r + 1); setPhase('run') }} onRetakeFailed={() => { setConcepts(Array.from(new Set(result.answers.filter(a => !a.correct).flatMap(a => a.ex.concepts)))); setRun(r => r + 1); setPhase('run') }} onExit={() => { setConcepts([]); setPhase('config') }} />
  return <div>
    <h1 className="h1 mb-1">Práctica libre</h1><p className="text-sm muted mb-4">Sin desbloqueo ni límite de tiempo. Elige qué practicar.</p>
    <div className="card p-4 mb-3"><p className="font-semibold mb-2 text-sm">Habilidades</p><div className="flex flex-wrap gap-1.5">{SKILLS.map(([k, l]) => <button key={k} className={`tab border border-line ${skills.includes(k) ? 'tab-active' : ''}`} onClick={() => setSkills(toggle(skills, k))}>{l}</button>)}</div></div>
    <div className="card p-4 mb-3"><div className="mb-2 flex items-center justify-between"><p className="font-semibold text-sm">Unidades</p><span className="text-xs"><button className="underline mr-2" onClick={() => setUnits(unlocked)}>desbloqueadas</button><button className="underline mr-2" onClick={() => setUnits(UNITS.map(u => u.id))}>todas</button><button className="underline" onClick={() => setUnits([])}>ninguna</button></span></div><div className="flex flex-wrap gap-1.5">{UNITS.map(u => <button key={u.id} className={`tab border border-line !px-2.5 ${units.includes(u.id) ? 'tab-active' : ''}`} onClick={() => setUnits(toggle(units, u.id))}>{u.number}</button>)}</div></div>
    <div className="card p-4 mb-3"><p className="font-semibold mb-2 text-sm">Conceptos concretos (opcional)</p><select className="field" value="" onChange={e => { if (e.target.value) setConcepts(toggle(concepts, e.target.value)) }}><option value="">Añadir concepto…</option>{CONCEPTS.map(c => <option key={c.id} value={c.id}>{c.nameEs}</option>)}</select>{concepts.length > 0 && <p className="mt-2 flex flex-wrap gap-1">{concepts.map(c => <button key={c} className="pill" onClick={() => setConcepts(toggle(concepts, c))}>{CONCEPTS.find(k => k.id === c)?.nameEs} ✕</button>)}</p>}</div>
    <div className="card p-4 mb-4 grid grid-cols-2 gap-3 text-sm"><label>Dificultad<select className="field mt-1 !py-2" value={difficulty} onChange={e => setDifficulty(e.target.value as ExamConfig['difficulty'])}><option value="easy">⭐–⭐⭐ Fácil</option><option value="normal">⭐–⭐⭐⭐ Normal</option><option value="hard">⭐⭐⭐–⭐⭐⭐⭐ Difícil</option><option value="adaptive">Adaptativa</option></select></label><label>Ejercicios<select className="field mt-1 !py-2" value={count} onChange={e => setCount(Number(e.target.value))}>{[5, 10, 15, 20, 30].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div>
    <button className="btn-primary w-full !py-3" disabled={(!skills.length || !units.length) && !concepts.length} onClick={() => { setRun(r => r + 1); setPhase('run') }}>Empezar</button>
  </div>
}
