import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from '@german/store'
import { flushGermanStorage } from '@german/store/storage'

const tabs = [
  { to: '/', label: 'Hoy', icon: '☀️' },
  { to: '/curso', label: 'Curso', icon: '📚' },
  { to: '/repasar', label: 'Repasar', icon: '🔁' },
  { to: '/retos', label: 'Retos', icon: '🏆' },
  { to: '/mas', label: 'Más', icon: '☰' },
]
const more = [
  { to: '/gramatica', label: 'Gramática' }, { to: '/vocabulario', label: 'Vocabulario' }, { to: '/errores', label: 'Mis errores' }, { to: '/practica', label: 'Práctica libre' }, { to: '/estadisticas', label: 'Estadísticas' }, { to: '/tutor', label: 'AI Tutor' }, { to: '/conversacion', label: 'Conversación' }, { to: '/buscar', label: 'Buscar' }, { to: '/ajustes', label: 'Ajustes' },
]

export function Layout() {
  const loc = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  useEffect(() => () => { void flushGermanStorage() }, [])
  const streak = useStore(s => s.streak); const xp = useStore(s => s.xp)
  const all = [...tabs.filter(t => t.to !== '/mas'), ...more]
  return <div className="german-app">
    <div className="mb-3 flex items-center justify-between gap-2">
      <NavLink to="/" className="text-lg font-semibold tracking-tight">Deutsch<span className="text-primary">.</span></NavLink>
      <span className="text-xs muted">🔥 {streak} días · ✦ {xp} XP</span>
    </div>
    <nav className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1">{all.map(t => <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => `tab border border-line ${isActive ? 'tab-active' : ''}`}>{'icon' in t ? `${t.icon} ` : ''}{t.label}</NavLink>)}</nav>
    <div className="mx-auto max-w-2xl"><Outlet /></div>
  </div>
}

export function MorePage() {
  const streak = useStore(s => s.streak); const xp = useStore(s => s.xp)
  return <div>
    <h1 className="h1 mb-1">Más</h1><p className="mb-4 text-sm muted">🔥 {streak} días seguidos · ✦ {xp} XP</p>
    <div className="grid gap-2">{more.map(t => <NavLink key={t.to} to={t.to} className="card px-4 py-3 text-[16px] font-medium">{t.label}</NavLink>)}</div>
  </div>
}
