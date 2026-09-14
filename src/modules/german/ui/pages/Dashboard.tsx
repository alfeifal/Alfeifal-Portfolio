import { Link } from 'react-router-dom'
import { useStore } from '@german/store'
import { plan, globalProgress, weakConcepts, continueTarget } from '@german/engine/recommend'
import { Bar, fmtTime } from '../components/ui'
import { dayKey } from '@german/engine/mastery'
import { UNITS, unitById } from '@german/content'

export function Dashboard() {
  const s = useStore()
  const actions = plan(s)
  const g = globalProgress(s)
  const today = s.daily[dayKey()] ?? { sec: 0, ex: 0, correct: 0, xp: 0 }
  const goal = s.settings.dailyGoalMin * 60
  const weak = weakConcepts(s).slice(0, 3)
  const last = s.results.slice(0, 3)
  const pos = s.lastPosition && unitById(s.lastPosition.unitId)
  const hour = new Date().getHours()
  const greet = hour < 13 ? 'Guten Morgen' : hour < 19 ? 'Guten Tag' : 'Guten Abend'
  return <div>
    <p className="text-sm muted">{greet}, Ayoub</p>
    <h1 className="h1 mb-4">Hoy</h1>

    <div className="card p-5 mb-4 border-2 border-ink dark:border-white">
      <div className="mb-3 flex items-center justify-between text-sm"><span className="font-semibold">Plan de hoy · {actions.reduce((a, b) => a + b.minutes, 0)} min</span><span className="muted">🔥 {s.streak} · ✦ {s.xp} XP</span></div>
      <ol className="mb-4 space-y-2">{actions.map((a, i) => <li key={i}><Link to={a.to} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-black/5 dark:hover:bg-white/10"><span className="text-xl">{a.icon}</span><span className="flex-1 min-w-0"><span className="block font-medium leading-tight">{a.title}</span><span className="block text-xs muted">{a.detail}</span></span><span className="text-xs muted tabular-nums">{a.minutes}′</span></Link></li>)}{actions.length === 0 && <li className="text-sm muted">Todo hecho por hoy. Puedes seguir en el curso o hacer un reto.</li>}</ol>
      <Link to={continueTarget(s)} className="btn-primary w-full !py-3.5 !text-base">{pos ? `Continuar · Unidad ${pos.number}` : 'Continuar'}</Link>
      <div className="mt-4"><div className="mb-1 flex justify-between text-xs muted"><span>Objetivo diario</span><span>{fmtTime(today.sec)} / {s.settings.dailyGoalMin} min · {today.ex} ejercicios</span></div><Bar value={goal ? today.sec / goal : 0} color={today.sec >= goal ? '#1E8A5A' : '#2F4BD6'} /></div>
    </div>

    <div className="grid grid-cols-2 gap-3 mb-4">
      <Stat label="Libro" value={`${Math.round(g.book * 100)}%`} sub={`${g.completedUnits}/${UNITS.length} unidades`} bar={g.book} />
      <Stat label="Gramática" value={`${Math.round(g.grammar * 100)}%`} sub="dominio medio" bar={g.grammar} />
      <Stat label="Vocabulario" value={`${g.vocabLearned}`} sub="palabras dominadas" bar={g.vocabLearned / 300} />
      <Stat label="Nivel estimado" value={g.cefr} sub={`${fmtTime(s.totalTimeSec)} de estudio`} />
    </div>

    {weak.length > 0 && <div className="card p-4 mb-4"><p className="mb-2 text-sm font-semibold">Errores frecuentes esta semana</p><ul className="space-y-1.5">{weak.map(w => <li key={w.concept.id} className="flex items-center justify-between text-sm"><Link to={`/gramatica/${w.concept.id}`} className="font-medium hover:underline">{w.concept.nameEs}</Link><Link to={`/practica?concept=${w.concept.id}`} className="pill">{w.n} errores · practicar</Link></li>)}</ul></div>}

    {last.length > 0 && <div className="card p-4"><p className="mb-2 text-sm font-semibold">Últimos resultados</p><ul className="divide-y divide-line dark:divide-white/10">{last.map(r => <li key={r.id} className="flex items-center justify-between py-1.5 text-sm"><span>{r.label}</span><span className="tabular-nums font-semibold" style={{ color: r.score >= 70 ? '#1E8A5A' : '#C43D2A' }}>{r.score}%</span></li>)}</ul><Link to="/estadisticas" className="mt-2 inline-block text-sm text-primary underline">Ver estadísticas</Link></div>}
  </div>
}
function Stat({ label, value, sub, bar }: { label: string; value: string; sub: string; bar?: number }) {
  return <div className="card p-3"><p className="text-xs muted">{label}</p><p className="text-xl font-semibold tabular-nums">{value}</p><p className="text-xs muted mb-1.5">{sub}</p>{bar != null && <Bar value={bar} h={4} />}</div>
}
