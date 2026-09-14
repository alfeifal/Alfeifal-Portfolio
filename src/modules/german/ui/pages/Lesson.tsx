import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { unitById, exercisesOfUnit, vocabOfUnit, conceptById, UNITS, SOURCE } from '@german/content'
import { useStore, isUnlocked, vocabLevel } from '@german/store'
import { Markdown } from '../components/Markdown'
import { Session, SessionSummary, type SessionResult } from '../components/Session'
import { Mastery, Origin, Bar } from '../components/ui'
import { generateExam } from '@german/engine/exam'
import { MASTERY_LABELS } from '@german/engine/mastery'
import { Speak } from '../components/Speak'

const TABS = [['learn', 'Aprender'], ['understand', 'Entender'], ['practice', 'Practicar'], ['review', 'Repasar'], ['test', 'Test'], ['mastery', 'Dominio']] as const

export function Lesson() {
  const { id } = useParams(); const nav = useNavigate(); const [sp, setSp] = useSearchParams()
  const s = useStore()
  const u = unitById(id!)
  const tab = (sp.get('tab') ?? 'learn') as typeof TABS[number][0]
  useEffect(() => { if (u) s.setPosition(u.id, tab) }, [u?.id, tab])
  if (!u) return <p>Unidad no encontrada.</p>
  if (!isUnlocked(s, u.id)) return <div className="card p-5"><p className="font-semibold">Unidad bloqueada</p><p className="text-sm muted">Supera el test de la unidad anterior con un 70 % o activa «Desbloquear todo» en Ajustes.</p></div>
  const l = s.lessons[u.id]; const done = l?.sectionsDone ?? []
  const idx = UNITS.findIndex(x => x.id === u.id); const prev = UNITS[idx - 1]; const next = UNITS[idx + 1]
  const setTab = (t: string) => setSp({ tab: t })
  return <div>
    <div className="mb-1 flex items-center justify-between text-xs muted"><Link to="/curso">← Curso</Link><span className="pill"><span>SOURCE</span> · Unidad {u.number}, pág. {u.page}</span></div>
    <h1 className="h1">{u.number}. {u.title}</h1>
    {u.titleDe && <p className="text-sm muted mb-3">{u.titleDe} · {u.cefr}</p>}
    <div className="mb-4 -mx-4 px-4 flex gap-1.5 overflow-x-auto pb-1">{TABS.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`tab border border-line ${tab === k ? 'tab-active' : ''}`}>{done.includes(k) ? '✓ ' : ''}{label}</button>)}</div>

    {tab === 'learn' && <div>
      <p className="mb-3 text-xs muted">🔊 Toca cualquier palabra o frase en azul para escucharla.</p>
      <div className="card p-4 mb-4"><p className="mb-1 text-sm font-semibold">En esta unidad aprenderás</p><ul className="ml-4 list-disc text-sm space-y-0.5">{u.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul></div>
      {u.learn.map((sec, i) => <div key={i} className="card p-4 mb-3"><h3 className="mb-2 font-semibold">{sec.title}</h3><Markdown text={sec.body} /></div>)}
      <p className="mb-3 text-xs muted"><Origin o="AI" /> Explicación escrita para esta app a partir de la Unidad {u.number} del libro «{SOURCE.title}».</p>
      <div className="flex gap-2">{!done.includes('learn') && <button className="btn-primary" onClick={() => { s.markSection(u.id, 'learn'); setTab('understand') }}>He entendido → Entender</button>}{done.includes('learn') && <button className="btn-ghost" onClick={() => setTab('understand')}>Siguiente: Entender</button>}</div>
    </div>}

    {tab === 'understand' && <div>
      {u.understand.map((sec, i) => <div key={i} className="card p-4 mb-3"><h3 className="mb-2 font-semibold">{sec.title}</h3><Markdown text={sec.body} /></div>)}
      <div className="card p-4 mb-3"><h3 className="mb-2 font-semibold">Conceptos y errores típicos</h3>{u.concepts.map(c => { const k = conceptById(c); if (!k) return null; return <div key={c} className="mb-3 last:mb-0"><div className="flex items-center justify-between"><Link to={`/gramatica/${c}`} className="font-medium hover:underline">{k.name} <span className="muted font-normal">· {k.nameEs}</span></Link><Mastery level={s.mastery[c]?.level ?? 0} small /></div><p className="text-sm">{k.summary}</p>{k.mistakes.length > 0 && <ul className="mt-1 ml-4 list-disc text-sm muted">{k.mistakes.map((m, i) => <li key={i}>{m}</li>)}</ul>}</div> })}</div>
      <div className="card p-4 mb-3"><h3 className="mb-1 font-semibold">Ejercicios del libro (SOURCE)</h3><p className="text-xs muted mb-1">Tipos de ejercicio que propone la Unidad {u.number}. La app te ofrece ejercicios equivalentes escritos para ti.</p><ul className="ml-4 list-disc text-sm">{u.bookExercises.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
      <div className="flex gap-2">{!done.includes('understand') && <button className="btn-primary" onClick={() => { s.markSection(u.id, 'understand'); setTab('practice') }}>Entendido → Practicar</button>}{done.includes('understand') && <button className="btn-ghost" onClick={() => setTab('practice')}>Siguiente: Practicar</button>}</div>
    </div>}

    {tab === 'practice' && <PracticeTab unitId={u.id} onDone={() => { s.markSection(u.id, 'practice'); }} onGoReview={() => setTab('review')} />}
    {tab === 'review' && <ReviewTab unitId={u.id} onDone={() => { s.markSection(u.id, 'review'); setTab('test') }} />}
    {tab === 'test' && <TestTab unit={u} onPass={() => { if (next) nav(`/curso/${next.id}`) }} />}
    {tab === 'mastery' && <MasteryTab unitId={u.id} />}

    <div className="mt-8 flex justify-between text-sm">{prev ? <Link to={`/curso/${prev.id}`} className="btn-ghost">← U{prev.number}</Link> : <span />}{next && isUnlocked(s, next.id) ? <Link to={`/curso/${next.id}`} className="btn-ghost">U{next.number} →</Link> : <span />}</div>
  </div>
}

function PracticeTab({ unitId, onDone, onGoReview }: { unitId: string; onDone: () => void; onGoReview: () => void }) {
  const [result, setResult] = useState<SessionResult | null>(null)
  const [run, setRun] = useState(0)
  const [failedOnly, setFailedOnly] = useState<string[] | null>(null)
  const all = useMemo(() => exercisesOfUnit(unitId), [unitId])
  const list = useMemo(() => failedOnly ? all.filter(e => failedOnly.includes(e.id)) : all, [all, failedOnly, run])
  if (result) return <SessionSummary result={result} label="Práctica" onRetakeFailed={() => { setFailedOnly(result.answers.filter(a => !a.correct).map(a => a.ex.id)); setResult(null); setRun(r => r + 1) }} onAgain={() => { setFailedOnly(null); setResult(null); setRun(r => r + 1) }} onExit={onGoReview} />
  return <div>
    <p className="mb-3 text-sm muted">{list.length} ejercicios con corrección inmediata. Puedes salir cuando quieras: lo hecho se guarda.</p>
    <Session key={run} exercises={list} title={failedOnly ? 'Repitiendo las falladas' : 'Práctica de la unidad'} onFinish={r => { setResult(r); onDone() }} onExit={onGoReview} xpBonus={50} />
  </div>
}

function ReviewTab({ unitId, onDone }: { unitId: string; onDone: () => void }) {
  const s = useStore(); const vocab = vocabOfUnit(unitId)
  const [i, setI] = useState(0); const [flip, setFlip] = useState(false); const [mode, setMode] = useState<'list' | 'cards'>('list')
  const v = vocab[i]
  const grade = (g: 0 | 1 | 2 | 3) => { s.reviewVocab(v.id, g); setFlip(false); if (i + 1 >= vocab.length) { setMode('list'); setI(0); onDone() } else setI(i + 1) }
  return <div>
    <div className="mb-3 flex gap-2"><button className={`tab border border-line ${mode === 'list' ? 'tab-active' : ''}`} onClick={() => setMode('list')}>Lista ({vocab.length})</button><button className={`tab border border-line ${mode === 'cards' ? 'tab-active' : ''}`} onClick={() => { setMode('cards'); setI(0) }}>Tarjetas</button></div>
    {mode === 'list' && <div><ul className="card divide-y divide-line dark:divide-white/10">{vocab.map(w => <li key={w.id} className="flex items-center gap-3 px-4 py-2.5"><span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: ['#C43D2A', '#E0961E', '#C9A800', '#1E8A5A', '#2F4BD6'][vocabLevel(s.vocab[w.id])] }} /><div className="min-w-0 flex-1"><p className="font-medium flex items-center gap-1">{w.article ? `${w.article} ` : ''}{w.de}{w.plural ? <span className="muted font-normal">, die {w.plural}</span> : ''}<Speak text={`${w.article ? w.article + ' ' : ''}${w.de}`} /></p><p className="text-sm muted">{w.es} · <i>{w.example}</i> <Speak text={w.example} /></p></div></li>)}</ul><button className="btn-primary mt-3" onClick={() => { setMode('cards'); setI(0) }}>Repasar con tarjetas</button><button className="btn-ghost mt-3 ml-2" onClick={onDone}>Saltar al test</button></div>}
    {mode === 'cards' && v && <div>
      <p className="mb-2 text-xs muted">{i + 1} / {vocab.length}</p>
      <button onClick={() => setFlip(f => !f)} className="card w-full p-8 text-center min-h-[180px] flex flex-col items-center justify-center">
        {!flip ? <><p className="text-2xl font-semibold">{v.article ? `${v.article} ` : ''}{v.de}</p><p className="mt-2 text-xs muted">Toca para ver la traducción</p></> : <><p className="text-xl font-semibold">{v.es}</p>{v.plural && <p className="text-sm muted">pl. die {v.plural}</p>}<p className="mt-3 text-sm">{v.example}</p><p className="text-xs muted">{v.exampleEs}</p></>}
      </button>
      <div className="mt-2 flex justify-center gap-2"><Speak text={`${v.article ? v.article + ' ' : ''}${v.de}`} /><Speak text={`${v.article ? v.article + ' ' : ''}${v.de}`} slow /><Speak text={v.example} className="opacity-70" /></div>
      {flip && <div className="mt-3 grid grid-cols-4 gap-2"><button className="btn-bad" onClick={() => grade(0)}>Otra vez</button><button className="btn-ghost" onClick={() => grade(1)}>Difícil</button><button className="btn-good" onClick={() => grade(2)}>Bien</button><button className="btn-primary" onClick={() => grade(3)}>Fácil</button></div>}
    </div>}
  </div>
}

function TestTab({ unit, onPass }: { unit: NonNullable<ReturnType<typeof unitById>>; onPass: () => void }) {
  const s = useStore(); const l = s.lessons[unit.id]
  const [phase, setPhase] = useState<'intro' | 'run' | 'done'>('intro')
  const [exs, setExs] = useState(() => [] as ReturnType<typeof generateExam>)
  const [result, setResult] = useState<SessionResult | null>(null)
  const start = () => { setExs(generateExam(s, { skills: ['grammar', 'vocab', 'translation', 'reading'], units: [unit.id], difficulty: 'normal', count: 10, mode: 'unit' })); setPhase('run') }
  if (phase === 'intro') return <div className="card p-5"><p className="font-semibold mb-1">Test de la Unidad {unit.number}</p><p className="text-sm muted mb-3">10 preguntas. Sin pistas ni soluciones hasta el final. Necesitas un 70 % para desbloquear la siguiente unidad.{l?.testBest ? ` Tu mejor resultado: ${l.testBest}%.` : ''}{l?.attempts ? ` Intentos: ${l.attempts}.` : ''}</p><button className="btn-primary" onClick={start}>Empezar el test</button></div>
  if (phase === 'run') return <Session exercises={exs} title={`Test · Unidad ${unit.number}`} deferred inExam xpBonus={100} onFinish={r => { setResult(r); s.recordTest(unit.id, r.score); s.addResult({ mode: 'unit', label: `Test U${unit.number}`, score: r.score, correct: r.answers.filter(a => a.correct).length, total: r.answers.length, timeSec: r.timeSec, byConcept: {}, failedIds: r.answers.filter(a => !a.correct).map(a => a.ex.id) }); setPhase('done') }} onExit={() => setPhase('intro')} />
  return <div>{result && <SessionSummary result={result} label={`Test · Unidad ${unit.number}`} onAgain={start} onExit={() => setPhase('intro')} />}{result && result.score >= 70 && <div className="mt-4 card p-4 border-good"><p className="font-semibold">🎉 Unidad superada</p><p className="text-sm muted mb-2">Has desbloqueado la siguiente unidad.</p><button className="btn-primary" onClick={onPass}>Ir a la siguiente unidad</button></div>}</div>
}

function MasteryTab({ unitId }: { unitId: string }) {
  const s = useStore(); const u = unitById(unitId)!; const vocab = vocabOfUnit(unitId)
  const lv = vocab.map(v => vocabLevel(s.vocab[v.id]))
  return <div className="space-y-3">
    <div className="card p-4"><p className="mb-2 font-semibold">Conceptos</p>{u.concepts.map(c => { const k = conceptById(c)!; const m = s.mastery[c]; const total = (m?.correct ?? 0) + (m?.wrong ?? 0); return <div key={c} className="mb-3 last:mb-0"><div className="flex items-center justify-between text-sm"><Link to={`/gramatica/${c}`} className="font-medium hover:underline">{k.nameEs}</Link><Mastery level={m?.level ?? 0} /></div><Bar value={(m?.level ?? 0) / 4} color={['#C43D2A', '#E0961E', '#C9A800', '#1E8A5A', '#2F4BD6'][m?.level ?? 0]} /><p className="text-xs muted mt-0.5">{total ? `${m!.correct}/${total} aciertos · ${m!.days.length} días distintos` : 'Sin práctica todavía'}</p></div> })}</div>
    <div className="card p-4"><p className="mb-2 font-semibold">Vocabulario</p><div className="flex gap-1 h-3 rounded-full overflow-hidden">{[0, 1, 2, 3, 4].map(l => { const n = lv.filter(x => x === l).length; return n ? <div key={l} style={{ flex: n, background: ['#C43D2A', '#E0961E', '#C9A800', '#1E8A5A', '#2F4BD6'][l] }} title={`${MASTERY_LABELS[l]}: ${n}`} /> : null })}</div><p className="text-xs muted mt-1">{lv.filter(x => x >= 3).length} de {vocab.length} palabras dominadas</p></div>
    <div className="card p-4 text-sm"><p className="font-semibold mb-1">Cómo sube el dominio</p><ul className="ml-4 list-disc space-y-0.5 muted"><li>🔴 No aprendido → 🟠 En progreso: leer la sección Aprender.</li><li>🟡 Familiarizado: ≥70 % de aciertos en ≥3 ejercicios.</li><li>🟢 Dominado: ≥85 % en ≥8 ejercicios repartidos en ≥3 días.</li><li>🔵 Mastered: además, acertado en exámenes mixtos con ≥14 días de separación.</li><li>Tres fallos seguidos bajan un nivel.</li></ul></div>
  </div>
}
