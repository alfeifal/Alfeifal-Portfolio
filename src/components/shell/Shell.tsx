"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Bell, Menu, Search, Zap } from "lucide-react";
import { NAV, MOBILE_TABS } from "@/components/nav";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client";
import { QuickEntry } from "./QuickEntry";
import { SearchDialog } from "./SearchDialog";

interface ShellUser { name: string; email: string; currency: string }
const ShellCtx = createContext<{ user: ShellUser; aiConfigured: boolean; unread: number; refreshUnread: () => void }>({ user: { name: "", email: "", currency: "EUR" }, aiConfigured: false, unread: 0, refreshUnread: () => {} });
export const useShell = () => useContext(ShellCtx);

export function Shell({ user, aiConfigured, children }: { user: ShellUser; aiConfigured: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [quick, setQuick] = useState(false);
  const [search, setSearch] = useState(false);
  const [unread, setUnread] = useState(0);
  const refreshUnread = () => api<{ unread: number }>("/api/notifications?limit=1").then((r) => setUnread(r.unread)).catch(() => {});
  useEffect(() => { refreshUnread(); const t = setInterval(refreshUnread, 120000); return () => clearInterval(t); }, []);
  useEffect(() => { setMenu(false); }, [pathname]);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearch(true); } if ((e.metaKey || e.ctrlKey) && e.key === "j") { e.preventDefault(); setQuick(true); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); };
  const groups: { key: (typeof NAV)[number]["group"]; label: string }[] = [{ key: "core", label: "" }, { key: "money", label: "Money" }, { key: "life", label: "Life" }, { key: "learn", label: "Learning" }, { key: "system", label: "System" }];

  const sidebar = (
    <nav className="flex h-full flex-col">
      <Link href="/" className="mb-4 px-2 text-lg font-semibold tracking-tight">Personal<span className="muted">OS</span></Link>
      <div className="flex-1 space-y-4 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.key}>
            {g.label && <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide muted">{g.label}</p>}
            <div className="space-y-0.5">
              {NAV.filter((n) => n.group === g.key).map((n) => (
                <Link key={n.href} href={n.href} className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm", active(n.href) ? "bg-accent text-accent-fg" : "hover:bg-surface-2")}>
                  <n.icon size={16} strokeWidth={1.8} />{n.label}
                  {n.href === "/notifications" && unread > 0 && <span className="ml-auto rounded-full bg-negative px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-border pt-3 text-xs muted">
        <p className="truncate font-medium text-fg">{user.name}</p>
        <p className="truncate">{user.email}</p>
        <button className="link mt-1" onClick={logout}>Sign out</button>
      </div>
    </nav>
  );

  return (
    <ShellCtx.Provider value={{ user, aiConfigured, unread, refreshUnread }}>
      <div className="min-h-screen md:flex">
        <aside className="hidden w-60 shrink-0 border-r border-border bg-surface p-3 md:sticky md:top-0 md:block md:h-screen">{sidebar}</aside>
        {menu && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMenu(false)}><aside className="h-full w-72 bg-surface p-3 safe-t" onClick={(e) => e.stopPropagation()}>{sidebar}</aside></div>}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-bg/90 px-3 py-2 backdrop-blur safe-t">
            <button className="btn-ghost btn-sm md:hidden" onClick={() => setMenu(true)} aria-label="Menu"><Menu size={18} /></button>
            <button onClick={() => setSearch(true)} className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm muted"><Search size={15} /><span className="flex-1">Search everything…</span><kbd className="hidden text-[10px] md:inline">⌘K</kbd></button>
            <button onClick={() => setQuick(true)} className="btn-primary btn-sm" title="Quick entry (⌘J)"><Zap size={14} /><span className="hidden sm:inline">Quick entry</span></button>
            <Link href="/notifications" className="btn-ghost btn-sm relative" aria-label="Notifications"><Bell size={16} />{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-negative px-1.5 text-[10px] font-semibold text-white">{unread}</span>}</Link>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-10">{children}</main>
          <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur safe-b md:hidden">
            <div className="grid grid-cols-5">
              {NAV.filter((n) => MOBILE_TABS.includes(n.href)).map((n) => <Link key={n.href} href={n.href} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active(n.href) ? "text-fg" : "muted")}><n.icon size={20} strokeWidth={1.8} />{n.label}</Link>)}
              <button onClick={() => setMenu(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium muted"><Menu size={20} strokeWidth={1.8} />More</button>
            </div>
          </nav>
        </div>
      </div>
      <QuickEntry open={quick} onClose={() => setQuick(false)} />
      <SearchDialog open={search} onClose={() => setSearch(false)} />
    </ShellCtx.Provider>
  );
}
