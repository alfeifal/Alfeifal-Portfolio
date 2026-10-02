/**
 * Accessibility audit: drives a real browser against a running build and runs axe-core on each route.
 *
 * WHY THIS AND NOT A TEST. The findings this exists to catch — colour contrast, accessible names,
 * landmark uniqueness, target size — are properties of rendered pixels and a computed accessibility
 * tree. Nothing short of a browser sees them, and the GitHub runner has no browser, so making this a
 * vitest file would mean a suite that silently skips in CI. It is a script you run, and the result is
 * recorded in docs/engineering/.
 *
 * It has no dependencies. Chromium is driven over the DevTools Protocol using Node's own WebSocket
 * (Node 22+), and axe-core is read from a path you pass in.
 *
 *   # 1. a production build, pointed at a database you do not mind it reading
 *   DATABASE_URL=... DATABASE_DRIVER=pg DATABASE_SSL=false PORT=3322 pnpm start
 *   # 2. a session cookie for an account on it
 *   curl -s -c jar -X POST localhost:3322/api/auth/login -H 'Origin: http://localhost:3322' \
 *        -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}'
 *   # 3. axe-core (any recent 4.x)
 *   curl -so /tmp/axe.js https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js
 *   # 4. the audit
 *   AXE_PATH=/tmp/axe.js BASE_URL=http://127.0.0.1:3322 SESSION_COOKIE="pos_session=..." \
 *     ROUTES="/,/tasks,/finance" REDUCED=1 SETTLE=4000 node scripts/a11y-audit.mjs
 *
 * REDUCED=1 emulates `prefers-reduced-motion: reduce`, and you want it. Without it axe measures the
 * page mid-entrance-animation and reports a dozen contrast failures that are opacity frames of one
 * element fading in — that is how this audit first mis-read /news. SETTLE is how long to wait after
 * `readyState === "complete"`; lists with a staggered entrance need several seconds without REDUCED.
 * DARK=1 audits the dark theme, and each result says whether the theme was actually applied, so a
 * silent failure to apply it cannot pass as a clean run.
 *
 * WIDTH/HEIGHT default to 1280x900; 375x812 is the phone case.
 *
 * The `unlabelled` and `smallTargets` figures are this script's own crude heuristics, kept because
 * they point at places to look. They over-report heavily — `smallTargets` counted 198 on
 * /training/routine where axe's own `target-size` rule, which implements the WCAG 2.2 exceptions,
 * found 2. Trust `violations`; treat the rest as a hint.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

// Claude Code on the web ships Chromium at PLAYWRIGHT_BROWSERS_PATH; CHROME overrides it anywhere else.
const BROWSER = process.env.CHROME
  ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome` : null)
  ?? "/usr/bin/chromium";
const AXE = readFileSync(process.env.AXE_PATH, "utf8");
const BASE = process.env.BASE_URL;
const COOKIE = process.env.SESSION_COOKIE; // "name=value"
const ROUTES = (process.env.ROUTES ?? "/").split(",");
const WIDTH = Number(process.env.WIDTH ?? 1280);
const HEIGHT = Number(process.env.HEIGHT ?? 900);

const chrome = spawn(BROWSER, [
  "--headless=new", "--remote-debugging-port=9333", "--no-sandbox", "--disable-dev-shm-usage",
  "--disable-gpu", "--hide-scrollbars", `--window-size=${WIDTH},${HEIGHT}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = "";
chrome.stderr.on("data", (d) => { chromeErr += String(d); });

async function targetUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:9333/json/version");
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch {}
    await delay(250);
  }
  throw new Error("chromium never opened a debugging port:\n" + chromeErr.slice(-800));
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.sessionId = null;
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const { ok, bad } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    const msg = { id, method, params, ...(this.sessionId ? { sessionId: this.sessionId } : {}) };
    return new Promise((ok, bad) => { this.pending.set(id, { ok, bad }); this.ws.send(JSON.stringify(msg)); });
  }
}

const ws = new WebSocket(await targetUrl());
await new Promise((ok, bad) => { ws.addEventListener("open", ok, { once: true }); ws.addEventListener("error", bad, { once: true }); });
const cdp = new Cdp(ws);
const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
cdp.sessionId = sessionId;
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 500 });

if (process.env.DARK === "1") await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('pos-theme','dark')}catch{};document.documentElement.classList.add('dark')" });
if (process.env.REDUCED === "1") await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

if (COOKIE) {
  const [name, ...rest] = COOKIE.split("=");
  await cdp.send("Network.setCookie", { name, value: rest.join("="), url: BASE, path: "/", httpOnly: true, sameSite: "Lax" });
}

const evaluate = async (expression, awaitPromise = true) => {
  const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const report = [];
for (const route of ROUTES) {
  await cdp.send("Page.navigate", { url: BASE + route });
  // Wait for the app to settle: React hydration plus any first data fetch.
  let title = "";
  for (let i = 0; i < 80; i++) {
    await delay(250);
    try { if (await evaluate("document.readyState === 'complete'")) { title = await evaluate("document.title"); break; } } catch {}
  }
  await delay(Number(process.env.SETTLE ?? 1200));
  await evaluate(AXE, false);
  const axeResult = await evaluate(`axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22a','wcag22aa','best-practice'] } }).then(r => JSON.stringify({ violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0,3).map(n => n.target.join(' ')) })) }))`);
  const extras = await evaluate(`JSON.stringify((() => {
    const scrollX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => h.tagName);
    const landmarks = [...document.querySelectorAll('main,nav,header,footer,aside,[role=main],[role=navigation]')].map(e => e.tagName.toLowerCase() + (e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''));
    const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(e => e.offsetParent !== null);
    const unlabelled = focusables.filter(e => {
      const t = (e.innerText || '').trim() || e.getAttribute('aria-label') || e.getAttribute('title') || (e.labels && e.labels.length ? 'labelled' : '');
      return !t;
    }).map(e => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''));
    const smallTargets = focusables.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); }).length;
    return { dark: document.documentElement.classList.contains('dark'), title: document.title, scrollX, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, headings, landmarks: [...new Set(landmarks)], focusables: focusables.length, unlabelled: [...new Set(unlabelled)], smallTargets };
  })())`);
  report.push({ route, title, ...JSON.parse(axeResult), ...JSON.parse(extras) });
}

console.log(JSON.stringify(report, null, 1));
chrome.kill("SIGKILL");
process.exit(0);
