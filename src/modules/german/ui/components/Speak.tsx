import { speak, speechSupported } from '@german/engine/speech'
/** Botón 🔊 que pronuncia el texto en alemán. */
export function Speak({ text, slow, className = '' }: { text: string; slow?: boolean; className?: string }) {
  if (!speechSupported()) return null
  return <button type="button" aria-label={`Pronunciar: ${text}`} title={slow ? 'Pronunciar despacio' : 'Pronunciar'} onClick={e => { e.stopPropagation(); e.preventDefault(); speak(text, slow ? 0.6 : 0.85) }} className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm hover:bg-black/10 dark:hover:bg-white/10 ${className}`}>{slow ? '🐢' : '🔊'}</button>
}
