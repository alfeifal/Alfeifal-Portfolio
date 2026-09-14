import { useMemo } from 'react'
import { BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts'
import { useStore } from '@german/store'
import { globalProgress, weakConcepts } from '@german/engine/recommend'
import { CONCEPTS, UNITS, VOCAB } from '@german/content'
import { vocabLevel } from '@german/store'
import { fmtTime, Mastery } from '../components/ui'
import { Link } from 'react-router-dom'
import { skillEs } from '../components/ExerciseRunner'
import { EXERCISES } from '@german/content'

export function Stats() {
  const s = useStore(); const g = globalProgress(s)
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10); const st = s.daily[d]; return { d: d.slice(5), min: Math.round((st?.sec ?? 0) / 60), ex: st?.ex ?? 0, acc: st?.ex ? Math.round(st.correct / st.ex * 100) : null } }), [s.daily])
  const results = [...s.results].reverse().slice(-20).map((r, i) => ({ i: i + 1, score: r.score, label: r.label }))
  const bySkill = useMemo(() => { const m: Record<string, { c: number; t: number }> = {}; for (const [id, st] of Object.entries(s.exerciseStats)) { const ex = EXERCISES.find(e => e.id === id); if (!ex) continue; m[ex.skill] = m[ex.skill] ?? { c: 0, t: 0 }; m[ex.skill].c += st.correct; m[ex.skill].t += st.attempts } return Object.entries(m).map(([k, v]) => ({ skill: skillEs(k), acc: Math.round(v.c / v.t * 100), n: v.t })) }, [s.exerciseStats])
  const masteryDist = [0, 1, 2, 3, 4].map(l => ({ l, n: CONCEPTS.filter(c => (s.mastery[c.id]?.level ?? 0) === l).length }))
  const vocabDist = [0, 1, 2, 3, 4].map(l => ({ l, n: VOCAB.filter(v => vocabLevel(s.vocab[v.id]) === l).length }))
  const weak = weakConcepts(s)
  const totalEx = Object.values(s.exerciseStats).reduce((a, b) => a + b.attempts, 0); const totalOk = Object.values(s.exerciseStats).reduce((a, b) => a + b.correct, 0)
  return <div>
    <h1 className="h1 mb-4">Estadísticas</h1>
    <div className="grid grid-cols-2 gap-3 mb-4">
      {[['Tiempo total', fmtTime(s.totalTimeSec)], ['Ejercicios', `${totalEx}`], ['Precisión global', totalEx ? `${Math.round(totalOk / totalEx * 100)}%` : '—'], ['Racha', `${s.streak} (máx. ${s.maxStreak})`], ['XP', `${s.xp}`], ['Nivel estimado', g.cefr]].map(([l, v]) => <div key={l} className="card p-3"><p className="text-xs muted">{l}</p><p className="text-xl font-semibold tabular-nums">{v}</p></div>)}
    </div>
    <div className="card p-4 mb-3"><p className="font-semibold mb-2 text-sm">Minutos por día (14 días)</p><div style={{ height: 160 }}><ResponsiveContainer><BarChart data={days}><XAxis dataKey="d" tick={{ fontSize: 10 }} interval={2} /><YAxis width={28} tick={{ fontSize: 10 }} /><Tooltip /><RBar dataKey="min" fill="#2F4BD6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
    {results.length > 1 && <div className="card p-4 mb-3"><p className="font-semibold mb-2 text-sm">Evolución de exámenes</p><div style={{ height: 160 }}><ResponsiveContainer><LineChart data={results}><CartesianGrid strokeDasharray="3 3" stroke="#E3E4DE" /><XAxis dataKey="i" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} width={28} tick={{ fontSize: 10 }} /><Tooltip formatter={(v) => `${v}%`} labelFormatter={(_, p) => (p?.[0]?.payload?.label ?? '')} /><Line type="monotone" dataKey="score" stroke="#1E8A5A" strokeWidth={2} dot /></LineChart></ResponsiveContainer></div></div>}
    {bySkill.length > 0 && <div className="card p-4 mb-3"><p className="font-semibold mb-2 text-sm">Precisión por habilidad</p><ul className="text-sm space-y-1.5">{bySkill.map(b => <li key={b.skill} className="flex items-center gap-2"><span className="w-24">{b.skill}</span><div className="flex-1 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden"><div className="h-full" style={{ width: `${b.acc}%`, background: b.acc >= 80 ? '#1E8A5A' : b.acc >= 60 ? '#E0961E' : '#C43D2A' }} /></div><span className="w-16 text-right tabular-nums">{b.acc}% <span className="muted text-xs">({b.n})</span></span></li>)}</ul></div>}
    <div className="card p-4 mb-3"><p className="font-semibold mb-2 text-sm">Dominio de conceptos ({CONCEPTS.length})</p><Dist d={masteryDist} /><p className="font-semibold mt-4 mb-2 text-sm">Vocabulario ({VOCAB.length})</p><Dist d={vocabDist} /></div>
    <div className="card p-4 mb-3"><p className="font-semibold mb-2 text-sm">Por unidad</p><ul className="text-sm space-y-1">{UNITS.filter(u => s.lessons[u.id]).map(u => <li key={u.id} className="flex items-center justify-between"><Link to={`/curso/${u.id}`} className="hover:underline truncate">{u.number}. {u.title}</Link><span className="muted tabular-nums">{s.lessons[u.id].testBest ? `test ${s.lessons[u.id].testBest}%` : `${s.lessons[u.id].sectionsDone.length}/5 secciones`}</span></li>)}</ul></div>
    {weak.length > 0 && <div className="card p-4"><p className="font-semibold mb-2 text-sm">Conceptos que más fallas</p><ul className="text-sm space-y-1">{weak.map(w => <li key={w.concept.id} className="flex items-center justify-between"><Link to={`/gramatica/${w.concept.id}`} className="hover:underline">{w.concept.nameEs}</Link><span className="flex items-center gap-2"><Mastery level={s.mastery[w.concept.id]?.level ?? 0} small /><span className="muted">{w.n} errores</span></span></li>)}</ul></div>}
  </div>
}
function Dist({ d }: { d: { l: number; n: number }[] }) {
  const total = d.reduce((a, b) => a + b.n, 0) || 1; const C = ['#C43D2A', '#E0961E', '#C9A800', '#1E8A5A', '#2F4BD6']; const L = ['No aprendido', 'En progreso', 'Familiarizado', 'Dominado', 'Mastered']
  return <div><div className="flex h-3 rounded-full overflow-hidden gap-0.5">{d.map(x => x.n ? <div key={x.l} style={{ flex: x.n, background: C[x.l] }} /> : null)}</div><p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs muted">{d.map(x => <span key={x.l}><span className="inline-block h-2 w-2 rounded-full mr-1" style={{ background: C[x.l] }} />{L[x.l]} {x.n} ({Math.round(x.n / total * 100)}%)</span>)}</p></div>
}
