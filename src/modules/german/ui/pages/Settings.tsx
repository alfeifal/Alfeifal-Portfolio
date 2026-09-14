import { useRef, useState } from 'react'
import { useStore } from '@german/store'
import { UNITS, SOURCE, CONCEPTS, VOCAB, EXERCISES } from '@german/content'
import { speak, hasGermanVoice, speechSupported } from '@german/engine/speech'

export function Settings() {
  const s = useStore(); const file = useRef<HTMLInputElement>(null); const [msg, setMsg] = useState('')
  const exportJson = () => { const { setSettings, touchDay, addTime, addXp, markSection, recordTest, recordAnswer, reviewConcept, reviewVocab, resolveError, addResult, setPosition, toggleBookmark, setDailyChallenge, resetUnit, importState, resetAll, ...data } = s; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `deutsch-progreso-${new Date().toISOString().slice(0, 10)}.json`; a.click() }
  const importJson = async (f: File) => { try { const data = JSON.parse(await f.text()); if (!data.version) throw new Error('formato'); s.importState(data); setMsg('Progreso importado.') } catch { setMsg('El archivo no es válido.') } }
  return <div>
    <h1 className="h1 mb-4">Ajustes</h1>
    <div className="card p-4 mb-3 space-y-3">
      <label className="block text-sm">Objetivo diario (minutos)<div className="mt-1 flex gap-1.5">{[10, 15, 20, 30, 45].map(n => <button key={n} className={`tab border border-line ${s.settings.dailyGoalMin === n ? 'tab-active' : ''}`} onClick={() => s.setSettings({ dailyGoalMin: n })}>{n}</button>)}</div></label>
      <p className="text-xs muted">El modo oscuro sigue el tema de Personal OS (Ajustes del sistema).</p>
      <label className="flex items-center justify-between text-sm"><span>Desbloquear todas las unidades<br /><span className="text-xs muted">Para explorar sin superar los tests</span></span><input type="checkbox" checked={s.settings.unlockAll} onChange={e => s.setSettings({ unlockAll: e.target.checked })} /></label>
    </div>
    <div className="card p-4 mb-3"><p className="font-semibold text-sm mb-1">Pronunciación</p><p className="text-xs muted mb-2">Usa las voces del sistema. {speechSupported() ? (hasGermanVoice() ? 'Voz alemana detectada.' : 'No se ha detectado voz alemana: en iPhone/Mac ve a Ajustes → Accesibilidad → Contenido leído → Voces → Alemán y descarga «Anna».') : 'Tu navegador no soporta síntesis de voz.'}</p><button className="btn-ghost" onClick={() => speak('Die Straße ist schön. Ich heiße Ayoub.')}>🔊 Probar voz</button></div>
    <div className="card p-4 mb-3"><p className="font-semibold text-sm mb-1">AI Tutor</p><p className="text-xs muted">En Personal OS el tutor usa la clave de Anthropic configurada en el servidor (ANTHROPIC_API_KEY). No hace falta pegar ninguna clave en el navegador.</p></div>
    <div className="card p-4 mb-3"><p className="font-semibold text-sm mb-2">Datos</p><div className="flex flex-wrap gap-2"><button className="btn-ghost" onClick={exportJson}>Exportar progreso (JSON)</button><button className="btn-ghost" onClick={() => file.current?.click()}>Importar</button><input ref={file} type="file" accept="application/json" className="hidden" onChange={e => e.target.files?.[0] && importJson(e.target.files[0])} /></div>{msg && <p className="text-sm mt-2">{msg}</p>}
      <details className="mt-3 text-sm"><summary className="cursor-pointer">Reiniciar una unidad</summary><div className="mt-2 flex flex-wrap gap-1.5">{UNITS.map(u => <button key={u.id} className="tab border border-line !px-2.5" onClick={() => { if (confirm(`¿Reiniciar el progreso de lección de la Unidad ${u.number}?`)) s.resetUnit(u.id) }}>{u.number}</button>)}</div></details>
      <button className="btn-bad mt-3" onClick={() => { if (confirm('¿Borrar TODO el progreso? Exporta antes si quieres conservarlo.')) s.resetAll() }}>Borrar todo el progreso</button></div>
    <div className="card p-4 text-sm"><p className="font-semibold mb-1">Sobre el contenido</p><p className="muted mb-2">{SOURCE.note}</p><p className="muted">Fuente: <i>{SOURCE.title}</i>, {SOURCE.authors}, {SOURCE.publisher}.</p><p className="muted mt-2">{UNITS.length} unidades · {CONCEPTS.length} conceptos · {VOCAB.length} palabras · {EXERCISES.length} ejercicios.</p></div>
  </div>
}
