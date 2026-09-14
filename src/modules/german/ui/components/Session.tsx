import { useEffect, useRef, useState } from 'react'
import type { Exercise } from '@german/content/types'
import { ExerciseRunner, type Outcome } from './ExerciseRunner'
import { useStore } from '@german/store'
import { summarize } from '@german/engine/exam'
import { conceptById } from '@german/content'
import { Link } from 'react-router-dom'
import { Bar } from './ui'

export interface SessionResult { answers: { ex: Exercise; correct: boolean; given: string; expected: string }[]; timeSec: number; score: number }
interface Props { exercises: Exercise[]; title: string; deferred?: boolean; inExam?: boolean; timeLimitSec?: number; onFinish: (r: SessionResult) => void; onExit?: () => void; xpBonus?: number }

export function Session({ exercises, title, deferred, inExam, timeLimitSec, onFinish, onExit, xpBonus }: Props) {
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState<SessionResult['answers']>([])
  const [answered, setAnswered] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const start = useRef(Date.now())
  const store = useStore()
  const finished = useRef(false)

  useEffect(() => { const t = setInterval(() => setElapsed(Math.floor((Date.now() - start.current) / 1000)), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { if (timeLimitSec && elapsed >= timeLimitSec && !finished.current) finish(answers) }, [elapsed])
  useEffect(() => () => { store.addTime(Math.floor((Date.now() - start.current) / 1000)) }, [])

  const ex = exercises[i]
  const onResult = (o: Outcome) => {
    if (answered) { // reintento: solo actualiza
      setAnswers(a => a.map((x, k) => k === i ? { ...x, correct: o.correct, given: o.given } : x)); return
    }
    setAnswered(true)
    store.recordAnswer(ex, o.correct, o.given, o.expected, { inExam })
    setAnswers(a => [...a, { ex, correct: o.correct, given: o.given, expected: o.expected }])
  }
  const next = () => {
    const all = answers
    if (i + 1 >= exercises.length) { finish(all); return }
    setI(i + 1); setAnswered(false)
  }
  function finish(all: SessionResult['answers']) {
    if (finished.current) return; finished.current = true
    const timeSec = Math.floor((Date.now() - start.current) / 1000)
    const score = exercises.length ? Math.round(all.filter(a => a.correct).length / exercises.length * 100) : 0
    if (xpBonus && score >= 70) store.addXp(xpBonus)
    onFinish({ answers: all, timeSec, score })
  }
  if (!ex) return <div className="card p-5">No hay ejercicios disponibles para esta selección.</div>
  const left = timeLimitSec ? Math.max(0, timeLimitSec - elapsed) : null
  return <div>
    <div className="mb-3 flex items-center gap-3 text-sm">
      <button onClick={onExit} className="btn-ghost !px-2 !py-1" aria-label="Salir">✕</button>
      <div className="flex-1"><Bar value={i / exercises.length} /></div>
      <span className="muted tabular-nums">{left != null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}</span>
    </div>
    <p className="mb-2 text-xs muted">{title}</p>
    <ExerciseRunner key={ex.id} ex={ex} index={i} total={exercises.length} deferred={deferred} onResult={onResult} onNext={answered ? next : undefined} />
  </div>
}

export function SessionSummary({ result, onRetakeFailed, onAgain, onExit, label }: { result: SessionResult; onRetakeFailed?: () => void; onAgain?: () => void; onExit?: () => void; label?: string }) {
  const s = useStore()
  const sum = summarize(s, result.answers)
  const ok = result.score >= 70
  return <div className="space-y-4">
    <div className={`card p-6 text-center ${ok ? 'border-good' : 'border-bad'}`}>
      <p className="text-sm muted">{label}</p>
      <p className="my-2 text-5xl font-semibold tabular-nums" style={{ color: ok ? '#1E8A5A' : '#C43D2A' }}>{result.score}%</p>
      <p className="text-sm">{result.answers.filter(a => a.correct).length} de {result.answers.length} correctas · {Math.floor(result.timeSec / 60)} min {result.timeSec % 60} s</p>
    </div>
    {sum.strong.length > 0 && <div className="card p-4"><p className="mb-1 text-sm font-semibold">Puntos fuertes</p><p className="flex flex-wrap gap-1">{sum.strong.map(c => <span key={c} className="pill bg-good-soft text-good">{conceptById(c)?.nameEs ?? c}</span>)}</p></div>}
    {sum.weak.length > 0 && <div className="card p-4"><p className="mb-1 text-sm font-semibold">A reforzar</p><p className="flex flex-wrap gap-1">{sum.weak.map(c => <Link key={c} to={`/gramatica/${c}`} className="pill bg-bad-soft text-bad hover:underline">{conceptById(c)?.nameEs ?? c}</Link>)}</p></div>}
    {sum.recommended.length > 0 && <div className="card p-4"><p className="mb-2 text-sm font-semibold">Recomendación</p><ul className="space-y-1 text-sm">{sum.recommended.map(c => <li key={c.id}>Repasa <Link className="font-medium text-primary underline" to={`/gramatica/${c.id}`}>{c.nameEs}</Link> y luego practica en <Link className="font-medium text-primary underline" to={`/practica?concept=${c.id}`}>modo práctica</Link>.</li>)}</ul></div>}
    <div className="card p-4">
      <p className="mb-2 text-sm font-semibold">Revisión</p>
      <ul className="divide-y divide-line text-sm">{result.answers.map((a, i) => <li key={i} className="py-2"><span className="mr-2">{a.correct ? '🟢' : '🔴'}</span>{a.ex.type === 'translate' ? a.ex.source : a.ex.type === 'gap' ? a.ex.text : a.ex.type === 'mc' ? a.ex.question : a.ex.prompt}{!a.correct && <p className="ml-6 mt-1 muted"><s>{a.given}</s> → <b className="text-ink dark:text-white">{a.expected}</b></p>}</li>)}</ul>
    </div>
    <div className="flex flex-wrap gap-2">
      {sum.failedIds.length > 0 && onRetakeFailed && <button className="btn-primary" onClick={onRetakeFailed}>Repetir las falladas ({sum.failedIds.length})</button>}
      {onAgain && <button className="btn-ghost" onClick={onAgain}>Otra vez</button>}
      {onExit && <button className="btn-ghost" onClick={onExit}>Salir</button>}
    </div>
  </div>
}
