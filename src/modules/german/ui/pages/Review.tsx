import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '@german/store'
import { dueVocab, dueConcepts } from '@german/engine/recommend'
import { conceptById, EXERCISES } from '@german/content'
import type { Exercise } from '@german/content/types'
import { ExerciseRunner } from '../components/ExerciseRunner'
import { Speak } from '../components/Speak'

export function Review() {
  const s = useStore()
  const dv = useMemo(() => dueVocab(s).slice(0, 25), [])
  const dc = useMemo(() => dueConcepts(s).slice(0, 8), [])
  const [phase, setPhase] = useState<'intro' | 'vocab' | 'concepts' | 'done'>('intro')
  const [i, setI] = useState(0); const [flip, setFlip] = useState(false); const [ci, setCi] = useState(0)
  const [conceptEx, setConceptEx] = useState<Exercise | null>(null); const [answered, setAnswered] = useState(false)
  const pickEx = (cid: string) => { const pool = EXERCISES.filter(e => e.concepts.includes(cid) && e.type !== 'write'); return pool[Math.floor(Math.random() * pool.length)] ?? null }
  const startConcepts = () => { setPhase(dc.length ? 'concepts' : 'done'); setCi(0); if (dc[0]) setConceptEx(pickEx(dc[0].id)) }
  if (phase === 'intro') return <div>
    <h1 className="h1 mb-1">Repasar</h1><p className="text-sm muted mb-4">Repaso espaciado: lo que está a punto de olvidarse aparece aquí. Intervalos 1 → 3 → 7 → 14 → 30 días, ajustados a tus respuestas.</p>
    <div className="card p-5 mb-3"><p className="text-3xl font-semibold tabular-nums">{dv.length}<span className="text-base font-normal muted"> palabras</span> · {dc.length}<span className="text-base font-normal muted"> conceptos</span></p><p className="text-sm muted mb-3">pendientes de repaso hoy</p>
      {dv.length + dc.length > 0 ? <button className="btn-primary" onClick={() => { if (dv.length) { setPhase('vocab'); setI(0) } else startConcepts() }}>Empezar repaso</button> : <p className="text-sm">Nada pendiente. Sigue con el <Link to="/curso" className="text-primary underline">curso</Link> o haz un <Link to="/retos" className="text-primary underline">reto</Link>.</p>}</div>
    {dc.length > 0 && <div className="card p-4"><p className="text-sm font-semibold mb-1">Conceptos a repasar</p><p className="flex flex-wrap gap-1">{dc.map(c => <Link key={c.id} to={`/gramatica/${c.id}`} className="pill hover:underline">{c.nameEs}</Link>)}</p></div>}
  </div>
  if (phase === 'vocab') {
    const v = dv[i]; if (!v) { startConcepts(); return null }
    const grade = (g: 0 | 1 | 2 | 3) => { s.reviewVocab(v.id, g); setFlip(false); if (i + 1 >= dv.length) startConcepts(); else setI(i + 1) }
    return <div><p className="mb-2 text-xs muted">Vocabulario · {i + 1} / {dv.length}</p>
      <button onClick={() => setFlip(f => !f)} className="card w-full p-8 min-h-[190px] flex flex-col items-center justify-center text-center">{!flip ? <><p className="text-2xl font-semibold">{v.article ? `${v.article} ` : ''}{v.de}</p><p className="mt-2 text-xs muted">Toca para ver</p></> : <><p className="text-xl font-semibold">{v.es}</p>{v.plural && <p className="text-sm muted">pl. die {v.plural}</p>}<p className="mt-3 text-sm">{v.example}</p><p className="text-xs muted">{v.exampleEs}</p></>}</button>
      <div className="mt-2 flex justify-center gap-2"><Speak text={`${v.article ? v.article + ' ' : ''}${v.de}`} /><Speak text={`${v.article ? v.article + ' ' : ''}${v.de}`} slow /><Speak text={v.example} className="opacity-70" /></div>
      {flip && <div className="mt-3 grid grid-cols-4 gap-2"><button className="btn-bad" onClick={() => grade(0)}>Otra vez</button><button className="btn-ghost" onClick={() => grade(1)}>Difícil</button><button className="btn-good" onClick={() => grade(2)}>Bien</button><button className="btn-primary" onClick={() => grade(3)}>Fácil</button></div>}</div>
  }
  if (phase === 'concepts') {
    const c = dc[ci]; if (!c || !conceptEx) return <div className="card p-4">Sin ejercicios para {c?.nameEs}. <button className="btn-ghost" onClick={() => setPhase('done')}>Terminar</button></div>
    return <div><p className="mb-2 text-xs muted">Conceptos · {ci + 1} / {dc.length} · {conceptById(c.id)?.nameEs}</p>
      <ExerciseRunner ex={conceptEx} onResult={o => { setAnswered(true); s.recordAnswer(conceptEx, o.correct, o.given, o.expected); s.reviewConcept(c.id, o.correct ? 2 : 0) }} onNext={answered ? () => { setAnswered(false); if (ci + 1 >= dc.length) setPhase('done'); else { setCi(ci + 1); setConceptEx(pickEx(dc[ci + 1].id)) } } : undefined} /></div>
  }
  return <div className="card p-6 text-center"><p className="text-2xl font-semibold mb-1">Repaso completado</p><p className="text-sm muted mb-3">{dv.length} palabras y {dc.length} conceptos. Vuelve mañana.</p><Link to="/" className="btn-primary">Volver a Hoy</Link></div>
}
