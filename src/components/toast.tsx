"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, X, AlertCircle, Info } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { T } from "./motion/tokens";
import { cn } from "@/lib/utils";

export type ToastKind = "success" | "error" | "info";
interface Toast { id: number; kind: ToastKind; title: string; description?: string; action?: { label: string; onClick: () => void } }
interface Api {
  push: (t: Omit<Toast, "id">) => number;
  success: (title: string, description?: string, action?: Toast["action"]) => number;
  error: (title: string, description?: string) => number;
  info: (title: string, description?: string) => number;
  dismiss: (id: number) => void;
}
const Ctx = createContext<Api | null>(null);

/** Consistent, unobtrusive feedback: "Expense added ✓". Auto-dismisses; errors stay a bit longer. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current;
    setToasts((list) => [...list.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), t.kind === "error" ? 6000 : 3200);
    return id;
  }, [dismiss]);
  const api = useMemo<Api>(() => ({ push, dismiss, success: (title, description, action) => push({ kind: "success", title, description, action }), error: (title, description) => push({ kind: "error", title, description }), info: (title, description) => push({ kind: "info", title, description }) }), [push, dismiss]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <m.div key={t.id} layout initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.98, transition: T.exit }} transition={T.enter} className={cn("pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-2.5 text-sm shadow-lg shadow-black/10", t.kind === "error" ? "border-negative/40" : "border-border")}>
              <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", t.kind === "success" && "bg-positive/15 text-positive", t.kind === "error" && "bg-negative/15 text-negative", t.kind === "info" && "bg-surface-2 text-muted")}>
                {t.kind === "success" ? <Check size={12} strokeWidth={3} /> : t.kind === "error" ? <AlertCircle size={13} /> : <Info size={13} />}
              </span>
              <span className="min-w-0 flex-1"><span className="block font-medium">{t.title}</span>{t.description && <span className="block text-xs muted">{t.description}</span>}</span>
              {t.action && <button className="text-xs font-medium underline-offset-2 hover:underline" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button>}
              <button className="rounded p-0.5 muted hover:text-fg" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={13} /></button>
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
