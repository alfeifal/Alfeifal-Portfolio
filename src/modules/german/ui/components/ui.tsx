import React from 'react'
import { MASTERY_COLORS, MASTERY_LABELS } from '@german/engine/mastery'

export const Bar = ({ value, color = '#2F4BD6', h = 6 }: { value: number; color?: string; h?: number }) => (
  <div className="w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden" style={{ height: h }}><div className="h-full rounded-full transition-[width]" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: color }} /></div>
)
export const Mastery = ({ level, small }: { level: number; small?: boolean }) => (
  <span className="inline-flex items-center gap-1.5 text-xs font-medium"><span className="inline-block rounded-full" style={{ width: small ? 8 : 10, height: small ? 8 : 10, background: MASTERY_COLORS[level] }} />{!small && MASTERY_LABELS[level]}</span>
)
export const Stars = ({ n }: { n: number }) => <span className="text-xs tracking-tight" aria-label={`dificultad ${n}`}>{'⭐'.repeat(n)}</span>
export const Origin = ({ o }: { o: 'SOURCE' | 'AI' }) => <span className={`pill ${o === 'SOURCE' ? 'text-primary' : ''}`} title={o === 'SOURCE' ? 'Del libro' : 'Generado por la app a partir del libro'}>{o === 'SOURCE' ? 'SOURCE' : 'AI · basado en el libro'}</span>
export const Section = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <section className="mb-6"><div className="mb-2 flex items-center justify-between"><h2 className="h2">{title}</h2>{right}</div>{children}</section>
)
export const Empty = ({ children }: { children: React.ReactNode }) => <div className="card p-5 text-sm muted">{children}</div>
export function fmtTime(sec: number) { const m = Math.floor(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min` }
