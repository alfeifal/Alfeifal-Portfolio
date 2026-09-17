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
