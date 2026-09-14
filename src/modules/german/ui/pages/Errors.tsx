import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '@german/store'
import { conceptById, exerciseById } from '@german/content'
import { useState } from 'react'

export function Errors() {
  const s = useStore(); const nav = useNavigate(); const [showResolved, setShowResolved] = useState(false)
  const errs = s.errors.filter(e => showResolved || !e.resolved)
  const groups: Record<string, typeof errs> = {}
  for (const e of errs) { const k = e.concepts[0] ?? 'otros'; (groups[k] = groups[k] ?? []).push(e) }
  const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length)
  return <div>
    <h1 className="h1 mb-1">Mis errores</h1><p className="text-sm muted mb-3">{s.errors.filter(e => !e.resolved).length} pendientes, agrupados por concepto. Márcalos como resueltos cuando los domines.</p>
    <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Mostrar resueltos</label>
    {keys.length === 0 && <div className="card p-5 text-sm muted">Sin errores registrados. Cuando falles algo, aparecerá aquí con su explicación.</div>}
    {keys.map(k => { const c = conceptById(k); return <div key={k} className="card p-4 mb-3">
      <div className="mb-2 flex items-center justify-between"><Link to={c ? `/gramatica/${c.id}` : '#'} className="font-semibold hover:underline">{c?.nameEs ?? k} <span className="muted font-normal text-sm">· {groups[k].length}</span></Link>{c && <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => nav(`/practica?concept=${c.id}`)}>Practicar</button>}</div>
      <ul className="divide-y divide-line dark:divide-white/10 text-sm">{groups[k].map(e => { const ex = exerciseById(e.exerciseId); return <li key={e.id} className={`py-2 ${e.resolved ? 'opacity-50' : ''}`}><p className="text-xs muted">{ex?.type === 'translate' ? ex.source : ex?.type === 'gap' ? ex.text : ex?.prompt} · {new Date(e.at).toLocaleDateString('es')}</p><p><s className="opacity-60">{e.given}</s> → <b>{e.expected}</b></p>{ex && <p className="text-xs muted">{ex.explanation}</p>}{!e.resolved && <button className="mt-1 text-xs text-primary underline" onClick={() => s.resolveError(e.id)}>Marcar como resuelto</button>}</li> })}</ul>
    </div> })}
  </div>
}
