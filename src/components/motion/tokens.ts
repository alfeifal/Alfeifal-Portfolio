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

/**
 * How long a whole list is allowed to take to finish arriving, in seconds.
 *
 * A fixed per-item gap makes the entrance as long as the list. `/news` asks for 120 items at a 20 ms
 * gap, so the last row only started fading in at 2.4 s — measured, and measured twice: an axe run that
 * sampled the page at 1.5 s reported 18 colour-contrast failures that were simply rows still at low
 * opacity. The page is not broken, but a row that takes two and a half seconds to become readable is
 * not "unnoticeable", which is the rule this motion language sets for itself.
 *
 * Motion's `reducedMotion="user"` does not rescue it either: by design it drops transforms and keeps
 * opacity, because a fade is not a vestibular trigger. So the stagger plays for everybody.
 */
export const STAGGER_BUDGET = 0.4;

/**
 * The per-item gap to actually use, given how many items there are.
 *
 * Short lists keep the gap they asked for — the stagger is the point, and 8 rows at 50 ms is 350 ms.
 * Long lists compress so the last item still starts within the budget. Bounding the total rather than
 * capping the count means no list has an invisible tail, and no call site has to know how long it is.
 */
export function staggerGap(gap: number, count: number): number {
  if (count <= 1 || gap <= 0) return gap;
  const lastStartsAt = (count - 1) * gap;
  return lastStartsAt <= STAGGER_BUDGET ? gap : STAGGER_BUDGET / (count - 1);
}
