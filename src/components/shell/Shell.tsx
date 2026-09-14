"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Bell, ChevronsLeft, ChevronsRight, Menu, Search, Zap, LogOut } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { NAV, MOBILE_TABS } from "@/components/nav";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client";
import { MotionProvider, PageTransition, T } from "@/components/motion";
import { ToastProvider } from "@/components/toast";
import { Tooltip } from "@/components/ui";
import { QuickEntry } from "./QuickEntry";
import { CommandPalette } from "./CommandPalette";

interface ShellUser { name: string; email: string; currency: string }
const ShellCtx = createContext<{ user: ShellUser; aiConfigured: boolean; unread: number; refreshUnread: () => void; openQuick: () => void; openPalette: () => void }>({ user: { name: "", email: "", currency: "EUR" }, aiConfigured: false, unread: 0, refreshUnread: () => {}, openQuick: () => {}, openPalette: () => {} });
export const useShell = () => useContext(ShellCtx);

const groups: { key: (typeof NAV)[number]["group"]; label: string }[] = [{ key: "core", label: "" }, { key: "money", label: "Money" }, { key: "life", label: "Life" }, { key: "learn", label: "Learning" }, { key: "system", label: "System" }];

export function Shell({ user, aiConfigured, children }: { user: ShellUser; aiConfigured: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [quick, setQuick] = useState(false);
  const [palette, setPalette] = useState(false);
  const [unread, setUnread] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const refreshUnread = () => api<{ unread: number }>("/api/notifications?limit=1").then((r) => setUnread(r.unread)).catch(() => {});
  useEffect(() => { refreshUnread(); const t = setInterval(refreshUnread, 120000); try { setCollapsed(localStorage.getItem("pos-sidebar") === "collapsed"); } catch {} return () => clearInterval(t); }, []);
  useEffect(() => { setMenu(false); }, [pathname]);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); } if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setQuick(true); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const toggleCollapsed = () => setCollapsed((c) => { try { localStorage.setItem("pos-sidebar", c ? "expanded" : "collapsed"); } catch {} return !c; });
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); };

  const NavItem = ({ n, compact }: { n: (typeof NAV)[number]; compact: boolean }) => {
    const isActive = active(n.href);
    const link = (
      <Link href={n.href} className={cn("group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors duration-100", isActive ? "text-accent-fg" : "text-fg/80 hover:bg-surface-2 hover:text-fg", compact && "justify-center px-0")} aria-current={isActive ? "page" : undefined}>
        {isActive && <m.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-accent" transition={T.layout} />}
        <m.span className="relative z-10 inline-flex" whileHover={{ scale: 1.08 }} transition={T.state}><n.icon size={16} strokeWidth={1.8} /></m.span>
        {!compact && <span className="relative z-10 truncate">{n.label}</span>}
        {n.href === "/notifications" && unread > 0 && <span className={cn("relative z-10 rounded-full bg-negative px-1.5 text-[10px] font-semibold text-white", compact ? "absolute right-1 top-0.5" : "ml-auto")}>{unread}</span>}
      </Link>
    );
    return compact ? <Tooltip label={n.label} side="right">{link}</Tooltip> : link;
  };

  const sidebar = (compact: boolean) => (
    <nav className="flex h-full flex-col">
      <div className={cn("mb-4 flex items-center px-2", compact ? "justify-center" : "justify-between")}>
        {!compact && <Link href="/" className="text-lg font-semibold tracking-tight">Personal<span className="muted">OS</span></Link>}
        <button className="hidden rounded-md p-1 muted transition-colors hover:bg-surface-2 hover:text-fg md:inline-flex" onClick={toggleCollapsed} aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}>{compact ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}</button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden">
        {groups.map((g) => (
          <div key={g.key}>
            {g.label && !compact && <p className="mb-1 px-2.5 text-[10.5px] font-medium uppercase tracking-wider muted">{g.label}</p>}
            {g.label && compact && <div className="mx-2 my-2 border-t border-border" />}
            <div className="space-y-0.5">{NAV.filter((n) => n.group === g.key).map((n) => <NavItem key={n.href} n={n} compact={compact} />)}</div>
          </div>
        ))}
      </div>
      <div className={cn("mt-4 border-t border-border pt-3 text-xs muted", compact && "flex justify-center")}>
        {compact ? <Tooltip label="Sign out" side="right"><button className="rounded-md p-1.5 transition-colors hover:bg-surface-2 hover:text-fg" onClick={logout} aria-label="Sign out"><LogOut size={15} /></button></Tooltip> : <><p className="truncate font-medium text-fg">{user.name}</p><p className="truncate">{user.email}</p><button className="link mt-1" onClick={logout}>Sign out</button></>}
      </div>
    </nav>
  );

  return (
    <MotionProvider>
      <ToastProvider>
        <ShellCtx.Provider value={{ user, aiConfigured, unread, refreshUnread, openQuick: () => setQuick(true), openPalette: () => setPalette(true) }}>
          <div className="min-h-screen md:flex">
            <m.aside className="hidden shrink-0 border-r border-border bg-surface p-3 md:sticky md:top-0 md:block md:h-screen" animate={{ width: collapsed ? 64 : 240 }} initial={false} transition={{ duration: 0.2, ease: T.enter.ease }}>{sidebar(collapsed)}</m.aside>
            <AnimatePresence>
              {menu && (
                <m.div className="fixed inset-0 z-40 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T.state}>
                  <div className="absolute inset-0 bg-black/40" onClick={() => setMenu(false)} />
                  <m.aside className="absolute inset-y-0 left-0 w-72 bg-surface p-3 shadow-2xl safe-t" initial={{ x: -40, opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={T.enter} onClick={(e) => e.stopPropagation()}>{sidebar(false)}</m.aside>
                </m.div>
              )}
            </AnimatePresence>
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-bg/85 px-3 py-2 backdrop-blur-md safe-t">
                <button className="btn-ghost btn-sm md:hidden" onClick={() => setMenu(true)} aria-label="Menu"><Menu size={18} /></button>
                <button onClick={() => setPalette(true)} className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm muted transition-colors hover:border-fg/20 hover:text-fg"><Search size={15} /><span className="flex-1">Search or jump to…</span><kbd className="hidden rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] md:inline">⌘K</kbd></button>
                <button onClick={() => setQuick(true)} className="btn-primary btn-sm" title="Quick entry (⌘J)"><Zap size={14} /><span className="hidden sm:inline">Quick entry</span></button>
                <Link href="/notifications" className="btn-ghost btn-sm relative" aria-label="Notifications"><Bell size={16} />
                  <AnimatePresence>{unread > 0 && <m.span key="b" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute -right-1 -top-1 rounded-full bg-negative px-1.5 text-[10px] font-semibold text-white">{unread}</m.span>}</AnimatePresence>
                </Link>
              </header>
              <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-10"><PageTransition id={pathname}>{children}</PageTransition></main>
              <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur safe-b md:hidden">
                <div className="grid grid-cols-5">
                  {NAV.filter((n) => MOBILE_TABS.includes(n.href)).map((n) => { const a = active(n.href); return <Link key={n.href} href={n.href} className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors", a ? "text-fg" : "muted")}>{a && <m.span layoutId="mobile-active" className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" transition={T.layout} />}<m.span whileTap={{ scale: 0.85 }} className="inline-flex"><n.icon size={20} strokeWidth={a ? 2.2 : 1.8} /></m.span>{n.label}</Link>; })}
                  <button onClick={() => setMenu(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium muted"><Menu size={20} strokeWidth={1.8} />More</button>
                </div>
              </nav>
            </div>
          </div>
          <QuickEntry open={quick} onClose={() => setQuick(false)} />
          <CommandPalette open={palette} onClose={() => setPalette(false)} onQuick={() => { setPalette(false); setQuick(true); }} />
        </ShellCtx.Provider>
      </ToastProvider>
    </MotionProvider>
  );
}
