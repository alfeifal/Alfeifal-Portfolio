import { useMemo, useState } from 'react'
import { VOCAB, UNITS } from '@german/content'
import { useStore, vocabLevel, isUnlocked } from '@german/store'
import { gradeText } from '@german/engine/grade'
import { Umlauts } from '../components/ExerciseRunner'
import type { VocabItem } from '@german/content/types'
import { Speak } from '../components/Speak'
import { speak } from '@german/engine/speech'

const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5)
const LV = ['#C43D2A', '#E0961E', '#C9A800', '#1E8A5A', '#2F4BD6']

export function Vocab() {
  const s = useStore()
  const [q, setQ] = useState(''); const [unit, setUnit] = useState('all'); const [cat, setCat] = useState('all'); const [lvl, setLvl] = useState('all')
  const [mode, setMode] = useState<'list' | 'cards' | 'quiz' | 'spell'>('list')
  const cats = useMemo(() => Array.from(new Set(VOCAB.map(v => v.category))).sort(), [])
  const list = useMemo(() => VOCAB.filter(v => (unit === 'all' ? isUnlocked(s, v.unitId) : v.unitId === unit) && (cat === 'all' || v.category === cat) && (lvl === 'all' || vocabLevel(s.vocab[v.id]) === Number(lvl)) && (!q || (v.de + ' ' + v.es + ' ' + (v.article ?? '')).toLowerCase().includes(q.toLowerCase()))), [q, unit, cat, lvl, s.vocab, s.lessons, s.settings.unlockAll])
  return <div>
    <h1 className="h1 mb-1">Vocabulario</h1><p className="text-sm muted mb-3">{VOCAB.length} palabras del curso, siempre con artículo y plural.</p>
    <input className="field mb-2" placeholder="Buscar en alemán o español" value={q} onChange={e => setQ(e.target.value)} />
    <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
      <select className="field !py-2" value={unit} onChange={e => setUnit(e.target.value)}><option value="all">Unidades desbloqueadas</option>{UNITS.map(u => <option key={u.id} value={u.id}>U{u.number} {u.title}</option>)}</select>
      <select className="field !py-2" value={cat} onChange={e => setCat(e.target.value)}><option value="all">Todas las categorías</option>{cats.map(c => <option key={c}>{c}</option>)}</select>
      <select className="field !py-2" value={lvl} onChange={e => setLvl(e.target.value)}><option value="all">Todos los niveles</option><option value="0">🔴 No aprendido</option><option value="1">🟠 En progreso</option><option value="2">🟡 Familiarizado</option><option value="3">🟢 Dominado</option><option value="4">🔵 Mastered</option></select>
    </div>
    <div className="mb-3 flex gap-1.5 overflow-x-auto">{([['list', 'Lista'], ['cards', 'Tarjetas'], ['quiz', 'Quiz'], ['spell', 'Escribir']] as const).map(([k, l]) => <button key={k} className={`tab border border-line ${mode === k ? 'tab-active' : ''}`} onClick={() => setMode(k)}>{l}</button>)}</div>
    {list.length === 0 && <p className="card p-4 text-sm muted">Sin resultados con estos filtros.</p>}
    {mode === 'list' && list.length > 0 && <ul className="card divide-y divide-line dark:divide-white/10">{list.map(w => <li key={w.id} className="flex items-center gap-3 px-4 py-2.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LV[vocabLevel(s.vocab[w.id])] }} /><div className="min-w-0 flex-1"><p className="font-medium flex items-center gap-1">{w.article ? `${w.article} ` : ''}{w.de}{w.plural ? <span className="muted font-normal">, die {w.plural}</span> : ''} <span className="text-xs muted">· {w.pos}</span><Speak text={`${w.article ? w.article + ' ' : ''}${w.de}${w.plural ? '. Plural: die ' + w.plural : ''}`} /></p><p className="text-sm muted">{w.es}</p><p className="text-sm"><i>{w.example}</i> <Speak text={w.example} /><span className="muted">— {w.exampleEs}</span></p></div><span className="text-[10px] muted">U{UNITS.find(u => u.id === w.unitId)?.number}</span></li>)}</ul>}
    {mode === 'cards' && list.length > 0 && <Cards key={list.map(x => x.id).join()} list={list} />}
    {mode === 'quiz' && list.length >= 4 && <Quiz key={list.map(x => x.id).join()} list={list} />}
    {mode === 'quiz' && list.length < 4 && <p className="card p-4 text-sm muted">Necesitas al menos 4 palabras para el quiz.</p>}
    {mode === 'spell' && list.length > 0 && <Spell key={list.map(x => x.id).join()} list={list} />}
  </div>
}

function Cards({ list }: { list: VocabItem[] }) {
  const s = useStore(); const [q] = useState(() => shuffle(list).slice(0, 30)); const [i, setI] = useState(0); const [flip, setFlip] = useState(false); const [dir, setDir] = useState<'de' | 'es'>('de')
  const v = q[i]
  if (!v) return <p className="card p-4">Sesión completada ({q.length} tarjetas).</p>
  const grade = (g: 0 | 1 | 2 | 3) => { s.reviewVocab(v.id, g); setFlip(false); setI(i + 1) }
  return <div><div className="mb-2 flex justify-between text-xs muted"><span>{i + 1} / {q.length}</span><button onClick={() => setDir(d => d === 'de' ? 'es' : 'de')} className="underline">{dir === 'de' ? 'DE → ES' : 'ES → DE'}</button></div>
    <button onClick={() => setFlip(f => !f)} className="card w-full p-8 min-h-[180px] flex flex-col items-center justify-center text-center">{!flip ? <p className="text-2xl font-semibold">{dir === 'de' ? `${v.article ? v.article + ' ' : ''}${v.de}` : v.es}</p> : <><p className="text-xl font-semibold">{dir === 'de' ? v.es : `${v.article ? v.article + ' ' : ''}${v.de}`}</p>{v.plural && <p className="text-sm muted">pl. die {v.plural}</p>}<p className="mt-3 text-sm">{v.example}</p><p className="text-xs muted">{v.exampleEs}</p></>}</button>
    <div className="mt-2 flex justify-center gap-2"><Speak text={`${v.article ? v.article + ' ' : ''}${v.de}`} /><Speak text={`${v.article ? v.article + ' ' : ''}${v.de}`} slow /><Speak text={v.example} className="opacity-70" /></div>
    {flip && <div className="mt-3 grid grid-cols-4 gap-2"><button className="btn-bad" onClick={() => grade(0)}>Otra vez</button><button className="btn-ghost" onClick={() => grade(1)}>Difícil</button><button className="btn-good" onClick={() => grade(2)}>Bien</button><button className="btn-primary" onClick={() => grade(3)}>Fácil</button></div>}</div>
}

function Quiz({ list }: { list: VocabItem[] }) {
  const s = useStore(); const [q] = useState(() => shuffle(list).slice(0, 15)); const [i, setI] = useState(0); const [pick, setPick] = useState<number | null>(null); const [score, setScore] = useState(0)
  const v = q[i]
  const opts = useMemo(() => v ? shuffle([v, ...shuffle(list.filter(x => x.id !== v.id)).slice(0, 3)]) : [], [i])
  if (!v) return <p className="card p-4">Quiz terminado: {score} / {q.length}.</p>
  const askArticle = v.article && Math.random() < 0 // (reservado)
  void askArticle
  return <div><p className="mb-2 text-xs muted">{i + 1} / {q.length} · {score} aciertos</p>
    <div className="card p-5"><p className="mb-3 text-xl font-semibold">{v.es}</p><div className="grid gap-2">{opts.map((o, k) => <button key={o.id} disabled={pick !== null} onClick={() => { setPick(k); const ok = o.id === v.id; s.reviewVocab(v.id, ok ? 2 : 0); if (ok) setScore(sc => sc + 1); speak(`${v.article ? v.article + ' ' : ''}${v.de}`) }} className={`rounded-xl border px-4 py-3 text-left text-[16px] ${pick === null ? 'border-line' : o.id === v.id ? 'border-good bg-good-soft dark:bg-good/20' : pick === k ? 'border-bad bg-bad-soft dark:bg-bad/20' : 'border-line opacity-60'}`}>{o.article ? `${o.article} ` : ''}{o.de}</button>)}</div>
      {pick !== null && <div className="mt-3 flex items-center justify-between text-sm"><span className="muted">{v.example} <Speak text={`${v.article ? v.article + ' ' : ''}${v.de}. ${v.example}`} /></span><button className="btn-primary" onClick={() => { setPick(null); setI(i + 1) }}>Siguiente</button></div>}</div></div>
}

function Spell({ list }: { list: VocabItem[] }) {
  const s = useStore(); const [q] = useState(() => shuffle(list).slice(0, 15)); const [i, setI] = useState(0); const [t, setT] = useState(''); const [res, setRes] = useState<null | boolean>(null); const [score, setScore] = useState(0)
  const v = q[i]
  if (!v) return <p className="card p-4">Terminado: {score} / {q.length}.</p>
  const full = `${v.article ? v.article + ' ' : ''}${v.de}`
  const check = () => { const g = gradeText(t, v.article ? [full] : [v.de]); setRes(g.correct); s.reviewVocab(v.id, g.correct ? 2 : 0); if (g.correct) setScore(sc => sc + 1) }
  return <div><p className="mb-2 text-xs muted">{i + 1} / {q.length} · {score} aciertos</p>
    <div className="card p-5"><p className="text-sm muted">Escribe en alemán{v.article ? ' (con artículo)' : ''}:</p><p className="mb-3 text-xl font-semibold">{v.es}</p>
      <input autoFocus className={`field ${res === true ? 'border-good' : res === false ? 'border-bad' : ''}`} value={t} disabled={res !== null} onChange={e => setT(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && t.trim() && res === null) check() }} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <Umlauts onInsert={c => setT(x => x + c)} disabled={res !== null} />
      {res === null ? <button className="btn-primary mt-3" disabled={!t.trim()} onClick={check}>Comprobar</button> : <div className="mt-3"><p className="text-sm">{res ? '🟢 Correcto' : <>🔴 Correcto: <b>{full}</b></>}{v.plural && <span className="muted"> · pl. die {v.plural}</span>} <Speak text={full} /></p><button className="btn-primary mt-2" onClick={() => { setRes(null); setT(''); setI(i + 1) }}>Siguiente</button></div>}</div></div>
}
