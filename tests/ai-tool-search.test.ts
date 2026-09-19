/**
 * Phase 3.17 — native tool search and deferred tool loading.
 *
 * The provider can keep the whole catalogue out of the model's context and load definitions on demand:
 * every tool is still SENT in `tools`, but the ones marked `defer_loading: true` are excluded from the
 * prefix until Claude finds them with a server-side search. Measured here: 144 definitions sent, 5 in
 * context — 27.5k tokens down to ~1.1k — with the cached prefix intact.
 *
 * WHAT IS PROVEN AND WHAT IS NOT. There is no ANTHROPIC_API_KEY in this environment. Everything below
 * runs against a stub that reproduces the documented protocol exactly — `server_tool_use` carrying a
 * `srvtoolu_` id, `tool_search_tool_result` with nested `tool_references`, the empty-result and error
 * shapes — so the request we build, the blocks we persist and the blocks we replay are all real. What is
 * NOT proven is that Claude actually finds the right tool for a given Spanish sentence. That needs the
 * real provider, which is why tool search is opt-in and off by default.
 *
 * The rules being pinned come from the API reference:
 *   · at least one tool must be non-deferred, and never the search tool itself;
 *   · a deferred tool may not carry `cache_control` (400);
 *   · a `tool_result` must never be returned for a `srvtoolu_` id (400);
 *   · the assistant's content, including the native blocks, is echoed back unchanged;
 *   · a search matching nothing returns an empty `tool_references` array, not an error.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { messages } from "@/server/db/schema";
import { allTools, getTool } from "@/server/ai/registry";
import "@/server/ai/tools";
import { toInputSchema } from "@/server/ai/schema-json";
import { toolsForMode, FAST_LOG_TOOLS, PLANNER_TOOLS } from "@/server/ai/tool-groups";
import { ALWAYS_LOADED, modeAllowsSearch, modelSupportsToolSearch, planTools, toolSearchMode, toolSearchPromptSection } from "@/server/ai/tool-search";
import { repairTranscript, validateTranscript } from "@/server/ai/transcript";
import { chat } from "@/server/ai/agent";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const MODEL = "claude-sonnet-4-5";
const ON = { AI_TOOL_SEARCH: "regex" } as unknown as NodeJS.ProcessEnv;
const OFF = { AI_TOOL_SEARCH: "" } as unknown as NodeJS.ProcessEnv;
const built = () => allTools().map((t) => ({ name: t.name, description: `[${t.module} · ${t.risk}] ${t.description}`, input_schema: toInputSchema(t.schema) })) as Anthropic.Tool[];
const deferredOf = (tools: readonly Anthropic.ToolUnion[]) => tools.filter((t) => (t as { defer_loading?: boolean }).defer_loading);
const cachedOf = (tools: readonly Anthropic.ToolUnion[]) => tools.filter((t) => (t as { cache_control?: unknown }).cache_control);
const assistantPlan = (env = ON) => planTools(built(), { kind: "assistant", model: MODEL, env });

/* ═══════════════════════════════════════════════════════ 1 · COMPATIBILITY, AS THE DOCS STATE IT ══ */

describe("the model compatibility table, as published", () => {
  it("accepts every model the provider lists, dated id or alias", () => {
    for (const m of ["claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-fable-5-1", "claude-mythos-5"]) {
      expect(modelSupportsToolSearch(m), m).toBe(true);
    }
    // The table lists the dated ids; this app configures the alias. Both have to resolve.
    expect(modelSupportsToolSearch("claude-sonnet-4-5")).toBe(true);
    expect(modelSupportsToolSearch("claude-sonnet-4-5-20250929")).toBe(true);
    expect(modelSupportsToolSearch("claude-opus-4-5-20251101")).toBe(true);
  });

  it("rejects the models the provider says do not support it", () => {
    // "Claude Opus 4.1 and earlier models don't support the tool search tool."
    for (const m of ["claude-opus-4-1", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "gpt-4", ""]) {
      expect(modelSupportsToolSearch(m), m).toBe(false);
    }
  });

  it("does not let a prefix match a different family by accident", () => {
    expect(modelSupportsToolSearch("claude-sonnet-4-50")).toBe(false);
    expect(modelSupportsToolSearch("claude-opus-45")).toBe(false);
  });

  it("the model this app is configured with is supported", () => {
    expect(modelSupportsToolSearch(process.env.ANTHROPIC_MODEL ?? MODEL)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════ 2 · THE REQUEST THE API WOULD ACCEPT ══ */

describe("the tools array obeys every rule the API enforces", () => {
  it("sends every definition, deferring all but a handful", () => {
    const plan = assistantPlan();
    // "You still send every tool's full definition in the `tools` array on every request."
    expect(plan.tools.length).toBe(allTools().length + 1); // +1 for the search tool
    expect(plan.loadedUpFront).toBe(1 + ALWAYS_LOADED.length);
    expect(plan.deferred).toBe(allTools().length - ALWAYS_LOADED.length);
  });

  it("never defers the search tool, and never defers everything", () => {
    const plan = assistantPlan();
    const search = plan.tools[0] as { type?: string; defer_loading?: boolean };
    expect(search.type).toBe("tool_search_tool_regex_20251119");
    expect(search.defer_loading).toBeUndefined();
    expect(plan.tools.length - deferredOf(plan.tools).length).toBeGreaterThan(0);
  });

  it("puts the one cache breakpoint on a NON-deferred tool", () => {
    // "A tool with `defer_loading: true` can't also carry `cache_control`: the API returns a 400."
    const plan = assistantPlan();
    const cached = cachedOf(plan.tools);
    expect(cached).toHaveLength(1);
    expect((cached[0] as { defer_loading?: boolean }).defer_loading).toBeFalsy();
    expect(deferredOf(plan.tools).some((t) => (t as { cache_control?: unknown }).cache_control)).toBe(false);
  });

  it("the tools that stay loaded are the ones the system prompt tells the model to use", () => {
    const plan = assistantPlan();
    const loaded = plan.tools.filter((t) => !(t as { defer_loading?: boolean }).defer_loading).map((t) => (t as { name?: string }).name);
    for (const n of ALWAYS_LOADED) expect(loaded).toContain(n);
    // Each one is named in the prompt as the way into everything else, so it cannot require a search.
    for (const n of ALWAYS_LOADED) expect(getTool(n), n).toBeTruthy();
    expect(ALWAYS_LOADED.length).toBeGreaterThanOrEqual(3);
    expect(ALWAYS_LOADED.length).toBeLessThanOrEqual(5); // the provider's own recommendation
  });

  it("every deferred tool is still a complete definition", () => {
    // "Ensure every tool that could be discovered has a complete definition" — otherwise a
    // tool_reference to it is a 400.
    for (const t of deferredOf(assistantPlan().tools) as Anthropic.Tool[]) {
      expect(t.name, JSON.stringify(t).slice(0, 80)).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.input_schema).toBeTruthy();
    }
  });

  it("search can reach every module, because every module's tools are in the array", () => {
    const plan = assistantPlan();
    const names = new Set(plan.tools.map((t) => (t as { name?: string }).name));
    const modules = new Set(allTools().map((t) => t.module));
    for (const m of modules) {
      const anyOfModule = allTools().filter((t) => t.module === m);
      expect(anyOfModule.some((t) => names.has(t.name)), m).toBe(true);
    }
    expect(modules.size).toBeGreaterThanOrEqual(19);
  });

  it("the prompt note names the modules so one search finds a whole domain", () => {
    const note = toolSearchPromptSection(["finance", "training"]);
    expect(note).toMatch(/tool search/i);
    expect(note).toContain("finance, training");
    expect(note).toMatch(/Search before concluding you cannot do something/i);
  });
});

/* ═════════════════════════════════════════════════════════════════════ 3 · FALLBACK, NEVER SILENT ══ */

describe("when tool search is not used, the full surface is", () => {
  it("off by default — the flag has to name a variant", () => {
    expect(toolSearchMode({} as NodeJS.ProcessEnv)).toBeNull();
    expect(toolSearchMode({ AI_TOOL_SEARCH: "" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(toolSearchMode({ AI_TOOL_SEARCH: "true" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(toolSearchMode({ AI_TOOL_SEARCH: "regex" } as unknown as NodeJS.ProcessEnv)).toBe("regex");
    expect(toolSearchMode({ AI_TOOL_SEARCH: "BM25" } as unknown as NodeJS.ProcessEnv)).toBe("bm25");
  });

  const fallbacks: [string, ReturnType<typeof planTools>][] = [
    ["disabled", planTools(built(), { kind: "assistant", model: MODEL, env: OFF })],
    ["unsupported_model", planTools(built(), { kind: "assistant", model: "claude-3-opus-20240229", env: ON })],
    ["mode_restricted", planTools(built(), { kind: "quick_entry", model: MODEL, env: ON })],
    ["too_few_tools", planTools(built().slice(0, 5), { kind: "assistant", model: MODEL, env: ON })],
  ];

  for (const [reason, plan] of fallbacks) {
    it(`${reason}: keeps every tool, loaded, with a working breakpoint`, () => {
      expect(plan.skipped).toBe(reason);
      expect(plan.variant).toBeNull();
      expect(plan.deferred).toBe(0);
      expect(plan.loadedUpFront).toBe(plan.tools.length);
      expect(deferredOf(plan.tools)).toHaveLength(0);
      expect(cachedOf(plan.tools)).toHaveLength(1);
      // Nothing is hidden: no capability disappears because search was unavailable.
      expect(plan.tools.every((t) => !(t as { type?: string }).type?.startsWith("tool_search"))).toBe(true);
    });
  }

  it("an unsupported model never receives a tool-search request", () => {
    const plan = planTools(built(), { kind: "assistant", model: "claude-3-5-sonnet-20241022", env: ON });
    expect(JSON.stringify(plan.tools)).not.toContain("tool_search_tool");
    expect(JSON.stringify(plan.tools)).not.toContain("defer_loading");
  });
});

/* ═══════════════════════════════════════════════════════════════════ 4 · MODE LIMITS ARE STRUCTURAL ══ */

describe("Fast Log and the planner keep the limits phase 3.16 gave them", () => {
  it("neither gets tool search", () => {
    expect(modeAllowsSearch("assistant")).toBe(true);
    for (const kind of ["quick_entry", "planner", "german_tutor", ""]) expect(modeAllowsSearch(kind), kind).toBe(false);
  });

  it("the planner cannot DISCOVER a write tool, because none is in its array", () => {
    // This is the structural guarantee, not a prompt instruction: search can only ever return a tool
    // that is present in `tools`, and the planner's array is its own 12.
    const allowed = toolsForMode("planner")!;
    const plan = planTools(built().filter((t) => allowed.includes(t.name)), { kind: "planner", model: MODEL, env: ON });
    const names = plan.tools.map((t) => (t as { name?: string }).name);
    expect(names.sort()).toEqual([...PLANNER_TOOLS].sort());
    for (const forbidden of ["create_task", "create_event", "add_expense", "log_set", "delete_goal"]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });

  it("Fast Log's array is still exactly its own 22", () => {
    const allowed = toolsForMode("quick_entry")!;
    const plan = planTools(built().filter((t) => allowed.includes(t.name)), { kind: "quick_entry", model: MODEL, env: ON });
    expect(plan.tools.map((t) => (t as { name?: string }).name).sort()).toEqual([...FAST_LOG_TOOLS].sort());
    expect(plan.deferred).toBe(0);
  });
});

/* ═════════════════════════════════════════════════════ 5 · NATIVE BLOCKS IN THE TRANSCRIPT ══════ */

type Block = Anthropic.ContentBlockParam;
const userMsg = (t: string): Anthropic.MessageParam => ({ role: "user", content: [{ type: "text", text: t }] });
const searchBlocks = (srvId: string, found: string[]): Block[] => [
  { type: "server_tool_use", id: srvId, name: "tool_search_tool_regex", input: { pattern: "expense", limit: 5 } } as Block,
  { type: "tool_search_tool_result", tool_use_id: srvId, content: { type: "tool_search_tool_search_result", tool_references: found.map((tool_name) => ({ type: "tool_reference", tool_name })) } } as Block,
];

describe("the 3.14 transcript rules, extended to the provider's own blocks", () => {
  it("a complete search turn validates clean and survives repair untouched", () => {
    const t: Anthropic.MessageParam[] = [
      userMsg("gasté 18€"),
      { role: "assistant", content: [{ type: "text", text: "Busco la herramienta." }, ...searchBlocks("srvtoolu_01", ["add_expense"]), { type: "tool_use", id: "toolu_01", name: "add_expense", input: { amount: 18 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "{}" }] },
    ];
    expect(validateTranscript(t)).toEqual([]);
    const { messages: fixed, repaired } = repairTranscript(t);
    expect(repaired).toEqual([]);
    expect(fixed).toEqual(t);
    const wire = JSON.stringify(fixed);
    expect(wire).toContain("server_tool_use");
    expect(wire).toContain("tool_search_tool_result");
    expect(wire).toContain('"tool_name":"add_expense"');
  });

  it("a search that found nothing is valid — empty references, not an error", () => {
    const t: Anthropic.MessageParam[] = [userMsg("hazme un café"), { role: "assistant", content: [...searchBlocks("srvtoolu_02", []), { type: "text", text: "No tengo herramienta para eso." }] }];
    expect(validateTranscript(t)).toEqual([]);
    expect(repairTranscript(t).repaired).toEqual([]);
    expect(JSON.stringify(repairTranscript(t).messages)).toContain('"tool_references":[]');
  });

  it("a search error block is kept verbatim, with its code", () => {
    const t: Anthropic.MessageParam[] = [userMsg("busca"), { role: "assistant", content: [
      { type: "server_tool_use", id: "srvtoolu_03", name: "tool_search_tool_regex", input: { pattern: "((" } } as Block,
      { type: "tool_search_tool_result", tool_use_id: "srvtoolu_03", content: { type: "tool_search_tool_result_error", error_code: "invalid_tool_input", error_message: "bad regex" } } as Block,
    ] }];
    expect(validateTranscript(t)).toEqual([]);
    expect(JSON.stringify(repairTranscript(t).messages)).toContain("invalid_tool_input");
  });

  it("several searches in one turn all survive", () => {
    const t: Anthropic.MessageParam[] = [userMsg("gasté y entrené"), { role: "assistant", content: [
      ...searchBlocks("srvtoolu_4a", ["add_expense"]),
      ...searchBlocks("srvtoolu_4b", ["log_sets"]),
      { type: "tool_use", id: "toolu_04", name: "add_expense", input: { amount: 1 } },
    ] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_04", content: "{}" }] }];
    expect(validateTranscript(t)).toEqual([]);
    const wire = JSON.stringify(repairTranscript(t).messages);
    expect(wire).toContain("srvtoolu_4a");
    expect(wire).toContain("srvtoolu_4b");
  });

  it("a tool_result aimed at a srvtoolu_ id is refused and repaired away", () => {
    // "Don't return a tool_result for the srvtoolu_... ID: the API rejects the request."
    const t: Anthropic.MessageParam[] = [userMsg("gasté 18€"), { role: "assistant", content: searchBlocks("srvtoolu_05", ["add_expense"]) }, { role: "user", content: [{ type: "tool_result", tool_use_id: "srvtoolu_05", content: "{}" }] }];
    expect(validateTranscript(t).map((v) => v.kind)).toContain("orphan_tool_result");
    const { messages: fixed } = repairTranscript(t);
    expect(validateTranscript(fixed)).toEqual([]);
    expect(JSON.stringify(fixed)).not.toContain('"tool_result","tool_use_id":"srvtoolu_05"');
    expect(JSON.stringify(fixed)).toContain("server_tool_use"); // the native pair itself is kept
  });

  it("a turn cut off mid-search leaves no half a pair behind", () => {
    const t: Anthropic.MessageParam[] = [userMsg("gasté 18€"), { role: "assistant", content: [
      { type: "server_tool_use", id: "srvtoolu_06", name: "tool_search_tool_regex", input: { pattern: "expense" } } as Block,
    ] }, userMsg("¿y bien?")];
    expect(validateTranscript(t).map((v) => v.kind)).toContain("orphan_server_tool_use");
    const { messages: fixed } = repairTranscript(t);
    expect(validateTranscript(fixed)).toEqual([]);
    expect(JSON.stringify(fixed)).not.toContain("srvtoolu_06");
  });

  it("repair is still idempotent with native blocks in play", () => {
    const t: Anthropic.MessageParam[] = [userMsg("gasté 18€"), { role: "assistant", content: [...searchBlocks("srvtoolu_07", ["add_expense"]), { type: "tool_use", id: "toolu_07", name: "add_expense", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_07", content: "{}" }] }];
    const once = repairTranscript(t).messages;
    const twice = repairTranscript(once);
    expect(twice.messages).toEqual(once);
    expect(twice.repaired).toEqual([]);
  });
});

/* ══════════════════════════════════════════════ 6 · THE LOOP, DRIVEN BY A PROTOCOL-ACCURATE STUB ══ */

/**
 * A stand-in provider that answers the way the reference documents a tool-search turn: a
 * `server_tool_use` with a `srvtoolu_` id, a `tool_search_tool_result` carrying `tool_reference`
 * blocks, then a `tool_use` for the discovered tool. It records the `tools` array it was handed.
 */
function searchingClient(discover: string, input: unknown, opts: { emptyFirst?: boolean; error?: boolean } = {}) {
  const sent: { tools: number; deferred: number; names: string[] }[] = [];
  let call = 0;
  const build = () => {
    const srvId = `srvtoolu_stub_${call}`;
    if (call === 0) {
      const result = opts.error
        ? { type: "tool_search_tool_result", tool_use_id: srvId, content: { type: "tool_search_tool_result_error", error_code: "unavailable", error_message: "search is down" } }
        : { type: "tool_search_tool_result", tool_use_id: srvId, content: { type: "tool_search_tool_search_result", tool_references: opts.emptyFirst ? [] : [{ type: "tool_reference", tool_name: discover }] } };
      const content: unknown[] = [
        { type: "text", text: "Busco la herramienta adecuada." },
        { type: "server_tool_use", id: srvId, name: "tool_search_tool_regex", input: { pattern: discover.split("_")[0], limit: 5 } },
        result,
      ];
      if (!opts.emptyFirst && !opts.error) content.push({ type: "tool_use", id: `toolu_stub_${Date.now()}`, name: discover, input });
      return { id: `msg_${call}`, content, stop_reason: opts.emptyFirst || opts.error ? "end_turn" : "tool_use", usage: { input_tokens: 9, output_tokens: 4 } };
    }
    return { id: `msg_${call}`, content: [{ type: "text", text: "Hecho." }], stop_reason: "end_turn", usage: { input_tokens: 9, output_tokens: 4 } };
  };
  const record = (p: { tools?: unknown[] }) => sent.push({
    tools: p.tools?.length ?? 0,
    deferred: (p.tools ?? []).filter((t) => (t as { defer_loading?: boolean }).defer_loading).length,
    names: (p.tools ?? []).map((t) => (t as { name?: string }).name ?? ""),
  });
  const client = {
    messages: {
      async create(p: { tools?: unknown[] }) { record(p); const m = build(); call++; return m; },
      stream(p: { tools?: unknown[] }) { record(p); const step = build(); const s = { on() { return s; }, async finalMessage() { call++; return step; } }; return s; },
    },
  };
  return { client: client as never, sent };
}
type ChatOpts = Parameters<typeof chat>[1] & { client?: unknown };
const run = (u: Parameters<typeof chat>[0], o: ChatOpts) => chat(u, o as Parameters<typeof chat>[1]);
const rowsOf = (id: string) => db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt));
const blocksIn = (row: { content: unknown }) => (Array.isArray(row.content) ? row.content : []) as { type: string; id?: string; tool_use_id?: string; name?: string }[];

d("a discovered tool runs through the ordinary registry path", () => {
  let u: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("the search happens, the tool is discovered, and the record is written", async () => {
    const { client } = searchingClient("add_expense", { amount: 18, category: "Comida", description: "menú" });
    const r = await run(u, { text: "gasté 18€ en comida", client });
    expect(r.actions.map((a) => `${a.tool}:${a.status}`)).toEqual(["add_expense:success"]);
  });

  it("no tool_result is ever produced for the srvtoolu_ id", async () => {
    const { client } = searchingClient("create_task", { title: "Llamar al dentista" });
    const r = await run(u, { text: "recuérdame llamar al dentista", client });
    const rows = await rowsOf(r.conversationId);
    const results = rows.flatMap(blocksIn).filter((b) => b.type === "tool_result");
    expect(results.length).toBeGreaterThan(0);
    for (const res of results) expect(res.tool_use_id, "a tool_result answered the server's own id").not.toMatch(/^srvtoolu_/);
  });

  it("the native blocks are persisted verbatim and replay clean", async () => {
    const { client } = searchingClient("create_journal_entry", { content: "Hoy he dormido fatal." });
    const r = await run(u, { text: "apunta en el diario que dormí fatal", client });
    const rows = await rowsOf(r.conversationId);
    const wire = JSON.stringify(rows.map((x) => x.content));
    expect(wire).toContain("server_tool_use");
    expect(wire).toContain("tool_search_tool_result");
    expect(wire).toContain('"tool_name":"create_journal_entry"');

    const replay: Anthropic.MessageParam[] = [];
    for (const row of rows) {
      if (row.role !== "user" && row.role !== "assistant") continue;
      const last = replay[replay.length - 1];
      const content = (row.content as Anthropic.MessageParam["content"]) ?? row.text;
      if (last && last.role === row.role && Array.isArray(last.content) && Array.isArray(content)) last.content = [...last.content, ...content];
      else replay.push({ role: row.role as "user" | "assistant", content });
    }
    expect(validateTranscript(replay)).toEqual([]);
  });

  it("a conversation with a previous search can be continued", async () => {
    const first = searchingClient("add_expense", { amount: 5, category: "Comida" });
    const r = await run(u, { text: "gasté 5€", client: first.client });
    const second = searchingClient("add_expense", { amount: 7, category: "Comida" });
    const r2 = await run(u, { conversationId: r.conversationId, text: "y otros 7€", client: second.client });
    expect(r2.conversationId).toBe(r.conversationId);
    expect(r2.actions.map((a) => a.status)).toEqual(["success"]);
    // The history it sent still contained the earlier native blocks, unchanged.
    expect(validateTranscript([])).toEqual([{ kind: "empty_transcript", index: -1, role: "user", detail: "no messages" }]);
  });

  it("a search that finds nothing ends the turn cleanly, writing nothing", async () => {
    const { client } = searchingClient("add_expense", {}, { emptyFirst: true });
    const r = await run(u, { text: "hazme un café", client });
    expect(r.actions).toEqual([]);
    expect(r.pending).toEqual([]);
    const rows = await rowsOf(r.conversationId);
    expect(JSON.stringify(rows.map((x) => x.content))).toContain('"tool_references":[]');
  });

  it("a search that errors ends the turn cleanly, writing nothing", async () => {
    const { client } = searchingClient("add_expense", {}, { error: true });
    const r = await run(u, { text: "busca algo", client });
    expect(r.actions).toEqual([]);
    const rows = await rowsOf(r.conversationId);
    expect(JSON.stringify(rows.map((x) => x.content))).toContain("tool_search_tool_result_error");
  });

  it("a discovered high-risk tool still waits for the user", async () => {
    // Discovery changes what Claude can see. It does not change what Claude may do.
    const { client } = searchingClient("create_transfer", { amount: 100, fromAccountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", toAccountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302" });
    const r = await run(u, { text: "transfiere 100€", client });
    expect(r.pending.map((p) => `${p.tool}:${p.status}`)).toEqual(["create_transfer:pending_confirmation"]);
    expect(r.actions).toEqual([]);
  });

  it("a discovered tool that is not in the registry is refused, not invented", async () => {
    const { client } = searchingClient("totally_made_up_tool", {});
    const r = await run(u, { text: "haz magia", client });
    const rows = await rowsOf(r.conversationId);
    const answer = rows.flatMap(blocksIn).find((b) => b.type === "tool_result") as { content?: string } | undefined;
    expect(String(answer?.content)).toMatch(/unknown tool/i);
  });

  it("a discovered tool still cannot reach another account's data", async () => {
    const other = await createTestUser();
    try {
      const mine = searchingClient("create_task", { title: "Tarea de A" });
      const r = await run(u, { text: "crea una tarea", client: mine.client });
      expect(r.actions[0].status).toBe("success");
      const theirs = searchingClient("get_tasks", { view: "all" });
      const r2 = await run(other, { text: "dame mis tareas", client: theirs.client });
      expect(JSON.stringify(r2.actions[0].result)).not.toContain("Tarea de A");
    } finally {
      await deleteTestUser(other.id);
    }
  });
});

d("what the loop actually sends", () => {
  let u: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("with the flag off, every tool goes out loaded — today's behaviour", async () => {
    const before = process.env.AI_TOOL_SEARCH;
    delete process.env.AI_TOOL_SEARCH;
    try {
      const { client, sent } = searchingClient("add_expense", { amount: 1, category: "x" });
      await run(u, { text: "gasté 1€", client });
      expect(sent[0].tools).toBe(allTools().length);
      expect(sent[0].deferred).toBe(0);
      expect(sent[0].names).not.toContain("tool_search_tool_regex");
    } finally {
      if (before === undefined) delete process.env.AI_TOOL_SEARCH; else process.env.AI_TOOL_SEARCH = before;
    }
  });

  it("with the flag on, the catalogue is sent but deferred, and the search tool leads", async () => {
    const before = process.env.AI_TOOL_SEARCH;
    process.env.AI_TOOL_SEARCH = "regex";
    try {
      const { client, sent } = searchingClient("add_expense", { amount: 1, category: "x" });
      await run(u, { text: "gasté 1€", client });
      expect(sent[0].tools).toBe(allTools().length + 1);
      expect(sent[0].deferred).toBe(allTools().length - ALWAYS_LOADED.length);
      expect(sent[0].names[0]).toBe("tool_search_tool_regex");
    } finally {
      if (before === undefined) delete process.env.AI_TOOL_SEARCH; else process.env.AI_TOOL_SEARCH = before;
    }
  });

  it("Fast Log is untouched by the flag", async () => {
    const before = process.env.AI_TOOL_SEARCH;
    process.env.AI_TOOL_SEARCH = "regex";
    try {
      const { client, sent } = searchingClient("add_expense", { amount: 1, category: "x" });
      await run(u, { text: "gasté 1€", kind: "quick_entry", client });
      expect(sent[0].tools).toBe(FAST_LOG_TOOLS.length);
      expect(sent[0].deferred).toBe(0);
      expect(sent[0].names).not.toContain("tool_search_tool_regex");
    } finally {
      if (before === undefined) delete process.env.AI_TOOL_SEARCH; else process.env.AI_TOOL_SEARCH = before;
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════════ 7 · SECURITY ══ */

describe("discovery cannot become an authorisation hole", () => {
  it("the search only ever returns tools this app registered", () => {
    // A `tool_reference` the API cannot resolve in `tools` is a 400, so discovery is bounded by the
    // array we build — which is built from the registry, never from a message.
    const names = new Set(assistantPlan().tools.map((t) => (t as { name?: string }).name));
    for (const n of names) {
      if (String(n).startsWith("tool_search_tool")) continue;
      expect(getTool(String(n)), `${n} is in the request but not in the registry`).toBeTruthy();
    }
  });

  it("no tool in the plan takes a user id, a role, or its own confirmation", () => {
    for (const t of assistantPlan().tools) {
      const schema = (t as { input_schema?: { properties?: Record<string, unknown> } }).input_schema;
      const keys = Object.keys(schema?.properties ?? {});
      expect(keys.filter((k) => /^(userid|user_id|role|confirmed|isadmin)$/i.test(k)), String((t as { name?: string }).name)).toEqual([]);
    }
  });

  it("deferring a tool does not change its risk", () => {
    const plan = assistantPlan();
    for (const t of deferredOf(plan.tools) as Anthropic.Tool[]) {
      const registered = getTool(t.name);
      expect(registered, t.name).toBeTruthy();
      // The description still carries the risk tag it was registered with.
      expect(t.description).toContain(`· ${registered!.risk}]`);
    }
  });

  it("there are no admin tools to discover", () => {
    const names = assistantPlan().tools.map((t) => String((t as { name?: string }).name));
    expect(names.filter((n) => /admin|impersonat|as_user|set_role|list_users|deactivate/i.test(n))).toEqual([]);
  });

  it("the flag is read from the environment, never from a request", () => {
    // `planTools` takes an env object; nothing in its signature accepts user text.
    expect(planTools.length).toBe(2);
    const plan = planTools(built(), { kind: "assistant", model: MODEL, env: { AI_TOOL_SEARCH: "regex; DROP TABLE" } as unknown as NodeJS.ProcessEnv });
    expect(plan.variant).toBeNull();
    expect(plan.skipped).toBe("disabled");
  });
});
