/**
 * Phase 3.13 — the app has to behave the same way in every module.
 *
 * The audit found the same operation done three different ways: deleting a task opened the app's own
 * confirmation, deleting a trade called `window.confirm`, and deleting a memory asked nothing at all.
 * Editing one value was a `window.prompt` in nine places — unstyled, unvalidated, no loading state,
 * and silent when the save failed — while every other edit in the app is a Modal with a Field.
 *
 * These tests pin the result: no native dialogs anywhere, one confirmation primitive, one
 * single-value edit primitive, and every destructive action confirmed and acknowledged.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { allTools } from "@/server/ai/registry";
import "@/server/ai/tools";

const ROOT = process.cwd();
const walk = (dir: string, out: string[] = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const uiFiles = [...walk(join(ROOT, "src/app")), ...walk(join(ROOT, "src/components"))]
  .filter((p) => p.endsWith(".tsx") && !p.includes("/modules/german/"));

/** Every component source, read once: several checks below sweep the whole surface. */
const sources = (() => {
  let cache: [string, string][] | null = null;
  return () => (cache ??= uiFiles.map((f) => [relative(ROOT, f), readFileSync(f, "utf8")] as [string, string]));
})();

/**
 * Is this element inside a `<Field label=…>` or a `<label>` that names it?
 *
 * Containment, not proximity: a fixed look-back window got this wrong for the shared prompt, whose
 * `<Field>` opens well over 260 characters before the input it wraps. This finds the nearest preceding
 * labelled opener and only accepts it if nothing closed in between.
 */
const namedByWrapper = (src: string, at: number) => {
  const before = src.slice(0, at);
  const opener = Math.max(before.lastIndexOf("<Field label="), before.lastIndexOf("<Field\n"), before.lastIndexOf("<label"));
  if (opener === -1) return false;
  const between = before.slice(opener);
  if (/<\/Field>|<\/label>/.test(between)) return false;
  return /^<Field\s+label=|^<label/.test(between);
};

describe("no module falls back to a browser dialog", () => {
  it("nothing calls window.prompt", () => {
    const offenders = uiFiles.filter((p) => /(?<![.\w])prompt\s*\(/.test(readFileSync(p, "utf8").replace(/placeholder=/g, "")));
    expect(offenders.map((p) => relative(ROOT, p))).toEqual([]);
  });

  it("nothing calls window.confirm or window.alert", () => {
    const offenders = uiFiles.filter((p) => {
      const src = readFileSync(p, "utf8");
      return /window\.(confirm|alert)\s*\(/.test(src)
        // a bare confirm(...) that is not the hook's `confirm(async …)` / `confirm(() => …)`
        || /(?<![.\w])confirm\s*\(\s*["'`]/.test(src)
        || /(?<![.\w)])alert\s*\(\s*["'`]/.test(src);
    });
    expect(offenders.map((p) => relative(ROOT, p))).toEqual([]);
  });
});

describe("one confirmation primitive, and it reports failure", () => {
  const ui = read("src/components/ui/index.tsx");

  it("ConfirmDialog shows the error instead of swallowing it", () => {
    const body = ui.slice(ui.indexOf("export function ConfirmDialog"), ui.indexOf("export function useConfirm"));
    expect(body).toContain("catch");
    expect(body).toContain('role="alert"');
    // The dialog stays open on failure so the action can be retried.
    expect(body).toMatch(/catch[\s\S]{0,120}setError/);
  });

  it("its buttons cannot be pressed twice", () => {
    const body = ui.slice(ui.indexOf("export function ConfirmDialog"), ui.indexOf("export function useConfirm"));
    expect(body).toContain("loading={busy}");
    expect(body).toContain("disabled={busy}");
  });

  it("resets between openings without an effect", () => {
    const body = ui.slice(ui.indexOf("export function ConfirmDialog"), ui.indexOf("export function useConfirm"));
    expect(body).toContain("wasOpen");
    expect(body).not.toContain("useEffect");
  });
});

describe("one primitive for editing a single value", () => {
  const ui = read("src/components/ui/index.tsx");
  const body = ui.slice(ui.indexOf("export function usePrompt"));

  it("exists and is exported", () => {
    expect(ui).toContain("export function usePrompt");
  });

  it("has the states a prompt never had: loading, error, validation", () => {
    expect(body).toContain("loading={busy}");
    expect(body).toContain("setError");
    expect(body).toContain("required={state?.required}");
    expect(body).toContain("error={error}");
  });

  it("supports the field kinds the call sites need", () => {
    for (const kind of ["text", "number", "date", "textarea"]) expect(body).toContain(`"${kind}"`);
  });

  it("is what the modules actually use", () => {
    const users = uiFiles.filter((p) => !p.endsWith("components/ui/index.tsx") && readFileSync(p, "utf8").includes("usePrompt()"));
    expect(users.length).toBeGreaterThanOrEqual(7);
    // Every one of them renders the dialog it creates, or the edit would never appear.
    for (const p of users) {
      const src = readFileSync(p, "utf8");
      expect(src, relative(ROOT, p)).toMatch(/\{promptDialog\}/);
    }
  });
});

describe("destructive actions are confirmed and acknowledged", () => {
  const cases: [string, string][] = [
    ["src/app/(app)/settings/page.tsx", "/api/ai/memory/"],
    ["src/app/(app)/trading/page.tsx", "/api/trading/alerts/"],
    ["src/app/(app)/trading/page.tsx", "/api/trading/strategies/"],
    ["src/app/(app)/trading/page.tsx", "/api/trading/watchlist/"],
    ["src/app/(app)/trading/journal/[id]/page.tsx", "/api/trading/trades/"],
    ["src/app/(app)/trading/academy/page.tsx", "/api/academy/lessons/"],
    ["src/app/(app)/training/sessions/[id]/page.tsx", "/api/training/sessions/"],
    ["src/app/(app)/training/routine/page.tsx", "/api/training/day-exercises/"],
  ];

  for (const [file, path] of cases) {
    it(`${file.replace("src/app/(app)/", "")} confirms before deleting`, () => {
      const src = read(file);
      // Look at the window around each DELETE call, and check the one that targets this path.
      const windows: string[] = [];
      for (let i = src.indexOf('method: "DELETE"'); i > -1; i = src.indexOf('method: "DELETE"', i + 1)) {
        windows.push(src.slice(Math.max(0, i - 900), i + 500));
      }
      const mine = windows.filter((w) => w.includes(path));
      expect(mine.length, `${file} no longer deletes ${path}`).toBeGreaterThan(0);
      for (const w of mine) {
        expect(w, `${file} deletes ${path} without a confirmation`).toContain("confirm(");
        expect(w, `${file} deletes ${path} without telling the user`).toContain("toast.");
      }
    });
  }

  it("every page that confirms also renders the dialog", () => {
    for (const p of uiFiles) {
      const src = readFileSync(p, "utf8");
      if (p.endsWith("components/ui/index.tsx") || !src.includes("useConfirm()")) continue;
      expect(src, relative(ROOT, p)).toMatch(/\{(dialog|confirmDialog)\}/);
    }
  });
});

describe("empty states say what to do next", () => {
  // The first screen a brand new account sees: every widget that can be empty offers a way forward.
  const home = read("src/app/(app)/home-client.tsx");
  const widgets = ["No active projects", "Nothing recorded yet", "No trades or watched symbols", "No transactions yet", "No active goals", "No workouts logged yet", "No headlines cached yet", "No plan yet"];

  for (const copy of widgets) {
    it(`Home: "${copy}" offers a next step`, () => {
      const at = home.indexOf(copy);
      expect(at, `Home no longer says "${copy}"`).toBeGreaterThan(-1);
      const rest = home.slice(at, at + 400);
      expect(rest, `"${copy}" is a dead end`).toMatch(/<Link|href=/);
    });
  }

  // The modules phase 3.13 names: their empty state has to explain what is missing and what to do,
  // not just state the absence. Chart placeholders and analytics tables are exempt — terse is right
  // there, and they are never the first thing an empty account meets.
  const NAMED = [
    "tasks", "finance", "training", "nutrition", "studies", "goals", "projects",
    "journal", "reviews", "investing", "trading", "notifications", "search", "planner", "assistant",
  ];
  it("none of the named modules ships a bare full stop as a section's empty state", () => {
    const bare = /<p className="text-sm muted">No [a-z ]{1,24}\.<\/p>/;
    const offenders = uiFiles
      .filter((p) => NAMED.some((m) => relative(ROOT, p).startsWith(`src/app/(app)/${m}`)))
      .filter((p) => bare.test(readFileSync(p, "utf8")));
    expect(offenders.map((p) => relative(ROOT, p))).toEqual([]);
  });
});

describe("accounts can be corrected, not only created and destroyed", () => {
  it("a trading account is editable everywhere it exists", () => {
    expect(read("src/server/services/trading.ts")).toContain("export async function updateTradingAccount");
    expect(read("src/app/api/trading/_handlers.ts")).toMatch(/trading\.accounts[\s\S]{0,400}update:/);
    expect(read("src/app/(app)/trading/page.tsx")).toContain("setEditingAccount");
    expect(allTools().map((t) => t.name)).toContain("update_trading_account");
  });

  it("an investment account is editable everywhere it exists", () => {
    expect(read("src/server/services/investing.ts")).toContain("export async function updateInvestmentAccount");
    expect(read("src/app/api/investing/_handlers.ts")).toMatch(/investing\.accounts[\s\S]{0,400}update:/);
    expect(read("src/app/(app)/investing/page.tsx")).toContain("setEditingAccount");
    expect(allTools().map((t) => t.name)).toContain("update_investment_account");
  });

  it("what must not be editable, is not", () => {
    // Flipping an account's mode would move its whole history across the simulated/real line, and a
    // settable cash balance would contradict the transactions it is derived from.
    const trading = read("src/server/services/trading.ts");
    expect(trading).toContain('tradingAccountSchema.omit({ mode: true })');
    const investing = read("src/server/services/investing.ts");
    expect(investing).toContain('invAccountSchema.omit({ cashBalance: true })');
  });

  it("the new tools take an id and get their owner from the session", () => {
    for (const name of ["update_trading_account", "update_investment_account"]) {
      const tool = allTools().find((t) => t.name === name)!;
      expect(tool.risk).toBe("low");
      const shape = (tool.schema as { shape?: Record<string, unknown> }).shape!;
      expect(Object.keys(shape)).toContain("id");
      expect(Object.keys(shape)).not.toContain("userId");
    }
  });
});

describe("settings shows the account itself", () => {
  const settings = read("src/app/(app)/settings/page.tsx");

  it("reports role and status", () => {
    expect(settings).toContain('title="Account"');
    expect(settings).toContain("Administrator");
    expect(settings).toContain("d.isActive");
    expect(settings).toContain("d.lastLoginAt");
  });

  it("a plain user is told administration is not theirs, without an admin control", () => {
    expect(settings).toContain("Only an administrator can create or disable accounts");
    // The admin link only renders for an admin.
    expect(settings).toMatch(/d\.role === "admin"[\s\S]{0,200}href="\/admin"/);
  });
});

/**
 * Phase 3.24 — what the accessibility audit fixed, pinned where a test can see it.
 *
 * The audit itself is `scripts/a11y-audit.mjs`: it needs a browser and a running build, so it cannot
 * live here. These tests guard the parts of its findings that are visible in the source — the colour
 * tokens it measured, and the attributes it found missing — so a regression shows up in CI, where the
 * audit cannot run. They are not a substitute for re-running the audit; the audit is what measures.
 */
describe("the contrast the audit measured is the contrast the tokens encode", () => {
  const css = () => readFileSync("src/app/globals.css", "utf8");

  /** WCAG relative luminance and contrast ratio, from the spec. */
  const lum = (r: number, g: number, b: number) => {
    const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: [number, number, number], b: [number, number, number]) => {
    const [hi, lo] = [lum(...a), lum(...b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const token = (name: string, block: "light" | "dark") => {
    const text = css();
    const start = block === "light" ? text.indexOf(":root {") : text.indexOf(".dark {");
    const slice = text.slice(start, text.indexOf("}", start));
    const m = slice.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
    if (!m) throw new Error(`token --${name} not found in the ${block} block`);
    return [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  };

  it("muted text clears 4.5:1 on every light surface it sits on", () => {
    // The ⌘K hint in the header is 10px muted text on --surface-2, which is the tightest pairing.
    // It measured 4.43 before this phase; axe flagged it on all 25 routes.
    const muted = token("muted", "light");
    for (const bg of ["surface", "surface-2", "bg"] as const) {
      expect(ratio(muted, token(bg, "light")), `--muted on --${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("warning text clears 4.5:1 while the fill colour stays the fill colour", () => {
    // 3.25:1 before: --warning is an amber chosen to work as a tinted background, and it was also
    // being used for words. --warning-ink is the text companion; --warning itself did not change.
    expect(ratio(token("warning-ink", "light"), token("surface", "light"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token("warning", "light"), token("surface", "light"))).toBeLessThan(4.5); // unchanged, on purpose
  });

  it("muted and warning text clear 4.5:1 in dark mode too", () => {
    for (const name of ["muted", "warning-ink"] as const) {
      for (const bg of ["surface", "surface-2", "bg"] as const) {
        expect(ratio(token(name, "dark"), token(bg, "dark")), `--${name} on --${bg} (dark)`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("nothing paints words with the raw warning fill any more", () => {
    const offenders = sources().filter(([, src]) => /\btext-warning\b(?!-ink)/.test(src));
    expect(offenders.map(([f]) => f)).toEqual([]);
  });

  it("the German scope does not re-introduce the old muted colour", () => {
    // Values only: the comment above --muted names the old colour on purpose.
    const withoutComments = css().replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/#6B6F7B/i);
  });
});

describe("controls the audit found nameless now have names", () => {
  const named = (file: string, needle: string) => {
    const src = readFileSync(file, "utf8");
    const i = src.indexOf(needle);
    expect(i, `${needle} not found in ${file}`).toBeGreaterThan(-1);
    // The attribute has to be on the element itself, not merely somewhere in the file.
    const tagStart = src.lastIndexOf("<", i);
    const tag = src.slice(tagStart, src.indexOf(">", i) + 1);
    expect(tag, `${file}: ${needle}`).toMatch(/aria-label=/);
  };

  it("every date and month field the audit flagged has an accessible name", () => {
    named("src/app/(app)/finance/page.tsx", 'type="month"');
    named("src/app/(app)/nutrition/page.tsx", 'type="date" aria-label');
    named("src/app/(app)/training/page.tsx", 'type="date" aria-label');
  });

  it("every select the audit flagged has an accessible name", () => {
    named("src/app/(app)/calendar/page.tsx", 'value={view}');
    named("src/app/(app)/settings/page.tsx", 'value={mem.kind}');
  });

  it("the two navigation landmarks are distinguishable", () => {
    const shell = readFileSync("src/components/shell/Shell.tsx", "utf8");
    const labels = [...shell.matchAll(/<nav aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(new Set(labels).size).toBe(labels.length); // landmark-unique
  });

  it("no placeholder is an element's only accessible name", () => {
    /*
     * A placeholder disappears on the first keystroke, so it is not a label. But a name can come from
     * more than one place, and this test's first version only accepted `aria-label` — which led me to
     * bolt one onto fields that a wrapping `<Field label="Tags">` already named. That is worse than
     * doing nothing: `aria-label` *overrides* the visible label for assistive technology, so the two
     * can silently diverge. The rule is "has a name from some source", and a labelled wrapper counts.
     */
    const offenders: string[] = [];
    for (const [file, src] of sources()) {
      for (const m of src.matchAll(/<(input|textarea)\b[^>]*>/g)) {
        if (!/placeholder=/.test(m[0])) continue;
        const own = /aria-label|aria-labelledby/.test(m[0]);
        if (!own && !namedByWrapper(src, m.index!)) offenders.push(`${file}: ${m[0].replace(/\s+/g, " ").slice(0, 100)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a field named by a wrapping Field does not also carry an aria-label", () => {
    // The override above, caught the other way round: two names for one control is a divergence
    // waiting to happen, and the one assistive technology reads is not the one on screen.
    const doubled: string[] = [];
    for (const [file, src] of sources()) {
      for (const m of src.matchAll(/<(input|textarea)\b[^>]*aria-label=[^>]*>/g)) {
        if (namedByWrapper(src, m.index!)) {
          doubled.push(`${file}: ${m[0].replace(/\s+/g, " ").slice(0, 100)}`);
        }
      }
    }
    expect(doubled).toEqual([]);
  });
});

describe("a list only contains list items", () => {
  it("no <ul> renders a bare <p> as a child", () => {
    // Two empty states were written inside their list, which made the list stop being a list.
    for (const [file, src] of sources()) {
      for (const m of src.matchAll(/<ul\b[^>]*>/g)) {
        const tail = src.slice(m.index! + m[0].length, m.index! + m[0].length + 400);
        expect(/^\s*(\{[^<]*)?<p\b/.test(tail), `${file}: ${m[0]}`).toBe(false);
      }
    }
  });
});
