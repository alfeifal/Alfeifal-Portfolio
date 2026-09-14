/**
 * Motion language for the whole app. One place for durations, easings and variants so every
 * surface moves the same way. Rule: fast, natural, unnoticeable — "everything responds
 * immediately, you never notice an animation".
 */
export const DUR = { instant: 0.08, fast: 0.14, base: 0.18, slow: 0.24, number: 0.6 } as const;
/** Standard "ease out" curve used for entrances; symmetric ease for state changes. */
export const EASE = { out: [0.2, 0, 0, 1] as const, inOut: [0.4, 0, 0.2, 1] as const, in: [0.4, 0, 1, 1] as const };

export const T = {
  enter: { duration: DUR.base, ease: EASE.out },
  exit: { duration: DUR.fast, ease: EASE.in },
  state: { duration: DUR.fast, ease: EASE.inOut },
  layout: { type: "spring", stiffness: 500, damping: 40, mass: 1 } as const,
} as const;

/** Variants shared by primitives. */
export const V = {
  fade: { hidden: { opacity: 0 }, visible: { opacity: 1 } },
  rise: { hidden: { opacity: 0, y: 6 }, visible: { opacity: 1, y: 0 } },
  riseSm: { hidden: { opacity: 0, y: 4 }, visible: { opacity: 1, y: 0 } },
  scale: { hidden: { opacity: 0, scale: 0.97 }, visible: { opacity: 1, scale: 1 } },
  slideRight: { hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } },
  slideUp: { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } },
} as const;

export const STAGGER = { fast: 0.03, base: 0.05, slow: 0.08 } as const;
