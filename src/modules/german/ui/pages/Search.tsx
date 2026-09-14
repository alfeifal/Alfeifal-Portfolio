import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { UNITS, CONCEPTS, VOCAB, EXERCISES } from '@german/content'

export function Search() {
  const [q, setQ] = useState('')
  const r = useMemo(() => {
    const t = q.trim().toLowerCase(); if (t.length < 2) return null
    const has = (s: string) => s.toLowerCase().includes(t)
    return {
      units: UNITS.filter(u => has(u.title) || has(u.titleDe ?? '') || u.learn.some(l => has(l.title) || has(l.body))).slice(0, 8),
      concepts: CONCEPTS.filter(c => has(c.name) || has(c.nameEs) || has(c.summary) || c.mistakes.some(has)).slice(0, 8),
      vocab: VOCAB.filter(v => has(v.de) || has(v.es) || has(v.example)).slice(0, 12),
      exercises: EXERCISES.filter(e => e.type !== 'write' && (has(e.prompt) || has(e.explanation) || ('source' in e && has(e.source)) || ('text' in e && has(e.text)) || ('question' in e && has(e.question)))).slice(0, 8),
    }
  }, [q])
  return <div>
    <h1 className="h1 mb-3">Buscar</h1>
    <input autoFocus className="field mb-4" placeholder="Palabra, regla, concepto… (p. ej. «dativo», «Akkusativ», «weil», «Tisch»)" value={q} onChange={e => setQ(e.target.value)} />
    {!r && <p className="text-sm muted">Escribe al menos 2 letras.</p>}
    {r && <div className="space-y-4">
      {r.concepts.length > 0 && <div><p className="text-sm font-semibold mb-1">Gramática</p><ul className="card divide-y divide-line dark:divide-white/10">{r.concepts.map(c => <li key={c.id}><Link to={`/gramatica/${c.id}`} className="block px-4 py-2.5"><p className="font-medium">{c.name} <span className="muted font-normal">· {c.nameEs}</span></p><p className="text-xs muted">{c.summary}</p></Link></li>)}</ul></div>}
      {r.units.length > 0 && <div><p className="text-sm font-semibold mb-1">Unidades</p><ul className="card divide-y divide-line dark:divide-white/10">{r.units.map(u => <li key={u.id}><Link to={`/curso/${u.id}`} className="block px-4 py-2.5 font-medium">{u.number}. {u.title}</Link></li>)}</ul></div>}
      {r.vocab.length > 0 && <div><p className="text-sm font-semibold mb-1">Vocabulario</p><ul className="card divide-y divide-line dark:divide-white/10">{r.vocab.map(v => <li key={v.id} className="px-4 py-2.5"><p className="font-medium">{v.article ? `${v.article} ` : ''}{v.de}{v.plural ? <span className="muted font-normal">, die {v.plural}</span> : ''} <span className="muted font-normal">— {v.es}</span></p><p className="text-xs muted">{v.example}</p></li>)}</ul></div>}
      {r.exercises.length > 0 && <div><p className="text-sm font-semibold mb-1">Ejercicios</p><ul className="card divide-y divide-line dark:divide-white/10">{r.exercises.map(e => <li key={e.id}><Link to={`/practica?concept=${e.concepts[0]}`} className="block px-4 py-2.5 text-sm"><p>{'source' in e ? e.source : 'text' in e ? e.text : 'question' in e ? e.question : e.prompt}</p><p className="text-xs muted">U{UNITS.find(u => u.id === e.unitId)?.number} · {e.prompt}</p></Link></li>)}</ul></div>}
      {!r.concepts.length && !r.units.length && !r.vocab.length && !r.exercises.length && <p className="text-sm muted">Sin resultados.</p>}
    </div>}
  </div>
}
