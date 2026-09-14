import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CONCEPTS, conceptById, unitById, EXERCISES } from '@german/content'
import { useStore } from '@german/store'
import { Mastery } from '../components/ui'
import { Markdown } from '../components/Markdown'
import { Session, SessionSummary, type SessionResult } from '../components/Session'

export function Grammar() {
  const s = useStore(); const [q, setQ] = useState('')
  const list = CONCEPTS.filter(c => !q || (c.name + c.nameEs + c.summary).toLowerCase().includes(q.toLowerCase()))
  return <div>
    <h1 className="h1 mb-1">Gramática</h1><p className="text-sm muted mb-3">{CONCEPTS.length} conceptos, ordenados como en el libro.</p>
    <input className="field mb-4" placeholder="Buscar concepto (Akkusativ, dativo, weil…)" value={q} onChange={e => setQ(e.target.value)} />
    <ul className="card divide-y divide-line dark:divide-white/10">{list.map(c => <li key={c.id}><Link to={`/gramatica/${c.id}`} className="flex items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="font-medium">{c.name} <span className="muted font-normal">· {c.nameEs}</span></p><p className="text-xs muted">U{unitById(c.unitId)?.number} · {c.summary}</p></div><Mastery level={s.mastery[c.id]?.level ?? 0} small /></Link></li>)}</ul>
  </div>
}

export function ConceptPage() {
  const { id } = useParams(); const s = useStore(); const c = conceptById(id!)
  const [run, setRun] = useState(false); const [result, setResult] = useState<SessionResult | null>(null)
  if (!c) return <p>Concepto no encontrado.</p>
  const u = unitById(c.unitId)!
  const sections = [...u.learn, ...u.understand]
  const exs = EXERCISES.filter(e => e.concepts.includes(c.id) && e.type !== 'write')
  const errs = s.errors.filter(e => e.concepts.includes(c.id) && !e.resolved).slice(0, 5)
  const m = s.mastery[c.id]
  return <div>
    <p className="text-xs muted mb-1"><Link to="/gramatica">← Gramática</Link> · <Link to={`/curso/${u.id}`}>Unidad {u.number}</Link></p>
    <h1 className="h1">{c.name}</h1><p className="text-sm muted mb-2">{c.nameEs}</p>
    <div className="mb-4 flex items-center gap-3"><Mastery level={m?.level ?? 0} />{m && <span className="text-xs muted">{m.correct}/{m.correct + m.wrong} aciertos</span>}</div>
    <div className="card p-4 mb-3"><p className="font-medium">{c.summary}</p></div>
    {c.mistakes.length > 0 && <div className="card p-4 mb-3"><p className="font-semibold mb-1">Errores típicos</p><ul className="ml-4 list-disc text-sm space-y-0.5">{c.mistakes.map((x, i) => <li key={i}><Markdown text={x} /></li>)}</ul></div>}
    {errs.length > 0 && <div className="card p-4 mb-3 border-bad"><p className="font-semibold mb-1">Tus errores recientes aquí</p><ul className="text-sm space-y-1">{errs.map(e => <li key={e.id}><s className="opacity-60">{e.given}</s> → <b>{e.expected}</b></li>)}</ul></div>}
    <details className="card p-4 mb-3"><summary className="cursor-pointer font-semibold">Explicación completa (Unidad {u.number})</summary>{sections.map((sec, i) => <div key={i} className="mt-3"><h3 className="font-semibold mb-1">{sec.title}</h3><Markdown text={sec.body} /></div>)}</details>
    {c.related.length > 0 && <p className="mb-4 text-sm flex flex-wrap gap-1 items-center"><span className="muted">Relacionado:</span>{c.related.map(r => conceptById(r) ? <Link key={r} to={`/gramatica/${r}`} className="pill hover:underline">{conceptById(r)!.nameEs}</Link> : null)}</p>}
    {!run && !result && <button className="btn-primary" onClick={() => setRun(true)}>Practicar este concepto ({exs.length} ejercicios)</button>}
    {run && <div className="mt-4"><Session exercises={exs} title={`Práctica · ${c.nameEs}`} onFinish={r => { setResult(r); setRun(false) }} onExit={() => setRun(false)} /></div>}
    {result && <div className="mt-4"><SessionSummary result={result} label={c.nameEs} onAgain={() => { setResult(null); setRun(true) }} onExit={() => setResult(null)} /></div>}
  </div>
}
