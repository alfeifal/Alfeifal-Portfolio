import React, { useEffect, useMemo, useState } from 'react'
import type { Exercise } from '@german/content/types'
import { gradeText, gradeGaps, gradeOrder, gradeIndices } from '@german/engine/grade'
import { Stars, Origin } from './ui'
import { conceptById } from '@german/content'
import { Link } from 'react-router-dom'
import { useStore } from '@german/store'
import { evaluateWriting } from '@german/tutor/client'
import { Speak } from './Speak'

export interface Outcome { correct: boolean; given: string; expected: string; almost?: string }
interface Props { ex: Exercise; onResult: (o: Outcome) => void; onNext?: () => void; deferred?: boolean /* examen: sin feedback hasta el final */; index?: number; total?: number; autoFocus?: boolean }

const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } return b }

export function ExerciseRunner({ ex, onResult, onNext, deferred, index, total, autoFocus = true }: Props) {
  const [text, setText] = useState('')
  const [gaps, setGaps] = useState<string[]>([])
  const [choice, setChoice] = useState<number | null>(null)
  const [orderSel, setOrderSel] = useState<number[]>([])
  const [matchSel, setMatchSel] = useState<(number | null)[]>([])
  const [classSel, setClassSel] = useState<(number | null)[]>([])
  const [readSel, setReadSel] = useState<(number | null)[]>([])
  const [hint, setHint] = useState(false)
  const [solution, setSolution] = useState(false)
  const [tries, setTries] = useState(0)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [aiEval, setAiEval] = useState<{ score: number; corrected: string; errors: { wrong: string; right: string; explanation: string }[]; feedback: string; natural: string } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const store = useStore()

  const orderWords = useMemo(() => ex.type === 'order' ? shuffle(ex.words.map((w, i) => ({ w, i }))) : [], [ex.id])
  const matchRight = useMemo(() => ex.type === 'match' ? shuffle(ex.pairs.map((p, i) => ({ t: p[1], i }))) : [], [ex.id])

  useEffect(() => { setText(''); setGaps([]); setChoice(null); setOrderSel([]); setMatchSel([]); setClassSel([]); setReadSel([]); setHint(false); setSolution(false); setTries(0); setOutcome(null); setAiEval(null) }, [ex.id])

  const canCheck = (() => {
    switch (ex.type) {
      case 'mc': return choice !== null
      case 'gap': return ex.answers.every((_, i) => (gaps[i] ?? '').trim() !== '')
      case 'translate': return text.trim() !== ''
      case 'order': return orderSel.length === ex.words.length
      case 'match': return ex.pairs.every((_, i) => matchSel[i] != null)
      case 'classify': return ex.items.every((_, i) => classSel[i] != null)
      case 'reading': return ex.questions.every((_, i) => readSel[i] != null)
      case 'write': return text.trim().length > 10
    }
  })()

  function check() {
    let o: Outcome
    switch (ex.type) {
      case 'mc': o = { correct: choice === ex.answer, given: ex.options[choice ?? 0], expected: ex.options[ex.answer] }; break
      case 'gap': { const g = gradeGaps(gaps, ex.answers); o = { correct: g.correct, given: gaps.join(' / '), expected: ex.answers.map(a => a[0]).join(' / '), almost: g.perGap.find(p => p.almost)?.almost }; break }
      case 'translate': { const g = gradeText(text, ex.answers); o = { correct: g.correct, given: text, expected: g.expected, almost: g.almost }; break }
      case 'order': { const g = gradeOrder(orderSel.map(i => ex.words[i]), ex.answers); o = { correct: g.correct, given: g.given, expected: g.expected }; break }
      case 'match': { const g = gradeIndices(matchSel, ex.pairs.map((_, i) => i)); o = { correct: g.correct, given: `${g.per.filter(Boolean).length}/${ex.pairs.length} parejas`, expected: ex.pairs.map(p => `${p[0]} → ${p[1]}`).join(', ') }; break }
      case 'classify': { const g = gradeIndices(classSel, ex.items.map(i => i[1])); o = { correct: g.correct, given: `${g.per.filter(Boolean).length}/${ex.items.length}`, expected: ex.items.map(i => `${i[0]} → ${ex.categories[i[1]]}`).join(', ') }; break }
      case 'reading': { const g = gradeIndices(readSel, ex.questions.map(q => q.answer)); o = { correct: g.correct, given: `${g.per.filter(Boolean).length}/${ex.questions.length}`, expected: ex.questions.map(q => q.options[q.answer]).join(' · ') }; break }
      case 'write': { o = { correct: true, given: text, expected: '' }; break }
    }
    setTries(t => t + 1); setOutcome(o); onResult(o)
  }
  async function evalWrite() {
    if (ex.type !== 'write') return
    
    setAiBusy(true)
    try { const r = await evaluateWriting(store.settings.apiKey, store, ex.task, ex.rubric, text); setAiEval(r); const o = { correct: r.score >= 70, given: text, expected: r.corrected }; setOutcome(o); setTries(1); onResult(o) }
    catch (e) { setAiEval({ score: 0, corrected: '', errors: [], feedback: `Error del tutor: ${(e as Error).message}`, natural: '' }) }
    finally { setAiBusy(false) }
  }
  const retry = () => { setOutcome(null); if (ex.type === 'gap') setGaps([]); if (ex.type === 'translate') setText(''); if (ex.type === 'order') setOrderSel([]); if (ex.type === 'mc') setChoice(null) }
  const showFeedback = outcome && !deferred
  const concepts = ex.concepts.map(conceptById).filter(Boolean)

  return (
    <div className="card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs muted">
        {index != null && total != null && <span className="font-semibold text-ink dark:text-white">{index + 1} / {total}</span>}
        <Stars n={ex.difficulty} /><span className="pill">{skillEs(ex.skill)}</span><Origin o={ex.origin} />{ex.mixed && <span className="pill">Mixed</span>}
      </div>
      <p className="mb-3 text-sm font-medium">{ex.prompt}</p>

      {ex.type === 'mc' && <div>
        {ex.question.trim() && <p className="mb-3 text-lg">{ex.question}</p>}
        <div className="grid gap-2">{ex.options.map((o, i) => <button key={i} disabled={!!outcome} onClick={() => setChoice(i)} className={`rounded-xl border px-4 py-3 text-left text-[16px] ${choice === i ? 'border-primary bg-primary-soft dark:bg-primary/20 dark:text-white' : 'border-line hover:bg-black/5'} ${showFeedback && i === ex.answer ? '!border-good !bg-good-soft dark:!bg-good/20' : ''} ${showFeedback && choice === i && i !== ex.answer ? '!border-bad !bg-bad-soft dark:!bg-bad/20' : ''}`}>{o}</button>)}</div>
      </div>}

      {ex.type === 'gap' && <div className="text-lg leading-loose">{ex.text.split('___').map((part, i, arr) => <React.Fragment key={i}>{part}{i < arr.length - 1 && <input autoFocus={autoFocus && i === 0} disabled={!!outcome} value={gaps[i] ?? ''} onChange={e => { const g = [...gaps]; g[i] = e.target.value; setGaps(g) }} onKeyDown={e => { if (e.key === 'Enter' && canCheck && !outcome) check() }} className={`mx-1 inline-block w-28 rounded-lg border-b-2 bg-transparent px-2 text-center text-[16px] outline-none ${showFeedback ? (gradeText(gaps[i] ?? '', ex.answers[i]).correct ? 'border-good text-good' : 'border-bad text-bad') : 'border-primary'}`} autoCapitalize="off" autoCorrect="off" spellCheck={false} />}</React.Fragment>)}</div>}

      {(ex.type === 'translate' || ex.type === 'write') && <div>
        <p className="mb-3 text-lg">{ex.type === 'translate' ? ex.source : ex.task}{ex.type === 'translate' && ex.direction !== 'es-de' && <Speak text={ex.source} />}</p>
        {ex.type === 'write' && <ul className="mb-3 ml-4 list-disc text-sm muted">{ex.rubric.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        <textarea autoFocus={autoFocus} disabled={!!outcome} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && ex.type === 'translate' && canCheck && !outcome) { e.preventDefault(); check() } }} rows={ex.type === 'write' ? 6 : 2} className="field" placeholder={ex.type === 'write' ? 'Escribe aquí en alemán…' : 'Escribe en alemán…'} autoCapitalize="sentences" autoCorrect="off" spellCheck={false} />
        <Umlauts onInsert={c => setText(t => t + c)} disabled={!!outcome} />
      </div>}

      {ex.type === 'order' && <div>
        <div className="mb-3 min-h-[52px] rounded-xl border border-dashed border-line p-2 flex flex-wrap gap-2">{orderSel.length === 0 && <span className="text-sm muted px-1">Toca las palabras en orden</span>}{orderSel.map((wi, k) => <button key={k} disabled={!!outcome} onClick={() => setOrderSel(orderSel.filter((_, j) => j !== k))} className="rounded-lg bg-ink px-3 py-1.5 text-[16px] text-white dark:bg-white dark:text-ink">{ex.words[wi]}</button>)}</div>
        <div className="flex flex-wrap gap-2">{orderWords.map(({ w, i }) => <button key={i} disabled={!!outcome || orderSel.includes(i)} onClick={() => setOrderSel([...orderSel, i])} className="rounded-lg border border-line px-3 py-1.5 text-[16px] disabled:opacity-30">{w}</button>)}</div>
      </div>}

      {ex.type === 'match' && <div className="grid gap-2">{ex.pairs.map((p, i) => <div key={i} className="flex items-center gap-2"><span className="flex-1 rounded-lg bg-paper dark:bg-white/5 px-3 py-2 text-[16px]">{p[0]}</span><select disabled={!!outcome} value={matchSel[i] ?? ''} onChange={e => { const m = [...matchSel]; m[i] = e.target.value === '' ? null : Number(e.target.value); setMatchSel(m) }} className={`field flex-1 ${showFeedback ? (matchSel[i] === i ? 'border-good' : 'border-bad') : ''}`}><option value="">—</option>{matchRight.map(r => <option key={r.i} value={r.i}>{r.t}</option>)}</select></div>)}</div>}

      {ex.type === 'classify' && <div className="grid gap-3">{ex.items.map((it, i) => <div key={i}><p className="mb-1 text-[16px]"><Inline s={it[0]} /></p><div className="flex flex-wrap gap-1.5">{ex.categories.map((c, ci) => <button key={ci} disabled={!!outcome} onClick={() => { const m = [...classSel]; m[i] = ci; setClassSel(m) }} className={`rounded-full border px-3 py-1 text-sm ${classSel[i] === ci ? 'border-primary bg-primary-soft dark:bg-primary/20 dark:text-white' : 'border-line'} ${showFeedback && ci === it[1] ? '!border-good !bg-good-soft dark:!bg-good/20' : ''} ${showFeedback && classSel[i] === ci && ci !== it[1] ? '!border-bad !bg-bad-soft dark:!bg-bad/20' : ''}`}>{c}</button>)}</div></div>)}</div>}

      {ex.type === 'reading' && <div>
        <div className="mb-4 rounded-xl bg-paper dark:bg-white/5 p-4 text-[16px] leading-relaxed">{ex.passage}<div className="mt-2"><Speak text={ex.passage} /><Speak text={ex.passage} slow /></div></div>
        <div className="grid gap-4">{ex.questions.map((q, qi) => <div key={qi}><p className="mb-2 font-medium">{q.q}</p><div className="grid gap-1.5">{q.options.map((o, oi) => <button key={oi} disabled={!!outcome} onClick={() => { const r = [...readSel]; r[qi] = oi; setReadSel(r) }} className={`rounded-lg border px-3 py-2 text-left text-sm ${readSel[qi] === oi ? 'border-primary bg-primary-soft dark:bg-primary/20 dark:text-white' : 'border-line'} ${showFeedback && oi === q.answer ? '!border-good !bg-good-soft dark:!bg-good/20' : ''} ${showFeedback && readSel[qi] === oi && oi !== q.answer ? '!border-bad !bg-bad-soft dark:!bg-bad/20' : ''}`}>{o}</button>)}</div></div>)}</div>
      </div>}

      {hint && ex.hint && <p className="mt-3 rounded-lg bg-warm-soft dark:bg-warm/20 px-3 py-2 text-sm">💡 {ex.hint}</p>}
      {solution && !outcome && ex.type !== 'write' && <p className="mt-3 rounded-lg bg-paper dark:bg-white/5 px-3 py-2 text-sm">Solución: <b>{solutionText(ex)}</b></p>}

      {!outcome && <div className="mt-4 flex flex-wrap gap-2">
        {ex.type === 'write' ? <button className="btn-primary" disabled={!canCheck || aiBusy} onClick={evalWrite}>{aiBusy ? 'Corrigiendo…' : 'Enviar al tutor'}</button> : <button className="btn-primary" disabled={!canCheck} onClick={check}>Comprobar</button>}
        {ex.hint && !hint && <button className="btn-ghost" onClick={() => setHint(true)}>Ver pista</button>}
        {!deferred && ex.type !== 'write' && tries > 0 && !solution && <button className="btn-ghost" onClick={() => setSolution(true)}>Ver solución</button>}
        {!deferred && ex.type !== 'write' && tries === 0 && !solution && <button className="btn-ghost opacity-60" title="Inténtalo una vez primero" onClick={() => setSolution(true)}>Ver solución</button>}
      </div>}

      {aiEval && <div className="mt-4 rounded-xl border border-line p-3 text-sm space-y-2">
        {aiEval.corrected && <><p><b>Puntuación: {aiEval.score}/100</b></p><p className="muted">Texto corregido:</p><p className="rounded-lg bg-good-soft dark:bg-good/20 p-2">{aiEval.corrected}</p></>}
        {aiEval.errors?.length > 0 && <ul className="ml-4 list-disc">{aiEval.errors.map((e, i) => <li key={i}><s className="opacity-60">{e.wrong}</s> → <b>{e.right}</b> — {e.explanation}</li>)}</ul>}
        <p>{aiEval.feedback}</p>{aiEval.natural && <p className="muted">{aiEval.natural}</p>}
      </div>}

      {showFeedback && ex.type !== 'write' && <div className={`mt-4 rounded-xl p-3 text-sm ${outcome.correct ? 'bg-good-soft dark:bg-good/20' : 'bg-bad-soft dark:bg-bad/20'}`}>
        <p className="font-semibold">{outcome.correct ? '🟢 Correcto' : '🔴 Incorrecto'}{outcome.almost && <span className="ml-2 font-normal">{outcome.almost}</span>}</p>
        {!outcome.correct && <p className="mt-1">Tu respuesta: <s className="opacity-70">{outcome.given}</s><br />Correcto: <b>{outcome.expected}</b> {(ex.type === 'translate' || ex.type === 'order' || ex.type === 'mc') && <Speak text={outcome.expected} />}</p>}
        {outcome.correct && (ex.type === 'translate' || ex.type === 'order') && <p className="mt-1 flex items-center gap-1"><Speak text={outcome.expected} /><span className="muted text-xs">escuchar</span></p>}
        <p className="mt-2">{ex.explanation}</p>
        {concepts.length > 0 && <p className="mt-2 flex flex-wrap gap-1">{concepts.map(c => <Link key={c!.id} to={`/gramatica/${c!.id}`} className="pill hover:underline">{c!.nameEs}</Link>)}</p>}
      </div>}

      {outcome && (!deferred || true) && <div className="mt-4 flex gap-2">
        {!deferred && !outcome.correct && ex.type !== 'write' && <button className="btn-ghost" onClick={retry}>Reintentar</button>}
        {onNext && <button className="btn-primary ml-auto" autoFocus onClick={onNext}>Siguiente</button>}
      </div>}
    </div>
  )
}

function Inline({ s }: { s: string }) { const parts = s.split(/(\*\*[^*]+\*\*)/); return <>{parts.map((p, i) => p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p)}</> }
export function Umlauts({ onInsert, disabled }: { onInsert: (c: string) => void; disabled?: boolean }) {
  return <div className="mt-2 flex gap-1.5">{['ä', 'ö', 'ü', 'ß', 'Ä', 'Ö', 'Ü'].map(c => <button key={c} type="button" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => onInsert(c)} className="rounded-md border border-line px-2.5 py-1 text-sm">{c}</button>)}</div>
}
export function solutionText(ex: Exercise): string {
  switch (ex.type) {
    case 'mc': return ex.options[ex.answer]
    case 'gap': return ex.answers.map(a => a[0]).join(' / ')
    case 'translate': return ex.answers[0]
    case 'order': return ex.answers[0]
    case 'match': return ex.pairs.map(p => `${p[0]} → ${p[1]}`).join('; ')
    case 'classify': return ex.items.map(i => `${i[0].replace(/\*\*/g, '')} → ${ex.categories[i[1]]}`).join('; ')
    case 'reading': return ex.questions.map(q => q.options[q.answer]).join(' · ')
    case 'write': return ''
  }
}
export const skillEs = (s: string) => ({ grammar: 'Gramática', vocab: 'Vocabulario', reading: 'Lectura', writing: 'Escritura', translation: 'Traducción' } as Record<string, string>)[s] ?? s
