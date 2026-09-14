import { Link } from 'react-router-dom'
import { UNITS, BLOCKS } from '@german/content'
import { useStore, unitStatus } from '@german/store'
import { unitSkillProgress } from '@german/engine/recommend'
import { Bar } from '../components/ui'

export function Course() {
  const s = useStore()
  return <div>
    <h1 className="h1 mb-1">Curso</h1>
    <p className="mb-5 text-sm muted">28 unidades en 4 bloques. Cada unidad se desbloquea al superar el test de la anterior con un 70 %.</p>
    {Object.entries(BLOCKS).map(([k, b]) => <section key={k} className="mb-6">
      <div className="mb-2 flex items-baseline justify-between"><h2 className="h2">Bloque {k} · {b.title}</h2><span className="pill">{b.cefr}</span></div>
      <div className="grid gap-2">{UNITS.filter(u => u.block === k).map(u => {
        const st = unitStatus(s, u.id); const p = unitSkillProgress(s, u.id); const l = s.lessons[u.id]
        const inner = <div className={`card p-3.5 ${st === 'locked' ? 'opacity-50' : ''}`}>
          <div className="flex items-center gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${st === 'done' ? 'bg-good text-white' : st === 'started' ? 'bg-primary text-white' : st === 'locked' ? 'bg-black/10 dark:bg-white/10' : 'border border-line'}`}>{st === 'locked' ? '🔒' : st === 'done' ? '✓' : u.number}</span>
            <div className="min-w-0 flex-1"><p className="font-medium leading-tight truncate">{u.number}. {u.title}</p><p className="text-xs muted">{u.titleDe ? `${u.titleDe} · ` : ''}{u.cefr} · pág. {u.page}{l?.testBest ? ` · test ${l.testBest}%` : ''}</p></div>
          </div>
          {st !== 'locked' && <div className="mt-2.5 grid grid-cols-3 gap-2 text-[10px] muted"><div>Gramática<Bar value={p.grammar} h={4} /></div><div>Vocabulario<Bar value={p.vocab} h={4} color="#1E8A5A" /></div><div>Test<Bar value={p.test} h={4} color="#E0961E" /></div></div>}
        </div>
        return st === 'locked' ? <div key={u.id}>{inner}</div> : <Link key={u.id} to={`/curso/${u.id}`}>{inner}</Link>
      })}</div>
    </section>)}
  </div>
}
