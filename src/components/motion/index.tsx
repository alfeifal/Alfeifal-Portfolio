"use client";
import { LazyMotion, MotionConfig, domAnimation, m, AnimatePresence, useReducedMotion, animate, useInView } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DUR, STAGGER, T, V } from "./tokens";

export { m, AnimatePresence, useReducedMotion };
export * from "./tokens";

/** Wrap once at the app root: loads the small `domAnimation` feature set and honours prefers-reduced-motion. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={T.enter}>{children}</MotionConfig>
    </LazyMotion>
  );
}

type Variant = keyof typeof V;
interface FadeProps { children: ReactNode; className?: string; variant?: Variant; delay?: number; as?: "div" | "section" | "li" | "span" | "ul" | "article" }

/** Single element entrance (opacity + tiny rise by default). */
export function FadeIn({ children, className, variant = "rise", delay = 0, as = "div" }: FadeProps) {
  const Tag = m[as];
  return (
    <Tag className={className} variants={V[variant]} initial="hidden" animate="visible" transition={{ ...T.enter, delay }}>
      {children}
    </Tag>
  );
}

/** Parent that staggers its `StaggerItem` children. */
export function Stagger({ children, className, gap = STAGGER.base, delay = 0, as = "div" }: { children: ReactNode; className?: string; gap?: number; delay?: number; as?: "div" | "ul" | "section" | "ol" }) {
  const Tag = m[as];
  return (
    <Tag className={className} initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: gap, delayChildren: delay } } }}>
      {children}
    </Tag>
  );
}
export function StaggerItem({ children, className, variant = "rise", as = "div", layout }: FadeProps & { layout?: boolean }) {
  const Tag = m[as];
  return (
    <Tag className={className} variants={V[variant]} transition={T.enter} layout={layout}>
      {children}
    </Tag>
  );
}

/** Route-level transition: re-mounts on pathname change with a short rise. No exit (keeps navigation instant). */
export function PageTransition({ children, id }: { children: ReactNode; id: string }) {
  return (
    <m.div key={id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.base, ease: T.enter.ease }} className="min-h-full">
      {children}
    </m.div>
  );
}

/** Animated list: items enter with a stagger and exit smoothly when removed. Use `key` on children. */
export function AnimatedList({ children, className, as = "ul" }: { children: ReactNode; className?: string; as?: "ul" | "div" | "ol" }) {
  const Tag = m[as];
  return (
    <Tag className={className} initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: STAGGER.fast } } }}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </Tag>
  );
}
export function AnimatedItem({ children, className, as = "li" }: { children: ReactNode; className?: string; as?: "li" | "div" }) {
  const Tag = m[as];
  return (
    <Tag layout="position" className={className} variants={V.riseSm} initial="hidden" animate="visible" exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0, transition: T.exit }} transition={T.enter}>
      {children}
    </Tag>
  );
}

/** Fast count-up for important metrics only. Formats via `format`; respects reduced motion. */
export function AnimatedNumber({ value, format = (v) => String(Math.round(v)), className, duration = DUR.number }: { value: number; format?: (v: number) => string; className?: string; duration?: number }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const [text, setText] = useState(() => format(reduced ? value : 0));
  useEffect(() => {
    if (reduced || !Number.isFinite(value)) { setText(format(value)); from.current = value; return; }
    const controls = animate(from.current, value, { duration, ease: T.enter.ease, onUpdate: (v) => setText(format(v)) });
    from.current = value;
    return () => controls.stop();
  }, [value, reduced]);
  return <span ref={ref} className={className}>{text}</span>;
}

/** Presence wrapper for overlays (modals, dropdowns, toasts). */
export function Presence({ show, children }: { show: boolean; children: ReactNode }) {
  return <AnimatePresence>{show ? children : null}</AnimatePresence>;
}

/** Reveal when scrolled into view (charts, lower sections). */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  return (
    <m.div ref={ref} className={className} initial={{ opacity: 0, y: 8 }} animate={inView ? { opacity: 1, y: 0 } : undefined} transition={T.enter}>
      {children}
    </m.div>
  );
}

/** Press feedback for any clickable wrapper. */
export const press = { whileTap: { scale: 0.98 }, transition: T.state } as const;
export const hoverLift = { whileHover: { y: -1 }, whileTap: { scale: 0.995 }, transition: T.state } as const;
