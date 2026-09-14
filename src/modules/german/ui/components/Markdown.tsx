import React from 'react'
import { speak, speechSupported } from '@german/engine/speech'

function inline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = []; let i = 0
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~)/g; let m: RegExpExecArray | null; let last = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={i++}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('~~')) out.push(<s key={i++} className="opacity-60">{t.slice(2, -2)}</s>)
    else { const de = t.slice(1, -1); out.push(speechSupported() ? <em key={i++} role="button" tabIndex={0} title="Toca para escuchar" className="cursor-pointer hover:underline decoration-dotted" onClick={() => speak(de.replace(/…/g, ''))} onKeyDown={e => { if (e.key === 'Enter') speak(de) }}>{de}</em> : <em key={i++}>{de}</em>) }
    last = m.index + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

/** Markdown-lite: párrafos, **negrita**, *alemán*, listas "- ", tablas "| a | b |", numeración "1. " */
export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/)
  return <div className="md">{blocks.map((b, bi) => {
    const lines = b.split('\n').filter(l => l.trim() !== '')
    if (lines.every(l => l.trim().startsWith('|'))) {
      return <table key={bi}><tbody>{lines.map((l, li) => { const cells = l.trim().slice(1, -1).split('|').map(c => c.trim()); const de = cells.filter(c => /[äöüß]|^(ich|du|er|wir|ihr|sie|Sie|der|die|das|den|dem|des|ein|eine|einen|einem|einer|kein|mein|am|im)\b/.test(c) || /^[A-ZÄÖÜ]?[a-zäöüß]+(en|st|t|e)$/.test(c)); return <tr key={li}>{cells.map((c, ci) => <td key={ci}>{inline(c)}</td>)}{speechSupported() && de.length > 0 && <td className="!border-0 w-8"><button type="button" aria-label="Escuchar fila" className="text-sm opacity-60 hover:opacity-100" onClick={() => speak(de.map(x => x.replace(/\*\*/g, '')).join('. '))}>🔊</button></td>}</tr> })}</tbody></table>
    }
    if (lines.every(l => /^(- |\d+\. )/.test(l.trim()))) {
      return <ul key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.trim().replace(/^(- |\d+\. )/, ''))}</li>)}</ul>
    }
    return <p key={bi}>{lines.map((l, li) => <React.Fragment key={li}>{li > 0 && <br />}{inline(l)}</React.Fragment>)}</p>
  })}</div>
}
