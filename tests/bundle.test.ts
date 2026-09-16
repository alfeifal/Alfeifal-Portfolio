/**
 * Phase 3.11 — the shared client bundle.
 *
 * Every page of this app downloads the same Shell, the same design system and the same motion
 * language before it can hydrate. Two things were taken out of that path: Motion's imperative
 * animation engine (imported for one 600 ms count-up) and the two overlays nobody sees until they
 * press a shortcut. Both are easy to put back by accident — a stray `import { animate }`, a static
 * import of `QuickEntry` — and neither would fail a build or a type-check. These tests are the guard.
 *
 * They also pin the two properties the change must not cost: the overlays stay mounted once opened
 * (so their exit animations still play) and no server module may ride along into a client chunk.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cubicBezier, clamp01 } from "@/components/motion/ease";
import { EASE, DUR } from "@/components/motion/tokens";
import { NAV, MOBILE_TABS } from "@/components/nav";

const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/* ------------------------------------------------------------------ the easing curve */

describe("cubicBezier: the count-up runs the same curve Motion ran", () => {
  const ease = cubicBezier(...EASE.out);

  it("pins the ends exactly", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it("never runs backwards", () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = ease(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("stays inside 0..1 for the whole curve", () => {
    for (let i = 0; i <= 100; i++) {
      const v = ease(i / 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("clamps input outside the timeline instead of extrapolating", () => {
    expect(ease(-2)).toBe(0);
    expect(ease(5)).toBe(1);
    expect(clamp01(-0.1)).toBe(0);
    expect(clamp01(1.1)).toBe(1);
  });

  it("solves a curve with a known answer", () => {
    // ease-in-out (0.42, 0, 0.58, 1) is symmetric: halfway through time is halfway through distance.
    const inOut = cubicBezier(0.42, 0, 0.58, 1);
    expect(inOut(0.5)).toBeCloseTo(0.5, 3);
    // …and symmetric about that midpoint.
    expect(inOut(0.25) + inOut(0.75)).toBeCloseTo(1, 2);
  });

  it("returns the identity for a linear curve without solving anything", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const t of [0, 0.13, 0.5, 0.77, 1]) expect(linear(t)).toBeCloseTo(t, 10);
  });

  it("is an ease-out: most of the distance is covered in the first half", () => {
    expect(ease(0.5)).toBeGreaterThan(0.5);
  });
});

/* ------------------------------------------------------------------ what may live in the shared chunk */

describe("the shared motion module stays free of the imperative engine", () => {
  const motion = read("components/motion/index.tsx");

  it("does not import Motion's `animate`", () => {
    const imports = /import \{([^}]*)\} from "motion\/react";/.exec(motion);
    expect(imports).not.toBeNull();
    const named = imports![1].split(",").map((s) => s.trim());
    expect(named).not.toContain("animate");
    expect(named).not.toContain("useAnimate");
    expect(named).not.toContain("animateMini");
  });

  it("still loads the small feature set, not `domMax`", () => {
    expect(motion).toContain("domAnimation");
    expect(motion).not.toContain("domMax");
  });

  it("drives the count-up from the frame loop and cleans it up", () => {
    expect(motion).toContain("requestAnimationFrame");
    expect(motion).toContain("cancelAnimationFrame");
  });

  it("still honours prefers-reduced-motion before animating anything", () => {
    expect(motion).toContain("useReducedMotion");
    expect(motion).toMatch(/if \(reduced \|\| !Number\.isFinite\(value\)\)/);
  });

  it("uses the shared duration and easing tokens rather than hard-coded numbers", () => {
    expect(motion).toContain("duration = DUR.number");
    expect(motion).toContain("cubicBezier(...EASE.out)");
    expect(DUR.number).toBeGreaterThan(0);
    expect(EASE.out).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ the Shell */

describe("the Shell keeps the overlays off the first-load path", () => {
  const shell = read("components/shell/Shell.tsx");

  it("imports Quick entry and the command palette on demand", () => {
    expect(shell).not.toMatch(/import \{ QuickEntry \} from "\.\/QuickEntry"/);
    expect(shell).not.toMatch(/import \{ CommandPalette \} from "\.\/CommandPalette"/);
    expect(shell).toMatch(/const QuickEntry = dynamic\(/);
    expect(shell).toMatch(/const CommandPalette = dynamic\(/);
  });

  it("mounts them as soon as the browser is idle, not only when they open", () => {
    // Gating purely on `open` would unmount them on close and kill the exit animation.
    expect(shell).toContain("requestIdleCallback");
    expect(shell).toMatch(/\(overlays \|\| quick\) && <QuickEntry/);
    expect(shell).toMatch(/\(overlays \|\| palette\) && <CommandPalette/);
  });

  it("falls back to the next frame where requestIdleCallback is missing", () => {
    expect(shell).toContain("requestAnimationFrame(() => setOverlays(true))");
    expect(shell).toContain("cancelAnimationFrame(frame)");
  });

  it("still opens both from the keyboard and from the header", () => {
    expect(shell).toContain('e.key.toLowerCase() === "k"');
    expect(shell).toContain('e.key.toLowerCase() === "j"');
    expect(shell).toContain("openQuick: () => setQuick(true)");
    expect(shell).toContain("openPalette: () => setPalette(true)");
  });

  it("keeps the notification badge, the mobile menu and the sidebar toggle", () => {
    expect(shell).toContain("/api/notifications?limit=1");
    expect(shell).toContain('aria-label="Menu"');
    expect(shell).toContain('localStorage.setItem("pos-sidebar"');
  });

  it("still wraps everything in the motion and toast providers", () => {
    expect(shell).toContain("<MotionProvider>");
    expect(shell).toContain("<ToastProvider>");
    expect(shell).toContain("<PageTransition");
  });

  it("navigates with next/link, so the Shell is never re-downloaded", () => {
    expect(shell).toContain('import Link from "next/link"');
    expect(shell).not.toContain("window.location.assign");
  });
});

describe("the navigation registry is intact", () => {
  it("lists every module exactly once", () => {
    const hrefs = NAV.map((n) => n.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.length).toBeGreaterThanOrEqual(20);
  });
  it("every mobile tab is a real nav entry", () => {
    for (const href of MOBILE_TABS) expect(NAV.some((n) => n.href === href)).toBe(true);
  });
  it("every entry has an icon and a group", () => {
    for (const n of NAV) {
      expect(n.icon).toBeTruthy();
      expect(["core", "life", "money", "learn", "system"]).toContain(n.group);
    }
  });
});

/* ------------------------------------------------------------------ the client/server boundary */

describe("no server module rides into the client bundle", () => {
  const clientFiles = walk(SRC).filter((p) => !p.includes(`${join("src", "server")}`) && !p.includes("/api/") && readFileSync(p, "utf8").startsWith('"use client"'));

  it("finds the client components to check", () => {
    expect(clientFiles.length).toBeGreaterThan(20);
  });

  it("only the wire-format module is imported from @/server, and only as protocol", () => {
    const offenders: string[] = [];
    for (const p of clientFiles) {
      const body = readFileSync(p, "utf8");
      for (const m of body.matchAll(/^import (type )?[^;]*from "(@\/server\/[^"]+)";/gm)) {
        const isType = Boolean(m[1]);
        const mod = m[2];
        if (isType) continue; // erased at compile time
        if (mod === "@/server/ai/stream") continue; // NDJSON encode/parse: no DB, no secrets, no Node APIs
        offenders.push(`${p.replace(SRC, "src")} → ${mod}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the one allowed module really is inert protocol code", () => {
    const wire = read("server/ai/stream.ts");
    expect(wire).not.toMatch(/from "@\/server\/db"/);
    expect(wire).not.toMatch(/process\.env/);
    expect(wire).not.toMatch(/from "node:/);
    expect(wire).not.toMatch(/drizzle|anthropic|cookies\(\)/i);
  });
});

/* ------------------------------------------------------------------ what must stay out of the Shell */

describe("the Shell chunk does not grow back", () => {
  const shell = read("components/shell/Shell.tsx");

  it("does not pull the AI stream client or the search renderer directly", () => {
    expect(shell).not.toContain("@/lib/ai-stream");
    expect(shell).not.toContain("@/components/search/results");
    expect(shell).not.toContain("@/components/ai/ActionList");
  });

  it("imports only the icons it draws", () => {
    const icons = /import \{([^}]*)\} from "lucide-react";/.exec(shell);
    expect(icons).not.toBeNull();
    expect(icons![1].split(",").length).toBeLessThanOrEqual(10);
  });

  it("charts are still loaded on demand, not with the page", () => {
    const charts = read("components/charts.tsx");
    expect(charts).toContain("next/dynamic");
    expect(charts).not.toContain('from "recharts"');
  });
});
