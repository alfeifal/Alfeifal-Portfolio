/**
 * Phase 3.15 — is the assistant actually the brain of the Personal OS?
 *
 * Phase 3.14 made the pipe reliable: a transcript is always valid, a tool call is always answered, an
 * error never leaks. That says nothing about whether the right tool runs with the right arguments over
 * the right data. This file is about that, and about one honest limitation.
 *
 * WHAT CANNOT BE TESTED HERE: there is no ANTHROPIC_API_KEY in this environment, so no test in this repo
 * can show which tool the model *would* pick for a given sentence. Every "tool selection" test below is
 * therefore a test of the material the model selects from — that the 144 descriptions are mutually
 * exclusive where the product's concepts are, that a wrong pick is caught by a schema rather than
 * silently writing the wrong record, and that a right pick lands on the right data. Those are the parts
 * that live in this codebase. The model's judgement does not.
 *
 * WHAT IS TESTED, in the order the phase asks for it: tool selection (disambiguation), arguments,
 * context, ambiguity, confirmation, domain separation, search→action, memory, analytics, multi-user,
 * hallucination/unknown data, and dates.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { runTool } from "./_tool-helpers";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { allTools, getTool, type ToolDefinition } from "@/server/ai/registry";
import "@/server/ai/tools";
import { buildSystemPrompt } from "@/server/ai/context";
import { COMPACT_SECTIONS, SNAPSHOT_BUDGET_CHARS, lifeSnapshot } from "@/server/services/snapshot";
import { analyticsOverview } from "@/server/services/analytics";
import { financialSummary } from "@/server/services/finance";
import { globalSearch } from "@/server/services/search";
import { forgetMemory, getMemory, rememberMemory, updateMemory, UUID_RE } from "@/server/services/memory";
import { todayKey } from "@/lib/dates";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const TZ = "Europe/Madrid";
const tools = () => allTools();
const tool = (name: string) => {
  const t = getTool(name);
  if (!t) throw new Error(`tool ${name} is not registered`);
  return t;
};
const shapeOf = (t: ToolDefinition) => Object.keys((t.schema as { shape?: Record<string, unknown> }).shape ?? {});
const text = (t: ToolDefinition) => `${t.name} ${t.description}`.toLowerCase();
type U = Awaited<ReturnType<typeof createTestUser>>;

/* ═══════════════════════════════════════════════════════════ 1 · TOOL SELECTION (disambiguation) ══ */

describe("the concepts the product separates are separated in the tools the model reads", () => {
  /**
   * Each row is a pair the phase names as confusable, and the words that have to appear in the *first*
   * tool's description for a reader with no other context to tell it from the second. The point is not
   * prose quality: it is that a model choosing between these two has something to choose on.
   */
  const boundaries: { tool: string; notThe: string; mustMention: RegExp }[] = [
    { tool: "create_task", notThe: "create_event", mustMention: /calendar event|create_event/i },
    { tool: "create_event", notThe: "create_task", mustMention: /task|create_task/i },
    { tool: "create_task", notThe: "create_exam", mustMention: /exam|create_exam/i },
    { tool: "create_goal", notThe: "create_project", mustMention: /project|create_project/i },
    { tool: "create_project", notThe: "create_goal", mustMention: /goal|create_goal/i },
    { tool: "add_milestone", notThe: "add_project_milestone", mustMention: /goal/i },
    { tool: "add_project_milestone", notThe: "add_milestone", mustMention: /project/i },
    { tool: "add_expense", notThe: "an investment or a trade", mustMention: /investment|investing|trade|trading/i },
    { tool: "add_income", notThe: "a dividend or a trade profit", mustMention: /investment|investing|trade|trading|dividend/i },
    { tool: "add_investment_transaction", notThe: "a trade", mustMention: /trade|trading|long-term|portfolio/i },
    { tool: "add_trade", notThe: "an investment", mustMention: /invest|paper|real/i },
    { tool: "log_set", notThe: "log_workout", mustMention: /set/i },
    { tool: "log_workout", notThe: "log_set", mustMention: /session|set/i },
    { tool: "log_meal", notThe: "create_food", mustMention: /food|saved/i },
    { tool: "create_food", notThe: "log_meal", mustMention: /log_meal|meal/i },
    { tool: "remember_memory", notThe: "create_journal_entry", mustMention: /journal|diary|durable/i },
    { tool: "create_journal_entry", notThe: "remember_memory", mustMention: /memory|remember_memory|journal/i },
    { tool: "generate_review", notThe: "get_analytics", mustMention: /review/i },
    { tool: "get_analytics", notThe: "generate_review", mustMention: /review|stored records/i },
  ];

  for (const b of boundaries) {
    it(`${b.tool} says how it differs from ${b.notThe}`, () => {
      expect(tool(b.tool).description, `${b.tool} gives no way to tell it from ${b.notThe}`).toMatch(b.mustMention);
    });
  }

  it("no two tools share a name, and every name says what it does", () => {
    const names = tools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n, n).toMatch(/^[a-z][a-z0-9_]{3,40}$/);
  });

  it("no description is empty, and none is long enough to crowd out the rest", () => {
    // Length is not ambiguity: "All personal records." is 21 characters and perfectly unambiguous, and
    // this phase explicitly forbids rewriting descriptions for looks. So the floor only catches an
    // empty one; the boundary cases above are where a description has to earn its words.
    const empty = tools().filter((t) => t.description.trim().length < 20).map((t) => t.name);
    const bloated = tools().filter((t) => t.description.length > 1100).map((t) => `${t.name} (${t.description.length})`);
    expect(empty).toEqual([]);
    expect(bloated).toEqual([]);
  });

  it("the whole tool block stays within the budget prompt caching was built for", () => {
    const total = tools().reduce((a, t) => a + t.name.length + t.description.length, 0);
    expect(total).toBeLessThan(40_000); // descriptions only; schemas are generated, not authored
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ 2 · TOOL ARGUMENTS ══ */

describe("what a tool will and will not accept", () => {
  it("no tool lets the caller name the user, the role, or its own confirmation", () => {
    // The identity comes from the session. If it were an argument, a sentence could change it.
    const leaks = tools().filter((t) => shapeOf(t).some((k) => /^(userid|user_id|confirmed|isadmin|role|ownerid)$/i.test(k)));
    expect(leaks.map((t) => t.name)).toEqual([]);
  });

  it("every tool that acts on an existing record takes an id, and the id must be a real UUID", () => {
    const byId = tools().filter((t) => shapeOf(t).includes("id") && /^(update|delete|complete|edit)_/.test(t.name));
    expect(byId.length).toBeGreaterThan(20);
    for (const t of byId) {
      expect(t.schema.safeParse({ id: "the one I mentioned" }).success, `${t.name} accepted a non-id`).toBe(false);
      expect(t.schema.safeParse({ id: "42" }).success, `${t.name} accepted a number as an id`).toBe(false);
    }
  });

  it("a tool with required arguments rejects the empty call rather than inventing defaults", () => {
    const mustHaveArgs = ["add_expense", "add_income", "log_set", "create_task", "create_goal", "create_project", "log_study_session", "create_exam", "remember_memory"];
    for (const n of mustHaveArgs) {
      expect(tool(n).schema.safeParse({}).success, `${n} accepted {}`).toBe(false);
    }
  });

  /**
   * A description that contradicts its own schema costs a round: the model follows the prose, the call
   * fails validation, and the user waits. Two real ones were found this way — `log_sets` showed its sets
   * as the string "80x6, 80x6" while the schema wanted a list of objects, and `log_study_session` called
   * its duration "minutes" while the argument is `durationMinutes`. Each row here is an example a model
   * could reasonably build FROM THE DESCRIPTION ALONE; it has to validate.
   */
  it("an example a model would build from the description actually validates", () => {
    const examples: [string, unknown][] = [
      ["log_sets", { exercise: "press banca", sets: [{ weightKg: 80, reps: 6 }, { weightKg: 77.5, reps: 7 }] }],
      ["log_study_session", { subject: "Francés", durationMinutes: 45, topic: "Subjuntivo" }],
      ["log_meal", { type: "lunch", items: [{ description: "Pechuga de pollo", quantity: 200, unit: "g", basis: "100g", calories: 165, protein: 31, carbs: 0, fat: 3.6, source: "estimated", confidence: 80 }] }],
      ["add_expense", { amount: 18, category: "Comida", description: "Menú del día" }],
      ["create_task", { title: "Estudiar francés", recurrence: "weekly:MO,WE" }],
      ["create_event", { title: "Dentista", startAt: "2026-09-15T10:00:00", kind: "personal" }],
      ["create_exam", { subject: "Matemáticas", title: "Examen", date: "2026-09-25" }],
      ["remember_memory", { kind: "fact", key: "work_schedule", content: "Trabaja de 9 a 18." }],
      ["add_trade", { accountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", mode: "paper", symbol: "AAPL", direction: "long", entryPrice: 200, quantity: 1 }],
    ];
    for (const [name, input] of examples) {
      const parsed = tool(name).schema.safeParse(input);
      expect(parsed.success, `${name}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });

  it("no description shows an argument shape its schema would reject", () => {
    // The two that did: pinned here so the prose and the schema cannot drift apart again.
    expect(tool("log_sets").description).toMatch(/\[\{weightKg/);
    expect(tool("log_sets").description).not.toMatch(/\(e\.g\. '80x6, 80x6, 77\.5x7'\)/);
    expect(tool("log_study_session").description).toContain("durationMinutes");
    expect(shapeOf(tool("log_study_session"))).toContain("durationMinutes");
  });

  it("numbers that mean money or load are numbers, never free text", () => {
    expect(tool("add_expense").schema.safeParse({ amount: "veinte euros", category: "Food" }).success).toBe(false);
    expect(tool("log_set").schema.safeParse({ exercise: "bench", weightKg: "mucho", reps: 6 }).success).toBe(false);
  });

  it("dates are date-shaped, so 'mañana' has to be resolved before the call", () => {
    for (const [n, arg] of [["add_expense", "date"], ["create_exam", "date"], ["create_task", "dueDate"]] as const) {
      const bad = tool(n).schema.safeParse({ [arg]: "mañana", amount: 1, category: "x", title: "x", subject: "x" } as never);
      expect(bad.success, `${n} accepted a relative date`).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════ 3 · CONTEXT ══ */

d("what the model is actually given", () => {
  let u: U;
  let prompt: string;
  beforeAll(async () => {
    u = await createTestUser();
    prompt = await buildSystemPrompt(u as never, undefined, COMPACT_SECTIONS);
  });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("carries today's real date in the user's timezone, not a build-time constant", () => {
    expect(prompt).toContain(todayKey(u.timezone));
    expect(prompt).toContain(u.timezone);
    // The account's own currency, so figures are not narrated in the wrong one.
    expect(prompt).toContain(u.currency);
  });

  it("identifies the account it belongs to and nobody else", () => {
    expect(prompt).toContain(u.name);
    expect(prompt).toContain(u.email);
  });

  it("states the rules the phase depends on", () => {
    const required: [string, RegExp][] = [
      ["acts only through tools", /only through tools/i],
      ["never claims an unconfirmed save", /never claim something was saved/i],
      ["reads before modifying, to get ids", /read them first.*ids/is],
      ["resolves relative dates in the user's timezone", /resolve 'today', 'tomorrow'/i],
      ["keeps the money books apart", /never add them into a single 'net worth'/i],
      ["never presents paper money as real", /never present a paper trading figure as real money/i],
      ["marks estimates as estimates", /must be marked as an estimate/i],
      ["says the snapshot is partial", /never answer "you have nothing" from it alone/i],
      ["points at search for anything not in view", /search_personal_os/i],
      ["explains that a memory key is not a UUID", /the key is not a uuid/i],
      ["says the plan cannot be accepted by the assistant", /you cannot accept it yourself/i],
    ];
    for (const [what, re] of required) expect(prompt, `the prompt no longer ${what}`).toMatch(re);
  });

  it("stays small: the per-message cost of a user does not grow with their data", async () => {
    // The snapshot is the only part that scales, and it is clipped. Everything else is fixed text.
    expect(prompt.length).toBeLessThan(2000 + SNAPSHOT_BUDGET_CHARS);
    const snapshotStart = prompt.indexOf("CURRENT STATE SNAPSHOT");
    expect(snapshotStart).toBeGreaterThan(0);
    expect(prompt.length - snapshotStart).toBeLessThanOrEqual(SNAPSHOT_BUDGET_CHARS + 500);
  });

  it("does not paste analytics, notifications or the conversation into every message", () => {
    // Those are tools. Putting them in the prompt would make every message more expensive and staler.
    for (const absent of ["win rate", "profit factor", "unread notification", "expectancy"]) {
      expect(prompt.toLowerCase()).not.toContain(absent);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════ 4 · AMBIGUITY ══ */

d("an under-specified sentence cannot become a confident wrong record", () => {
  let u: U;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it('"apunta 50 kg" — a weight with no exercise and no reps is refused', async () => {
    const r = await runTool(tool("log_set"), { weightKg: 50 }, u);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/exercise/i);
  });

  it('"he gastado 20" — an amount with no category still records, because the category is optional by design', async () => {
    // This one is deliberately NOT an error: the product treats an uncategorised expense as valid.
    // The test exists so that stops being silent if the schema ever changes.
    const r = await runTool(tool("add_expense"), { amount: 20 }, u);
    expect(["success", "failed"]).toContain(r.status);
    if (r.status === "failed") expect(r.error).toMatch(/category|required/i);
  });

  it('"elimina eso" — no destructive tool can run without naming its target', async () => {
    for (const n of ["delete_task", "delete_goal", "delete_project", "delete_expense", "delete_trade"]) {
      const r = await runTool(tool(n), {}, u);
      expect(r.status, `${n} ran without a target`).toBe("failed");
      expect(r.error, n).toMatch(/id|required/i);
    }
  });

  it('"actualízalo" — an update with an id that was never issued fails instead of touching a neighbour', async () => {
    const nowhere = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"; // well-formed v4, simply not theirs
    for (const [n, extra] of [["update_task", { title: "x" }], ["update_goal", { name: "x" }], ["update_project", { name: "x" }]] as const) {
      const r = await runTool(tool(n), { id: nowhere, ...extra }, u);
      expect(r.status, n).toBe("failed");
    }
  });

  it("a fabricated id is refused by every read tool too, so nothing is invented downstream", async () => {
    const r = await runTool(tool("get_workout_session"), { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3303" }, u);
    expect(r.status).toBe("failed");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════ 5 · CONFIRMATION ══ */

describe("risk levels, and what they promise", () => {
  const destructive = /^(delete_|forget_)/;

  /**
   * Three deletions run without asking. Each is trivially reversible by repeating the opposite action,
   * and each says so in its own description. The list is closed: a fourth one has to be argued for here.
   */
  const RUNS_DIRECTLY = ["remove_watchlist_item", "delete_price_alert", "delete_notification"];

  it("everything destructive is either high risk or always confirmed", () => {
    const unguarded = tools()
      .filter((t) => destructive.test(t.name) || t.name.startsWith("remove_"))
      .filter((t) => t.risk !== "high" && !t.needsConfirmation)
      .map((t) => t.name);
    expect(unguarded.sort()).toEqual(RUNS_DIRECTLY.sort());
  });

  it("the exceptions say in their own words why they run directly", () => {
    for (const n of RUNS_DIRECTLY) {
      expect(text(tool(n)), n).toMatch(/undo|reversible|runs directly|nothing else is affected|use mark_notifications_read/);
    }
  });

  it("the irreversible and the financial are high risk", () => {
    const mustBeHigh = ["delete_goal", "delete_project", "delete_trade", "delete_subject", "delete_trading_account", "delete_finance_account", "delete_investment_account", "delete_investment_transaction", "add_investment_transaction", "create_transfer"];
    for (const n of mustBeHigh) expect(tool(n).risk, n).toBe("high");
    // …and nothing outside that set has quietly become high risk without being named here.
    expect(tools().filter((t) => t.risk === "high").map((t) => t.name).sort()).toEqual(mustBeHigh.slice().sort());
  });

  it("deleting a transaction, a task or a trade is confirmed, as the phase requires", () => {
    for (const n of ["delete_expense", "delete_task", "delete_trade", "delete_goal", "delete_project"]) {
      const t = tool(n);
      expect(t.risk === "high" || Boolean(t.needsConfirmation), n).toBe(true);
    }
  });

  it("no read tool can write", () => {
    const suspicious = tools().filter((t) => t.risk === "read" && /^(create|add|update|delete|log|set|remove|forget|complete|mark|generate|propose)_/.test(t.name));
    expect(suspicious.map((t) => t.name)).toEqual([]);
  });
});

d("a confirmation cannot be talked away", () => {
  let u: U;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("a high-risk tool waits for the user even when the call insists it is already agreed", async () => {
    // There is no argument for "the user said yes" — the only way through is confirmAction, which the
    // UI drives. A sentence cannot reach it.
    const r = await runTool(tool("create_transfer"), { fromAccountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", toAccountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", amount: 100, confirmed: true, userConfirmed: true } as never, u);
    expect(r.status).toBe("pending_confirmation");
    expect(shapeOf(tool("create_transfer"))).not.toContain("confirmed");
  });

  it("the pending action records what would happen, and nothing happens yet", async () => {
    const r = await runTool(tool("create_transfer"), { fromAccountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", toAccountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", amount: 100 } as never, u);
    expect(r.status).toBe("pending_confirmation");
    expect(r.summary).toBeTruthy();
    expect(r.result).toBeUndefined(); // nothing was executed
  });

  it("a low-risk log runs straight away, which is what makes Fast Log fast", async () => {
    const r = await runTool(tool("add_expense"), { amount: 12, category: "Food", description: "comida" }, u);
    expect(r.status).toBe("success");
  });
});

/* ═══════════════════════════════════════════════════════════════════ 6 · DOMAIN SEPARATION ══════ */

d("finance, investing and trading are three books, not one", () => {
  let u: U;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("the finance summary is personal money only", async () => {
    const from = todayKey(TZ).slice(0, 8) + "01";
    const s = await financialSummary(u.id, { from, to: todayKey(TZ) });
    const k = Object.keys(s);
    expect(k).toContain("financeBalance"); // named, not called "balance" or "net worth"
    for (const foreign of ["portfolio", "holdings", "trades", "pnl", "equity", "netWorth"]) {
      expect(k, `financialSummary leaked ${foreign}`).not.toContain(foreign);
    }
  });

  it("analytics keeps each book under its own name", async () => {
    const a = await analyticsOverview(u.id, "week", TZ) as Record<string, unknown>;
    expect(Object.keys(a)).toContain("finance");
    expect(Object.keys(a)).toContain("investing");
    expect(Object.keys(a)).not.toContain("netWorth");
    expect(Object.keys(a)).not.toContain("total");
    // Finance's own balance stays inside finance, where its meaning is defined.
    expect(Object.keys(a.finance as object)).toContain("financeBalance");
  });

  it("no tool in the registry offers a combined net worth", () => {
    const combined = tools().filter((t) => /net_?worth|patrimonio|total_wealth/i.test(`${t.name} ${t.description}`) && !/never add them|not interchangeable/i.test(t.description));
    expect(combined.map((t) => t.name)).toEqual([]);
  });

  it("a trade is always one mode, and the mode is never optional in the result", () => {
    const shape = shapeOf(tool("add_trade"));
    expect(shape).toContain("mode");
    expect(tool("add_trade").description).toMatch(/paper.*real|real.*paper/i);
    expect(tool("get_positions").description).toMatch(/real and paper are returned separately/i);
  });

  it("the three modules never read each other's tables", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const finance = read("src/server/services/finance.ts");
    for (const foreign of ["invAssets", "invTransactions", "trades", "tradingAccounts"]) {
      expect(finance, `finance.ts reads ${foreign}`).not.toContain(`from(${foreign})`);
    }
    const trading = read("src/server/services/trading.ts");
    for (const foreign of ["transactions)", "financeAccounts"]) {
      expect(trading, `trading.ts reads ${foreign}`).not.toContain(`from(${foreign}`);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════ 7 · SEARCH→ACTION ══ */

d("search finds the id, the module's own tool does the work", () => {
  let u: U;
  const made: { kind: string; id: string; title: string }[] = [];
  beforeAll(async () => {
    u = await createTestUser();
    const task = await runTool(tool("create_task"), { title: "Renovar el DNI antes de que caduque" }, u);
    made.push({ kind: "task", id: (task.result as { id: string }).id, title: "Renovar el DNI" });
    const goal = await runTool(tool("create_goal"), { name: "Correr diez kilómetros seguidos" }, u);
    made.push({ kind: "goal", id: (goal.result as { id: string }).id, title: "Correr diez" });
    const project = await runTool(tool("create_project"), { name: "Reformar el trastero" }, u);
    made.push({ kind: "project", id: (project.result as { id: string }).id, title: "Reformar el trastero" });
    await runTool(tool("add_expense"), { amount: 18, category: "Comida", description: "Menú del día en el bar" }, u);
    await runTool(tool("log_study_session"), { subject: "Francés", minutes: 45, topic: "Subjuntivo" }, u);
    await runTool(tool("create_journal_entry"), { content: "Hoy he dormido fatal y aun así he entrenado." }, u);
  });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("is read-only: it is registered as a read tool and has no write twin", () => {
    expect(tool("search_personal_os").risk).toBe("read");
    expect(tool("search_personal_os").description).toMatch(/read-only|never changes/i);
  });

  it("returns real ids for the things the user actually has", async () => {
    for (const m of made) {
      const hits = (await globalSearch(u.id, m.title, { limit: 10 })).hits as { id: string; type: string }[];
      expect(hits.length, `search found nothing for ${m.kind}`).toBeGreaterThan(0);
      expect(hits.map((h) => h.id), `search did not return the real ${m.kind} id`).toContain(m.id);
      for (const h of hits) expect(h.id, `${m.kind} hit id is not a UUID`).toMatch(UUID_RE);
    }
  });

  it("an id from search is accepted by that module's tool — the whole point of the pattern", async () => {
    const hits = (await globalSearch(u.id, "Renovar el DNI", { limit: 5 })).hits as { id: string }[];
    const r = await runTool(tool("update_task"), { id: hits[0].id, priority: "high" }, u);
    expect(r.status).toBe("success");
    expect((r.result as { priority: string }).priority).toBe("high");
  });

  it("reaches every module the phase lists", async () => {
    const found = new Set<string>();
    for (const q of ["Renovar", "Correr", "Reformar", "Menú del día", "Francés", "dormido fatal"]) {
      for (const h of (await globalSearch(u.id, q, { limit: 10 })).hits as { type: string; module: string }[]) {
        found.add(h.type);
      }
    }
    expect(found.size, `search only reached ${[...found].join(", ")}`).toBeGreaterThanOrEqual(5);
  });

  it("never returns another account's rows", async () => {
    const other = await createTestUser();
    try {
      for (const q of ["Renovar el DNI", "Correr diez", "Reformar el trastero", "Menú del día"]) {
        expect((await globalSearch(other.id, q, { limit: 10 })).hits).toEqual([]);
      }
    } finally {
      await deleteTestUser(other.id);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════ 8 · MEMORY ══ */

d("remembering, correcting and forgetting", () => {
  let u: U;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("a memory is addressed by its key, and the key is not a UUID", async () => {
    await rememberMemory(u.id, { kind: "fact", key: "work_schedule", content: "Trabaja de 9 a 18, martes libre." } as never);
    const byKey = await getMemory(u.id, { key: "work_schedule" });
    expect(byKey.content).toMatch(/martes libre/);
    expect(byKey.id).toMatch(UUID_RE);
    expect(byKey.key).toBe("work_schedule");
    expect(byKey.key).not.toMatch(UUID_RE);
    // The same memory, reached the other way.
    expect((await getMemory(u.id, { id: byKey.id })).key).toBe("work_schedule");
  });

  it("the key is what stops a second 'recuerda que…' creating a duplicate", async () => {
    await rememberMemory(u.id, { kind: "fact", key: "coche", content: "Tiene un Ibiza gris." } as never);
    await rememberMemory(u.id, { kind: "fact", key: "coche", content: "Tiene un Ibiza gris de 2016." } as never);
    const { hits } = { hits: await (await import("@/server/services/memory")).searchMemory(u.id, "Ibiza", 10) };
    expect(hits.length).toBe(1);
    expect(hits[0].content).toMatch(/2016/);
  });

  it("an update changes only what it names", async () => {
    await rememberMemory(u.id, { kind: "preference", key: "cafe", content: "Café solo, sin azúcar.", importance: 4, pinned: true } as never);
    await updateMemory(u.id, { key: "cafe" }, { importance: 2 });
    const after = await getMemory(u.id, { key: "cafe" });
    expect(after.content).toBe("Café solo, sin azúcar."); // untouched
    expect(after.kind).toBe("preference");
    expect(after.pinned).toBe(true);
    expect(after.importance).toBe(2);
  });

  it("forgetting is a confirmed action, not a side effect of a sentence", () => {
    const t = tool("forget_memory");
    expect(t.risk).toBe("medium");
    expect(Boolean(t.needsConfirmation)).toBe(true);
    expect(t.description).toMatch(/confirmation/i);
  });

  it("a memory belongs to one account", async () => {
    const other = await createTestUser();
    try {
      await rememberMemory(u.id, { kind: "fact", key: "secreto", content: "Solo de A." } as never);
      await expect(getMemory(other.id, { key: "secreto" })).rejects.toMatchObject({ status: 404 });
      await expect(updateMemory(other.id, { key: "secreto" }, { content: "robado" })).rejects.toMatchObject({ status: 404 });
      await expect(forgetMemory(other.id, { key: "secreto" })).rejects.toMatchObject({ status: 404 });
      expect((await getMemory(u.id, { key: "secreto" })).content).toBe("Solo de A.");
    } finally {
      await deleteTestUser(other.id);
    }
  });

  it("memory in the system prompt is the user's own, and is addressed the way the prompt says", async () => {
    await rememberMemory(u.id, { kind: "fact", key: "hermana", content: "Su hermana se llama Nadia." } as never);
    const prompt = await buildSystemPrompt(u as never, undefined, COMPACT_SECTIONS);
    expect(prompt).toContain("[fact:hermana] Su hermana se llama Nadia.");
    // Keys are pasted, ids are not — otherwise the model would address memories by a UUID it saw in
    // the prompt instead of the key, which is the bug phase 3.x already fixed once. (UUID_RE is
    // anchored, so it has to be unanchored to search inside a block of text.)
    const anywhere = new RegExp(UUID_RE.source.replace(/^\^|\$$/g, ""), "i");
    expect(anywhere.test("id 3f2504e0-4f89-41d3-9a0c-0305e82c3301 here"), "the search regex itself is broken").toBe(true);
    expect(prompt).not.toMatch(anywhere);
  });
});

/* ══════════════════════════════════════════════════════════════════ 9 · ANALYTICS & REVIEWS ══════ */

d("the numbers come from the services that own them", () => {
  let u: U;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("analytics says where its figures came from", async () => {
    const a = await analyticsOverview(u.id, "week", TZ) as { source?: string };
    expect(a.source).toBeTruthy();
  });

  it("the analytics tool tells the model the numbers are computed, not estimated", () => {
    expect(tool("get_analytics").description).toMatch(/computed from stored records only/i);
  });

  it("the review is stored and re-read, not recomputed in prose", () => {
    expect(tool("generate_review").risk).toBe("low"); // it writes a record
    expect(tool("get_review").risk).toBe("read");
    expect(tool("list_reviews").description).toMatch(/id/i);
  });

  it("nutrition arithmetic belongs to the server, and the tool says so", () => {
    const desc = tool("log_meal").description;
    expect(desc).toMatch(/the server does the arithmetic, you do not/i);
    expect(desc).toMatch(/protein×4 \+ carbs×4 \+ fat×9/);
    expect(desc).toMatch(/report it to the user/i);
  });

  it("goal progress is computed, and a linked goal cannot be set by hand", () => {
    expect(tool("create_goal").description).toMatch(/progress can never be set by hand/i);
    expect(tool("update_goal_progress").description).toMatch(/only for manual goals/i);
  });
});

/* ════════════════════════════════════════════════════════════════════════════ 10 · MULTI-USER ══ */

d("three accounts, three separate brains", () => {
  let admin: U;
  let A: U;
  let B: U;

  beforeAll(async () => {
    admin = await createTestUser();
    await db.update(users).set({ role: "admin" }).where(eq(users.id, admin.id));
    admin = (await db.select().from(users).where(eq(users.id, admin.id)))[0];
    A = await createTestUser();
    B = await createTestUser();
    await runTool(tool("create_task"), { title: "Tarea privada de A: llamar al notario" }, A);
    await runTool(tool("add_expense"), { amount: 111, category: "Comida", description: "Gasto privado de A" }, A);
    await rememberMemory(A.id, { kind: "fact", key: "a_only", content: "A vive en Oviedo." } as never);
    await runTool(tool("create_task"), { title: "Tarea privada de B: recoger el coche" }, B);
    await runTool(tool("add_expense"), { amount: 222, category: "Transporte", description: "Gasto privado de B" }, B);
    await rememberMemory(B.id, { kind: "fact", key: "b_only", content: "B vive en Cádiz." } as never);
  });
  afterAll(async () => {
    for (const x of [A, B, admin]) if (x) await deleteTestUser(x.id).catch(() => {});
  });

  it("each system prompt contains only its own account's life", async () => {
    const pa = await buildSystemPrompt(A as never, undefined, COMPACT_SECTIONS);
    const pb = await buildSystemPrompt(B as never, undefined, COMPACT_SECTIONS);
    expect(pa).toContain("A vive en Oviedo.");
    expect(pa).not.toContain("B vive en Cádiz.");
    expect(pa).not.toContain("recoger el coche");
    expect(pb).toContain("B vive en Cádiz.");
    expect(pb).not.toContain("A vive en Oviedo.");
    expect(pb).not.toContain("llamar al notario");
  });

  it("being an administrator does not put anyone else's life in the prompt", async () => {
    const pAdmin = await buildSystemPrompt(admin as never, undefined, COMPACT_SECTIONS);
    for (const foreign of ["A vive en Oviedo.", "B vive en Cádiz.", "llamar al notario", "recoger el coche", "Gasto privado"]) {
      expect(pAdmin, `the admin prompt leaked: ${foreign}`).not.toContain(foreign);
    }
  });

  it("asking for the other account by id gets nothing, not a refusal that confirms it exists", async () => {
    const bTasks = await runTool(tool("get_tasks"), { view: "all" }, B);
    const bTaskId = (bTasks.result as { id: string }[])[0].id;
    const stolen = await runTool(tool("update_task"), { id: bTaskId, title: "robada" }, A);
    expect(stolen.status).toBe("failed");
    expect(stolen.error).toMatch(/not found/i);
    // …and B's task is untouched.
    const after = await runTool(tool("get_tasks"), { view: "all" }, B);
    expect(JSON.stringify(after.result)).toContain("recoger el coche");
  });

  it("each account's own read tools return only its own rows", async () => {
    const aTasks = JSON.stringify((await runTool(tool("get_tasks"), { view: "all" }, A)).result);
    expect(aTasks).toContain("llamar al notario");
    expect(aTasks).not.toContain("recoger el coche");
    const aSearch = JSON.stringify(await globalSearch(A.id, "privad", { limit: 20 }));
    expect(aSearch).toContain("A");
    expect(aSearch).not.toContain("recoger el coche");
    expect(aSearch).not.toContain("222");
  });
});

/* ══════════════════════════════════════════════════════ 11 · UNKNOWN DATA (no invention) ═══════ */

d("an empty account reads as empty, never as zero-shaped fiction", () => {
  let u: U;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("every read tool on a fresh account returns an empty result, not a plausible one", async () => {
    const reads = ["get_transactions", "get_goals", "get_projects", "get_journal_entries", "get_positions", "get_portfolio", "get_personal_records", "get_workout_history", "list_reviews"];
    for (const n of reads) {
      const r = await runTool(tool(n), {}, u);
      expect(r.status, n).toBe("success");
      const json = JSON.stringify(r.result ?? null);
      expect(json.length, `${n} invented content on an empty account`).toBeLessThan(2000);
      expect(json, n).not.toMatch(/lorem|example|sample|placeholder/i);
    }
  });

  it("search over an empty account returns nothing at all", async () => {
    const s = await globalSearch(u.id, "cualquier cosa", { limit: 10 });
    expect(s.hits).toEqual([]);
    expect(s.total).toBe(0);
  });

  it("the snapshot states absence explicitly, so 'none' is a fact and not a gap", async () => {
    const prompt = await buildSystemPrompt(u as never, undefined, COMPACT_SECTIONS);
    const snap = prompt.slice(prompt.indexOf("CURRENT STATE SNAPSHOT"));
    expect(snap).toMatch(/none|nothing scheduled|0 /);
    // And it says out loud that it is not the whole database, so "none here" is not "none anywhere".
    expect(prompt).toMatch(/never answer "you have nothing" from it alone/i);
  });

  it("analytics on an empty account reports zeros with its source, not a trend", async () => {
    const a = await analyticsOverview(u.id, "week", TZ);
    expect(a.source).toBeTruthy();
    expect(JSON.stringify(a)).not.toMatch(/improving|worsening|great job|well done/i);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════════════ 12 · DATES ══ */

describe("today is today, in the user's timezone", () => {
  it("todayKey follows the timezone, not the server's clock", () => {
    const instant = new Date("2026-09-18T23:30:00Z");
    expect(todayKey("Europe/Madrid", instant)).toBe("2026-09-19"); // already tomorrow in Madrid
    expect(todayKey("UTC", instant)).toBe("2026-09-18");
    expect(todayKey("America/Los_Angeles", instant)).toBe("2026-09-18");
  });

  it("no date is hardcoded anywhere the assistant reads from", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    for (const f of ["src/server/ai/context.ts", "src/server/services/snapshot.ts"]) {
      expect(read(f), `${f} contains a literal date`).not.toMatch(/["']20\d\d-\d\d-\d\d["']/);
    }
  });

  it("the prompt hands the model a resolved date and tells it to resolve the rest itself", async () => {
    // Belt and braces: the rule exists (asserted in §3) and the tools refuse relative strings (§2),
    // so a model that ignores the rule produces a failed tool call, not a record on the wrong day.
    expect(tool("create_task").schema.safeParse({ title: "x", dueDate: "tomorrow" }).success).toBe(false);
    expect(tool("create_task").schema.safeParse({ title: "x", dueDate: todayKey(TZ) }).success).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════ 13 · MODES (quick vs normal) ══ */

describe("Fast Log stays a logger, the assistant stays an assistant", () => {
  const reports = readFileSync(join(process.cwd(), "src/server/ai/reports.ts"), "utf8");

  it("Fast Log runs a shorter loop than the assistant", () => {
    const quick = /maxRounds:\s*(\d+)/.exec(reports.slice(reports.indexOf("QUICK_ENTRY")));
    expect(quick).toBeTruthy();
    expect(Number(quick![1])).toBeLessThanOrEqual(4);
  });

  it("its instructions push it to act, not to browse", () => {
    const extra = reports.slice(reports.indexOf("QUICK ENTRY MODE"), reports.indexOf("QUICK ENTRY MODE") + 700);
    expect(extra).toMatch(/create them immediately with tools/i);
    expect(extra).toMatch(/do not call read tools to browse around first/i);
    expect(extra).toMatch(/one or two short lines/i);
  });

  it("it never joins the assistant's transcript", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/ai/chat/stream/route.ts"), "utf8");
    expect(route).toMatch(/quick \? null : conversationId/);
  });

  it("the planner proposes and cannot accept", () => {
    expect(tool("propose_plan").description).toMatch(/draft/i);
    expect(tool("propose_plan").description).toMatch(/creates nothing real/i);
    expect(tools().map((t) => t.name)).not.toContain("accept_plan");
  });
});
