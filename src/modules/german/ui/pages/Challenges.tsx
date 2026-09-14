import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { UNITS, BLOCKS, CONCEPTS, EXERCISES } from '@german/content'
import type { Skill, Exercise } from '@german/content/types'
import { useStore, isUnlocked } from '@german/store'
import { generateExam, studiedUnits, type ExamConfig } from '@german/engine/exam'
import { Session, SessionSummary, type SessionResult } from '../components/Session'
import { dayKey } from '@german/engine/mastery'

type Mode = { id: string; title: string; detail: string; icon: string; cfg: (s: ReturnType<typeof useStore.getState>) => ExamConfig | null; timed?: number; deferred?: boolean; locked?: (s: ReturnType<typeof useStore.getState>) => string | null; xp: number }

const ALL: Skill[] = ['grammar', 'vocab', 'translation', 'reading']
const MODES: Mode[] = [
  { id: 'cumulative', title: 'Examen acumulativo', detail: 'Todo lo estudiado hasta ahora, 15 preguntas', icon: '📚', xp: 100, cfg: s => ({ skills: ALL, units: studiedUnits(s), difficulty: 'normal', count: 15, mode: 'cumulative', includeMixed: true }) },
  { id: 'adaptive', title: 'Examen adaptativo', detail: 'Se ajusta a tu nivel y a tus puntos débiles', icon: '🧠', xp: 120, cfg: s => ({ skills: ALL, units: studiedUnits(s), difficulty: 'adaptive', count: 12, mode: 'adaptive', includeMixed: true }) },
  { id: 'mixed', title: 'Mixed Challenge', detail: 'Solo ejercicios que combinan varias unidades', icon: '🔀', xp: 150, cfg: s => ({ skills: ALL, units: studiedUnits(s), difficulty: 'normal', count: 10, mode: 'mixed', includeMixed: true }), locked: s => studiedUnits(s).length < 5 ? 'Disponible a partir de la Unidad 5' : null },
  { id: 'mock', title: 'Mock Exam', detail: '20 preguntas · 20 minutos · corrección al final', icon: '⏱️', xp: 200, timed: 20 * 60, deferred: true, cfg: s => ({ skills: ALL, units: studiedUnits(s), difficulty: 'normal', count: 20, mode: 'mock', includeMixed: true }) },
  { id: 'global', title: 'Examen global', detail: 'Las 28 unidades, sin filtros', icon: '🌍', xp: 250, deferred: true, cfg: () => ({ skills: ALL, units: UNITS.map(u => u.id), difficulty: 'hard', count: 25, mode: 'global', includeMixed: true }), locked: s => studiedUnits(s).length < UNITS.length ? 'Se desbloquea al llegar a la Unidad 28' : null },
]

export function Challenges() {
  const s = useStore()
  const [active, setActive] = useState<{ title: string; exs: Exercise[]; timed?: number; deferred?: boolean; xp: number; mode: string } | null>(null)
  const [result, setResult] = useState<SessionResult | null>(null); const [run, setRun] = useState(0)
  const [gen, setGen] = useState(false)
  const [g, setG] = useState<{ skills: Skill[]; units: string[]; difficulty: ExamConfig['difficulty']; count: number; timed: boolean; deferred: boolean }>({ skills: ALL, units: studiedUnits(s), difficulty: 'normal', count: 15, timed: false, deferred: true })
  const bosses = Object.entries(BLOCKS).map(([k, b]) => ({ k, b, done: b.units.every(id => (s.lessons[id]?.testBest ?? 0) >= 70), best: s.results.filter(r => r.mode === 'boss-' + k).sort((a, b2) => b2.score - a.score)[0]?.score }))
  const start = (title: string, cfg: ExamConfig, opts: { timed?: number; deferred?: boolean; xp: number; mode: string }) => { const exs = generateExam(s, cfg); setActive({ title, exs, ...opts }); setResult(null); setRun(r => r + 1) }
  const finish = (r: SessionResult) => { if (!active) return; setResult(r); s.addResult({ mode: active.mode, label: active.title, score: r.score, correct: r.answers.filter(a => a.correct).length, total: r.answers.length, timeSec: r.timeSec, byConcept: {}, failedIds: r.answers.filter(a => !a.correct).map(a => a.ex.id) }) }
  const lastFailed = s.results.find(r => r.failedIds.length)
  const toggle = <T,>(arr: T[], v: T) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]

  if (active && !result) return <Session key={run} exercises={active.exs} title={active.title} timeLimitSec={active.timed} deferred={active.deferred} inExam xpBonus={active.xp} onFinish={finish} onExit={() => setActive(null)} />
  if (active && result) return <SessionSummary result={result} label={active.title} onRetakeFailed={() => { const ids = result.answers.filter(a => !a.correct).map(a => a.ex.id); setActive({ ...active, title: 'Retake · falladas', exs: EXERCISES.filter(e => ids.includes(e.id)), timed: undefined, deferred: false, mode: 'retake' }); setResult(null); setRun(r => r + 1) }} onAgain={() => { setRun(r => r + 1); setResult(null) }} onExit={() => setActive(null)} />

  return <div>
    <h1 className="h1 mb-1">Retos y exámenes</h1><p className="text-sm muted mb-4">Sin pistas ni soluciones durante el examen. A partir del 70 % ganas XP extra.</p>
    <Link to="/retos/daily" className="card p-4 mb-3 flex items-center gap-3 border-2 border-warm"><span className="text-2xl">🔥</span><div className="flex-1"><p className="font-semibold">Daily Challenge</p><p className="text-xs muted">10 preguntas de hoy{s.dailyChallenge?.date === dayKey() && s.dailyChallenge.done ? ` · hecho: ${s.dailyChallenge.score}%` : ''}</p></div><span>›</span></Link>
    <div className="grid gap-2 mb-4">{MODES.map(m => { const lock = m.locked?.(s); return <button key={m.id} disabled={!!lock} onClick={() => { const cfg = m.cfg(s); if (cfg) start(m.title, cfg, { timed: m.timed, deferred: m.deferred, xp: m.xp, mode: m.id }) }} className="card p-4 flex items-center gap-3 text-left disabled:opacity-50"><span className="text-2xl">{m.icon}</span><div className="flex-1"><p className="font-semibold">{m.title}</p><p className="text-xs muted">{lock ?? m.detail}</p></div><span className="text-xs muted">+{m.xp} XP</span></button> })}</div>

    <h2 className="h2 mb-2">Boss Exams</h2>
    <div className="grid gap-2 mb-4">{bosses.map(({ k, b, done, best }) => <button key={k} disabled={!done} onClick={() => start(`Boss · Bloque ${k}`, { skills: ALL, units: b.units, difficulty: 'hard', count: 15, mode: 'boss', includeMixed: true }, { deferred: true, timed: 15 * 60, xp: 300, mode: 'boss-' + k })} className="card p-4 flex items-center gap-3 text-left disabled:opacity-50"><span className="text-2xl">👑</span><div className="flex-1"><p className="font-semibold">Bloque {k} · {b.title}</p><p className="text-xs muted">{done ? `15 preguntas difíciles · 15 min${best != null ? ` · mejor ${best}%` : ''}` : 'Completa todas las unidades del bloque'}</p></div></button>)}</div>

    <h2 className="h2 mb-2">Generar examen</h2>
    {!gen ? <button className="card p-4 w-full text-left mb-4" onClick={() => setGen(true)}><p className="font-semibold">⚙️ GENERATE EXAM</p><p className="text-xs muted">Elige habilidades, unidades, dificultad, número de preguntas y tiempo.</p></button> : <div className="card p-4 mb-4 space-y-3 text-sm">
      <div><p className="font-semibold mb-1">Habilidades</p><div className="flex flex-wrap gap-1.5">{(['grammar', 'vocab', 'translation', 'reading', 'writing'] as Skill[]).map(k => <button key={k} className={`tab border border-line ${g.skills.includes(k) ? 'tab-active' : ''}`} onClick={() => setG({ ...g, skills: toggle(g.skills, k) })}>{({ grammar: 'Gramática', vocab: 'Vocabulario', translation: 'Traducción', reading: 'Lectura', writing: 'Escritura' })[k]}</button>)}</div></div>
      <div><div className="flex justify-between mb-1"><p className="font-semibold">Unidades</p><span className="text-xs"><button className="underline mr-2" onClick={() => setG({ ...g, units: studiedUnits(s) })}>estudiadas</button><button className="underline" onClick={() => setG({ ...g, units: UNITS.map(u => u.id) })}>todas</button></span></div><div className="flex flex-wrap gap-1.5">{UNITS.map(u => <button key={u.id} className={`tab border border-line !px-2.5 ${g.units.includes(u.id) ? 'tab-active' : ''} ${!isUnlocked(s, u.id) ? 'opacity-50' : ''}`} onClick={() => setG({ ...g, units: toggle(g.units, u.id) })}>{u.number}</button>)}</div></div>
      <div className="grid grid-cols-2 gap-3"><label>Dificultad<select className="field mt-1 !py-2" value={g.difficulty} onChange={e => setG({ ...g, difficulty: e.target.value as ExamConfig['difficulty'] })}><option value="easy">Fácil</option><option value="normal">Normal</option><option value="hard">Difícil</option><option value="adaptive">Adaptativa</option></select></label><label>Preguntas<select className="field mt-1 !py-2" value={g.count} onChange={e => setG({ ...g, count: Number(e.target.value) })}>{[10, 15, 20, 30, 40].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={g.timed} onChange={e => setG({ ...g, timed: e.target.checked })} /> Con tiempo (1 min por pregunta)</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={g.deferred} onChange={e => setG({ ...g, deferred: e.target.checked })} /> Corrección al final (modo examen)</label>
      <div className="flex gap-2"><button className="btn-primary" disabled={!g.skills.length || !g.units.length} onClick={() => start('Examen personalizado', { skills: g.skills, units: g.units, difficulty: g.difficulty, count: g.count, mode: 'practice', includeMixed: true }, { timed: g.timed ? g.count * 60 : undefined, deferred: g.deferred, xp: 100, mode: 'custom' })}>Generar y empezar</button><button className="btn-ghost" onClick={() => setGen(false)}>Cancelar</button></div>
    </div>}

    {lastFailed && <button className="card p-4 w-full text-left mb-4" onClick={() => setActive({ title: `Retake · ${lastFailed.label}`, exs: EXERCISES.filter(e => lastFailed.failedIds.includes(e.id)), xp: 50, mode: 'retake' })}><p className="font-semibold">🔁 Retake failed</p><p className="text-xs muted">Repetir las {lastFailed.failedIds.length} preguntas falladas de «{lastFailed.label}»</p></button>}

    {s.results.length > 0 && <><h2 className="h2 mb-2">Historial</h2><ul className="card divide-y divide-line dark:divide-white/10 text-sm">{s.results.slice(0, 15).map(r => <li key={r.id} className="flex items-center justify-between px-4 py-2"><span>{r.label}<span className="muted text-xs"> · {new Date(r.at).toLocaleDateString('es')}</span></span><span className="font-semibold tabular-nums" style={{ color: r.score >= 70 ? '#1E8A5A' : '#C43D2A' }}>{r.score}%</span></li>)}</ul></>}
  </div>
}

export function Daily() {
  const s = useStore(); const today = dayKey()
  const dc = s.dailyChallenge?.date === today ? s.dailyChallenge : null
  const seed = useMemo(() => Number(today.replace(/-/g, '')), [today])
  const exs = useMemo(() => { if (dc) return EXERCISES.filter(e => dc.ids.includes(e.id)); const list = generateExam(s, { skills: ALL, units: studiedUnits(s), difficulty: 'normal', count: 10, mode: 'daily', includeMixed: true, seed }); s.setDailyChallenge({ date: today, ids: list.map(e => e.id), done: false, score: 0 }); return list }, [])
  const [result, setResult] = useState<SessionResult | null>(null)
  if (dc?.done && !result) return <div className="card p-6 text-center"><p className="text-sm muted">Daily Challenge · {today}</p><p className="my-2 text-4xl font-semibold" style={{ color: dc.score >= 70 ? '#1E8A5A' : '#C43D2A' }}>{dc.score}%</p><p className="text-sm muted mb-3">Ya lo has hecho hoy. Mañana habrá uno nuevo.</p><Link to="/retos" className="btn-ghost">Volver a Retos</Link></div>
  if (result) return <SessionSummary result={result} label="Daily Challenge" onExit={() => { }} />
  return <div><h1 className="h1 mb-1">Daily Challenge</h1><p className="text-sm muted mb-3">10 preguntas mezcladas de lo que has estudiado, ponderadas hacia tus puntos débiles. +75 XP si superas el 70 %.</p>
    <Session exercises={exs} title={`Daily · ${today}`} inExam xpBonus={75} onFinish={r => { setResult(r); s.setDailyChallenge({ date: today, ids: exs.map(e => e.id), done: true, score: r.score }); s.addResult({ mode: 'daily', label: 'Daily Challenge', score: r.score, correct: r.answers.filter(a => a.correct).length, total: r.answers.length, timeSec: r.timeSec, byConcept: {}, failedIds: r.answers.filter(a => !a.correct).map(a => a.ex.id) }) }} /></div>
}
void CONCEPTS
