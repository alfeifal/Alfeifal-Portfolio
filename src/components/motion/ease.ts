/**
 * Cubic-bézier solver for the curves in `EASE`.
 *
 * The count-up in `AnimatedNumber` used to come from Motion's imperative `animate()`. That single
 * import pulled Motion's whole animation engine into the chunk every page loads (measured: 13.1 kB
 * raw / 5.0 kB gzip on every route) for one 600 ms number transition. Solving the same curve here
 * keeps the animation identical and leaves the engine out of the shared bundle.
 *
 * Same maths the browser and Motion use: a unit bézier with control points (x1,y1) and (x2,y2),
 * P0 = (0,0) and P3 = (1,1). `x` is the elapsed fraction, the result is the eased fraction.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  // A curve whose control points sit on the diagonal is the identity — skip the solver.
  if (x1 === y1 && x2 === y2) return (t) => clamp01(t);
  return (t) => {
    const x = clamp01(t);
    if (x === 0 || x === 1) return x;
    // Binary subdivision on x: bounded iterations, no derivative, always converges.
    let lo = 0;
    let hi = 1;
    let guess = x;
    for (let i = 0; i < 24; i++) {
      guess = (lo + hi) / 2;
      if (bezier(x1, x2, guess) < x) lo = guess;
      else hi = guess;
    }
    return bezier(y1, y2, guess);
  };
}

/** One axis of the unit bézier, expanded so it costs three multiplications. */
function bezier(a: number, b: number, t: number) {
  return ((1 - 3 * b + 3 * a) * t * t + (3 * b - 6 * a) * t + 3 * a) * t;
}

export function clamp01(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
