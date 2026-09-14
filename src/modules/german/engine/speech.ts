// Pronunciación con las voces del navegador (Web Speech API). Sin API ni conexión.
let voice: SpeechSynthesisVoice | null = null
function pickVoice() {
  if (voice || typeof speechSynthesis === 'undefined') return voice
  const vs = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('de'))
  const pref = ['Anna', 'Petra', 'Helena', 'Markus', 'Google Deutsch', 'Microsoft Katja']
  voice = pref.map(n => vs.find(v => v.name.includes(n))).find(Boolean) ?? vs.find(v => v.localService) ?? vs[0] ?? null
  return voice
}
if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = () => { voice = null; pickVoice() }

export const speechSupported = () => typeof speechSynthesis !== 'undefined'
export function speak(text: string, rate = 0.85) {
  if (!speechSupported()) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'de-DE'; u.rate = rate
  const v = pickVoice(); if (v) u.voice = v
  speechSynthesis.speak(u)
}
export const hasGermanVoice = () => !!pickVoice()
