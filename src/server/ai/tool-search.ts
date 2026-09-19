import type Anthropic from "@anthropic-ai/sdk";

/**
 * Native tool search: let the provider load tool definitions on demand instead of sending all 144 into
 * the model's context on every request.
 *
 * WHY THIS AND NOT A ROUTER. Phase 3.16 measured a hand-written router and turned it down: the tool block
 * is the cached prefix, so varying it per message pays a cache write (2-3x dearer) on every topic switch,
 * and a router that misses a domain silently removes a capability. Tool search has neither problem. The
 * `tools` array stays byte-identical on every request — every definition is still sent — and the API
 * simply excludes the deferred ones from the prefix it shows the model, expanding them inline when Claude
 * searches. The provider's own words: "The prefix is untouched, so prompt caching is preserved."
 *
 * THE RULES, from the API reference (platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool):
 *   · every tool definition is still sent in `tools`, deferred or not — `defer_loading` controls context,
 *     not the request payload;
 *   · at least one tool must be non-deferred, and it must never be the search tool itself;
 *   · a deferred tool may NOT carry `cache_control` — the API answers 400 — so the breakpoint has to sit
 *     on a non-deferred tool;
 *   · the search runs server-side and comes back as `server_tool_use` + `tool_search_tool_result`; those
 *     blocks are echoed back unchanged and must never be answered with a `tool_result`;
 *   · a search that matches nothing returns an empty `tool_references` array, not an error.
 *
 * WHAT IS NOT PROVEN HERE. There is no ANTHROPIC_API_KEY in this environment, so nothing below has been
 * exercised against the real provider: the request shape follows the published reference and the types
 * ship in the installed SDK, but whether Claude discovers the right tool for a Spanish sentence is
 * unmeasured. That is why this is opt-in and off by default — see `toolSearchMode`.
 */

/**
 * Models the provider lists as supporting `tool_search_tool_*_20251119`, verbatim from the compatibility
 * table. Checked by prefix so that both the dated id and its undated alias match
 * (`claude-sonnet-4-5-20250929` and `claude-sonnet-4-5`), which is how this app configures its model.
 */
const SUPPORTED_MODEL_PREFIXES = [
  "claude-fable-5-1", "claude-mythos-5-1", "claude-fable-5", "claude-mythos-5",
  "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
  "claude-sonnet-4-6", "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5",
] as const;

export function modelSupportsToolSearch(model: string): boolean {
  const m = model.trim().toLowerCase();
  return SUPPORTED_MODEL_PREFIXES.some((p) => m === p || m.startsWith(p + "-"));
}

export type ToolSearchVariant = "regex" | "bm25";

/**
 * Off unless `AI_TOOL_SEARCH` names a variant.
 *
 * Deliberately opt-in: this app's assistant is the one surface where a tool that fails to be discovered
 * is a capability the user silently loses, and that cannot be measured without a key. Turning it on is a
 * decision someone makes with evidence, not a default that ships quietly.
 */
export function toolSearchMode(env: NodeJS.ProcessEnv = process.env): ToolSearchVariant | null {
  const raw = (env.AI_TOOL_SEARCH ?? "").trim().toLowerCase();
  if (raw === "regex" || raw === "bm25") return raw;
  return null;
}

/** Why a request is not using tool search. Logged once per turn, never shown to a user. */
export type ToolSearchSkip = "disabled" | "unsupported_model" | "too_few_tools" | "mode_restricted";

/**
 * Below this many tools the provider's own guidance is to use standard tool calling: "Standard tool
 * calling, without tool search, is a better fit when you have fewer than 10 tools". Fast Log (22) and the
 * planner (12) are also excluded by `modeAllowsSearch` — they are latency-sensitive and already small, and
 * a search would add a model round-trip to a one-liner.
 */
const MIN_TOOLS_FOR_SEARCH = 30;

/** Only the open-ended assistant benefits; the scoped modes keep the surface phase 3.16 gave them. */
export function modeAllowsSearch(kind: string): boolean {
  return kind === "assistant";
}

export interface ToolSearchPlan {
  /** The `tools` array to send, whether or not search is in play. */
  tools: Anthropic.ToolUnion[];
  /** Null when search is on; otherwise why it is not. */
  skipped: ToolSearchSkip | null;
  variant: ToolSearchVariant | null;
  /** Definitions the model sees up front. With search on this is the search tool + `alwaysLoaded`. */
  loadedUpFront: number;
  /** Definitions sent but kept out of the prefix until discovered. */
  deferred: number;
}

/**
 * The handful of tools that stay in context without a search.
 *
 * Not a guess at "most used": these are the four the system prompt itself instructs the model to reach
 * for as the way into everything else — search the user's data, widen the snapshot, and read or write a
 * durable memory. If they had to be discovered first, the prompt's own instructions would not work.
 */
export const ALWAYS_LOADED = ["search_personal_os", "get_snapshot", "search_memory", "remember_memory"] as const;

/**
 * What to tell the model when its tools are discoverable rather than all present.
 *
 * Kept to two lines. The provider recommends naming the categories so Claude knows what it can look for;
 * the module names are the same ones every tool description already carries in its `[module · risk]` tag,
 * so one search on a module name finds that whole domain.
 */
export function toolSearchPromptSection(modules: readonly string[]): string {
  return [
    "TOOLS",
    `- Only a few tools are loaded right now. Everything else is found with the tool search tool, which searches tool names, descriptions and argument names. Search before concluding you cannot do something.`,
    `- Every tool's description starts with its module, so searching a module name finds that whole area. The modules are: ${modules.join(", ")}.`,
  ].join("\n");
}

const searchToolDefinition = (variant: ToolSearchVariant): Anthropic.ToolUnion =>
  variant === "bm25"
    ? { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" }
    : { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_regex" };

/**
 * Builds the `tools` array for one request.
 *
 * When search is off this is the previous behaviour exactly: every tool, breakpoint on the last one.
 * When it is on, the order is search tool → always-loaded → deferred, and the breakpoint goes on the last
 * ALWAYS-LOADED tool, because a deferred tool carrying `cache_control` is a 400.
 */
export function planTools(
  all: readonly Anthropic.Tool[],
  opts: { kind: string; model: string; env?: NodeJS.ProcessEnv } ,
): ToolSearchPlan {
  const withBreakpointOnLast = (tools: readonly Anthropic.Tool[]): Anthropic.ToolUnion[] => {
    if (!tools.length) return [];
    const out = tools.slice() as Anthropic.Tool[];
    out[out.length - 1] = { ...out[out.length - 1], cache_control: { type: "ephemeral" } };
    return out;
  };
  const off = (skipped: ToolSearchSkip): ToolSearchPlan => ({
    tools: withBreakpointOnLast(all),
    skipped,
    variant: null,
    loadedUpFront: all.length,
    deferred: 0,
  });

  const variant = toolSearchMode(opts.env);
  if (!variant) return off("disabled");
  if (!modeAllowsSearch(opts.kind)) return off("mode_restricted");
  if (!modelSupportsToolSearch(opts.model)) return off("unsupported_model");
  if (all.length < MIN_TOOLS_FOR_SEARCH) return off("too_few_tools");

  const always = all.filter((t) => (ALWAYS_LOADED as readonly string[]).includes(t.name));
  // If the always-loaded set is somehow empty the request would defer everything, which the API rejects
  // outright. Falling back to the whole surface is the safe answer; never send a request we know is bad.
  if (!always.length) return off("too_few_tools");

  const deferred = all
    .filter((t) => !(ALWAYS_LOADED as readonly string[]).includes(t.name))
    .map((t) => ({ ...t, defer_loading: true }) as Anthropic.Tool);

  // Breakpoint on the last non-deferred tool: that is exactly the prefix the API keeps.
  const loaded = withBreakpointOnLast(always);
  return {
    tools: [searchToolDefinition(variant), ...loaded, ...deferred],
    skipped: null,
    variant,
    loadedUpFront: 1 + always.length,
    deferred: deferred.length,
  };
}

/** True for a block the provider produced and owns; we echo these back and never answer them. */
export function isNativeServerBlock(b: { type?: unknown }): boolean {
  return b.type === "server_tool_use" || b.type === "tool_search_tool_result";
}

/** Server-side tool ids are prefixed `srvtoolu_`; returning a `tool_result` for one is a 400. */
export const SERVER_TOOL_ID_PREFIX = "srvtoolu_";
