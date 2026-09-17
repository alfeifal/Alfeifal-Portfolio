import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { aiActionLogs, conversations, messages } from "@/server/db/schema";
import type { SessionUser } from "@/server/auth/session";
import { AI_MODEL, anthropic } from "./client";
import { allTools, getTool, type ToolDefinition } from "./registry";
import { toInputSchema } from "./schema-json";
import { buildSystemPrompt } from "./context";
import type { SnapshotSection } from "@/server/services/snapshot";
import { audit } from "@/server/audit";
import { AppError } from "@/server/http";
import { getPreferences } from "@/server/services/users";
import { conversationExpiry, touchConversation } from "@/server/services/conversations";
import { encodeEvent, turnOutcome, type ChatStreamEvent, type TurnOutcome } from "./stream";
import { asUserFacingAiError, logAiError, safeAiMessage } from "./errors";
import { assertSendable, blocksOf, repairTranscript, UNKNOWN_RESULT, type Recovered, type Violation } from "./transcript";
import "./tools"; // registers every tool

const MAX_TOOL_ROUNDS = 8;
const PENDING_TTL_MS = 30 * 60 * 1000;
const HISTORY_LIMIT = 40;

/**
 * Room for one assistant turn.
 *
 * This was 2048 and that is what broke a real conversation: the served model emits `thinking` blocks,
 * they count against `max_tokens` like any other output, and a turn that had already produced three
 * `tool_use` blocks hit the ceiling before it could finish — leaving the transcript unusable and three
 * workout sets unlogged. The ceiling has to sit above a realistic turn, not inside one.
 */
const MAX_OUTPUT_TOKENS = 8192;

/** Shown when the model ran out of room mid-turn. The tool calls it had started were never run. */
const STOPPED_SHORT = "I ran out of room before I could finish that, so nothing was saved. Send it again — splitting it into smaller steps helps.";
/** Shown when the tool loop used every round it is allowed and still had not reached an answer. */
const TOO_MANY_ROUNDS = "That needed more steps than I'm allowed to take in one go. Some of it may already be saved — check, then ask me for the rest.";

/** `module` is the tool's registry module: the client uses it to refetch exactly the data this action changed. */
export interface ExecutedAction { logId: string; tool: string; module: string; risk: string; status: string; summary: string | null; params: unknown; result?: unknown; error?: string | null }
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ChatResult { conversationId: string; messageId: string; text: string; actions: ExecutedAction[]; pending: ExecutedAction[]; outcome: TurnOutcome; usage: Usage }

/**
 * The tool block is ~92 kB of JSON for 134 tools and is identical on every request, so it is built
 * once per process instead of being re-serialised (and re-converted from Zod) on each message.
 */
let toolCache: Anthropic.Tool[] | null = null;
function anthropicTools(): Anthropic.Tool[] {
  toolCache ??= allTools().map((t) => ({ name: t.name, description: `[${t.module} · ${t.risk}] ${t.description}`, input_schema: toInputSchema(t.schema) as Anthropic.Tool.InputSchema }));
  return toolCache;
}

/**
 * Marks the end of the tool block as a prompt-cache breakpoint.
 *
 * Those ~25k tokens are the same for every user and every message, and they dominate both the time to
 * first token and the cost of a turn. Caching them keeps all 134 tools available to the model — no
 * routing, no capability lost — while only the system prompt and the transcript, which genuinely
 * change, are processed fresh.
 */
function withCacheBreakpoint(tools: Anthropic.Tool[]): Anthropic.Tool[] {
  if (!tools.length) return tools;
  const out = tools.slice();
  out[out.length - 1] = { ...out[out.length - 1], cache_control: { type: "ephemeral" } };
  return out;
}

/** Test seam: the memoised tool block must not outlive a registry that changed. */
export function __resetToolCache() { toolCache = null; }

/** Continues the given conversation only while it is alive; an expired transcript starts a fresh one (never resurrected). */
async function ensureConversation(user: SessionUser, conversationId: string | null, kind: string, firstUserText: string) {
  if (conversationId) {
    const [c] = await db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)));
    if (c && c.expiresAt > new Date()) return c;
  }
  const [c] = await db.insert(conversations).values({ userId: user.id, kind, title: firstUserText.slice(0, 80), expiresAt: conversationExpiry() }).returning();
  return c;
}

type MessageRow = typeof messages.$inferSelect;

/**
 * What a `tool_use` that was never answered in the transcript should be told, based on evidence.
 *
 * `ai_action_logs` is the durable record — it outlives the 24 h transcript and is written on every path
 * a tool can take. So a round whose `tool_result` row went missing is not guesswork: if the call is in
 * the log, its real outcome is replayed, and the conversation carries on as if nothing had happened. Only
 * a call with no log at all falls back to "outcome unknown, go and look" — never to "it did not happen",
 * which is the answer that would have the model do it a second time.
 *
 * Calls are matched to logs by (assistant message, tool name) and paired in order, because that is the
 * order the tool loop runs them in. A call the log cannot account for simply gets no entry here.
 */
async function recoveryMap(conversationId: string, rows: readonly MessageRow[]): Promise<Map<string, Recovered>> {
  const byMessage = new Map<string, { id: string; name: string }[]>();
  for (const r of rows) {
    if (r.role !== "assistant") continue;
    const uses = blocksOf(r.content as Anthropic.MessageParam["content"]).filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlockParam[];
    if (uses.length) byMessage.set(r.id, uses.map((u) => ({ id: u.id, name: u.name })));
  }
  const out = new Map<string, Recovered>();
  if (!byMessage.size) return out; // no tool calls in this transcript: no query, no cost

  const logs = await db.select().from(aiActionLogs).where(eq(aiActionLogs.conversationId, conversationId)).orderBy(asc(aiActionLogs.createdAt));
  for (const [messageId, uses] of byMessage) {
    const queue = new Map<string, (typeof logs)[number][]>();
    for (const l of logs) {
      if (l.messageId !== messageId) continue;
      const q = queue.get(l.tool) ?? [];
      q.push(l);
      queue.set(l.tool, q);
    }
    for (const u of uses) {
      const log = queue.get(u.name)?.shift();
      if (!log) continue;
      if (log.status === "failed") out.set(u.id, { content: `FAILED: ${log.error ?? "the action could not be completed"}. Tell the user clearly that this action failed and was not saved.`, isError: true });
      else if (log.status === "pending_confirmation") out.set(u.id, { content: `NOT EXECUTED. This action is still waiting for the user's explicit confirmation. Do not claim it was done.`, isError: false });
      else if (log.status === "rejected") out.set(u.id, { content: "NOT EXECUTED. The user declined this action. Do not do it and do not offer it again unless they ask.", isError: false });
      else if (log.status === "expired") out.set(u.id, { content: "NOT EXECUTED. The confirmation for this action expired. Ask the user whether they still want it.", isError: false });
      else out.set(u.id, { content: JSON.stringify(log.result ?? null).slice(0, 30000), isError: false });
    }
  }
  return out;
}

/**
 * Replays persisted messages as Anthropic messages.
 *
 * Content blocks are kept verbatim — `tool_use`, `tool_result` and the model's signed `thinking` blocks
 * all have to come back exactly as they were sent — and the result then goes through `repairTranscript`,
 * which is what makes a conversation that was corrupted before this phase usable again. The repair is
 * read-only: the rows in the database are never edited, so nothing historical is rewritten and the same
 * repair is recomputed, identically, on every request.
 *
 * The window is the most recent `limit` rows. It can cut a tool round in half — the assistant turn falls
 * off the top while its answers survive — and that used to produce an invalid request too; the repair
 * drops answers that no longer have a question in view.
 */
async function history(conversationId: string, limit = HISTORY_LIMIT): Promise<{ messages: Anthropic.MessageParam[]; repaired: Violation[] }> {
  // `id` is only a tiebreaker: `created_at` is per-statement and distinct in practice, but two rows in
  // the same microsecond must not come back in a different order on two different requests.
  const rows = (await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit)).reverse();
  const raw: Anthropic.MessageParam[] = rows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: (m.content as Anthropic.MessageParam["content"] | null) ?? m.text }));
  const recovered = await recoveryMap(conversationId, rows);
  return repairTranscript(raw, { recover: (u) => recovered.get(u.id) });
}

export async function runTool(tool: ToolDefinition, rawInput: unknown, ctx: { user: SessionUser; conversationId: string | null; messageId?: string | null; confirmed: boolean }): Promise<ExecutedAction> {
  const started = Date.now();
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    const [log] = await db.insert(aiActionLogs).values({ userId: ctx.user.id, conversationId: ctx.conversationId, messageId: ctx.messageId ?? null, tool: tool.name, risk: tool.risk, params: rawInput, status: "failed", error: "Invalid parameters: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), durationMs: Date.now() - started }).returning();
    return { logId: log.id, tool: tool.name, module: tool.module, risk: tool.risk, status: "failed", summary: null, params: rawInput, error: log.error };
  }
  const input = parsed.data;
  const prefs = await getPreferences(ctx.user.id);
  const confirmMedium = (prefs.ai as { confirmMedium?: boolean } | undefined)?.confirmMedium ?? false;
  let needs: boolean | string = tool.risk === "high";
  if (!needs && tool.risk === "medium") needs = confirmMedium || (tool.needsConfirmation?.(input, { ...ctx }) ?? false);
  if (needs && !ctx.confirmed) {
    const [log] = await db.insert(aiActionLogs).values({ userId: ctx.user.id, conversationId: ctx.conversationId, messageId: ctx.messageId ?? null, tool: tool.name, risk: tool.risk, params: input, status: "pending_confirmation", summary: typeof needs === "string" ? needs : tool.summarize?.(input, null) ?? tool.name, expiresAt: new Date(Date.now() + PENDING_TTL_MS) }).returning();
    return { logId: log.id, tool: tool.name, module: tool.module, risk: tool.risk, status: "pending_confirmation", summary: log.summary, params: input };
  }
  try {
    const result = await tool.run(input, { user: ctx.user, conversationId: ctx.conversationId, confirmed: ctx.confirmed });
    const summary = tool.summarize?.(input, result) ?? tool.name;
    const [log] = await db.insert(aiActionLogs).values({ userId: ctx.user.id, conversationId: ctx.conversationId, messageId: ctx.messageId ?? null, tool: tool.name, risk: tool.risk, params: input, result: truncate(result), status: ctx.confirmed ? "confirmed" : "success", summary, confirmedAt: ctx.confirmed ? new Date() : null, durationMs: Date.now() - started }).returning();
    if (tool.risk !== "read") await audit({ userId: ctx.user.id, actor: "ai", action: `ai.${tool.name}`, metadata: { logId: log.id, summary } });
    return { logId: log.id, tool: tool.name, module: tool.module, risk: tool.risk, status: log.status, summary, params: input, result };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const [log] = await db.insert(aiActionLogs).values({ userId: ctx.user.id, conversationId: ctx.conversationId, messageId: ctx.messageId ?? null, tool: tool.name, risk: tool.risk, params: input, status: "failed", error, durationMs: Date.now() - started }).returning();
    return { logId: log.id, tool: tool.name, module: tool.module, risk: tool.risk, status: "failed", summary: null, params: input, error };
  }
}

function truncate(v: unknown) {
  try {
    const s = JSON.stringify(v);
    return s.length > 20000 ? { truncated: true, preview: s.slice(0, 20000) } : v;
  } catch {
    return String(v);
  }
}

type Emit = (e: ChatStreamEvent) => void;
const noEmit: Emit = () => {};

/**
 * Chat with tool use. Tools run through `runTool` so every action is validated, risk-gated and logged.
 * The model is told explicitly when a tool failed or is awaiting confirmation, so it never claims success.
 *
 * One implementation serves both the plain and the streaming route: `emit` receives the assistant's text
 * as it is produced when streaming, and does nothing otherwise. Messages are persisted once per round,
 * never per chunk.
 */
async function runChat(user: SessionUser, opts: { conversationId?: string | null; text: string; kind?: string; systemExtra?: string; maxRounds?: number; allowedTools?: string[]; snapshotSections?: readonly SnapshotSection[]; stream?: boolean; signal?: AbortSignal; client?: Pick<ReturnType<typeof anthropic>, "messages"> }, emit: Emit = noEmit): Promise<ChatResult> {
  const client = opts.client ?? anthropic();
  const conv = await ensureConversation(user, opts.conversationId ?? null, opts.kind ?? "assistant", opts.text);
  emit({ type: "start", conversationId: conv.id });
  const [userMsg] = await db.insert(messages).values({ conversationId: conv.id, role: "user", text: opts.text, content: [{ type: "text", text: opts.text }] }).returning();
  const system = await buildSystemPrompt(user, opts.systemExtra, opts.snapshotSections);
  const tools = withCacheBreakpoint(opts.allowedTools ? anthropicTools().filter((t) => opts.allowedTools!.includes(t.name)) : anthropicTools());
  const { messages: transcript, repaired } = await history(conv.id);
  if (repaired.length) console.warn("[ai] repaired a stored transcript before sending", { conversationId: conv.id, repaired });
  const actions: ExecutedAction[] = [];
  const pending: ExecutedAction[] = [];
  let usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let finalText = "";
  let lastAssistantId = userMsg.id;
  const rounds = opts.maxRounds ?? MAX_TOOL_ROUNDS;

  for (let round = 0; round <= rounds; round++) {
    // Interruption is honoured between rounds, never inside one: abandoning a round half-way is how a
    // `tool_use` ends up with nothing to answer it. A round that has started always finishes and persists.
    if (opts.signal?.aborted) break;

    // Last gate before the provider. Cheap (one pass over ≤40 messages) and absolute: a request we can
    // see is invalid is never sent — it is raised here, where it can be logged with its violations.
    assertSendable(transcript);

    const params = { model: AI_MODEL(), max_tokens: MAX_OUTPUT_TOKENS, system, tools, messages: transcript };
    let res: Anthropic.Message;
    if (opts.stream && typeof (client.messages as { stream?: unknown }).stream === "function") {
      const s = client.messages.stream(params);
      s.on("text", (delta: string) => { if (delta) emit({ type: "text", delta }); });
      res = await s.finalMessage();
    } else {
      res = await client.messages.create(params);
    }
    usage = {
      input: usage.input + res.usage.input_tokens,
      output: usage.output + res.usage.output_tokens,
      cacheRead: usage.cacheRead + (res.usage.cache_read_input_tokens ?? 0),
      cacheWrite: usage.cacheWrite + (res.usage.cache_creation_input_tokens ?? 0),
    };
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    /*
     * The turn ended for a reason other than tool use — `max_tokens`, a refusal, a pause — but the model
     * had already started calling tools. Those calls will never run and nothing will ever answer them, so
     * they must not be written down: a stored `tool_use` with no `tool_result` poisons every later message
     * in the conversation. The text and the reasoning are kept; only the dangling calls are dropped, and
     * the user is told plainly that nothing was saved.
     */
    const cutOff = res.stop_reason !== "tool_use" && toolUses.length > 0;
    if (cutOff) console.warn("[ai] turn stopped mid tool call", { conversationId: conv.id, stopReason: res.stop_reason, dropped: toolUses.map((t) => t.name) });
    // The notice is written into the message, not just returned, so a reload shows the same thing the
    // live turn showed — and so the model can see, next turn, that its own turn was cut off.
    const content = cutOff ? [...res.content.filter((b) => b.type !== "tool_use"), { type: "text" as const, text: STOPPED_SHORT }] : res.content;
    const shownText = cutOff ? [text, STOPPED_SHORT].filter(Boolean).join("\n\n") : text;

    const [assistantMsg] = await db.insert(messages).values({ conversationId: conv.id, role: "assistant", text: shownText, content, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }).returning();
    lastAssistantId = assistantMsg.id;
    transcript.push({ role: "assistant", content });

    if (cutOff) {
      // A streamed turn only ever shows what the model itself produced, so the notice has to be pushed
      // down the wire as well — otherwise the browser shows nothing at all, which is what it did.
      emit({ type: "text", delta: (text ? "\n\n" : "") + STOPPED_SHORT });
      finalText = shownText;
      break;
    }
    if (res.stop_reason !== "tool_use" || !toolUses.length) { finalText = text; break; }

    /*
     * From here the assistant message on record contains `tool_use` blocks, so the matching `tool_result`
     * message MUST be written whatever happens next — including if something throws on a path `runTool`
     * does not catch. `finally` is the whole point: it turns a crash into a conversation that still works.
     */
    const results: Anthropic.ToolResultBlockParam[] = [];
    let persisted = false;
    const persistResults = async () => {
      if (persisted) return;
      persisted = true;
      for (const tu of toolUses) {
        if (results.some((r) => r.tool_use_id === tu.id)) continue;
        results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: UNKNOWN_RESULT });
      }
      results.sort((a, b) => toolUses.findIndex((t) => t.id === a.tool_use_id) - toolUses.findIndex((t) => t.id === b.tool_use_id));
      await db.insert(messages).values({ conversationId: conv.id, role: "user", text: "", content: results });
      transcript.push({ role: "user", content: results });
    };

    try {
      for (const tu of toolUses) {
        const tool = getTool(tu.name);
        if (!tool) { results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}` }); continue; }
        emit({ type: "tool", name: tool.name });
        const action = await runTool(tool, tu.input, { user, conversationId: conv.id, messageId: assistantMsg.id, confirmed: false });
        if (action.status === "pending_confirmation") {
          pending.push(action);
          emit({ type: "pending", action });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: `NOT EXECUTED. This action requires the user's explicit confirmation (risk: ${tool.risk}). A confirmation card was shown to the user (action id ${action.logId}). Tell the user it is waiting for their confirmation; do NOT claim it was done.` });
        } else if (action.status === "failed") {
          actions.push(action);
          emit({ type: "action", action });
          results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `FAILED: ${action.error}. Tell the user clearly that this action failed and was not saved.` });
        } else {
          actions.push(action);
          emit({ type: "action", action });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(action.result ?? null).slice(0, 30000) });
        }
      }
    } finally {
      await persistResults();
    }

    // The round budget is spent: the tools of this round did run and are on record, but there is no
    // further model call to narrate them. Say so rather than answering with nothing, which is what this
    // used to do — the actions still appear in the turn's action list.
    if (round === rounds) {
      finalText = TOO_MANY_ROUNDS;
      emit({ type: "text", delta: finalText });
      const [note] = await db.insert(messages).values({ conversationId: conv.id, role: "assistant", text: finalText, content: [{ type: "text", text: finalText }] }).returning();
      lastAssistantId = note.id;
    }
  }
  await touchConversation(conv.id); // every exchange slides the 24 h retention window forward
  return { conversationId: conv.id, messageId: lastAssistantId, text: finalText, actions, pending, outcome: turnOutcome(actions, pending), usage };
}

export async function chat(user: SessionUser, opts: { conversationId?: string | null; text: string; kind?: string; systemExtra?: string; maxRounds?: number; allowedTools?: string[]; snapshotSections?: readonly SnapshotSection[] }): Promise<ChatResult> {
  try {
    return await runChat(user, opts);
  } catch (e) {
    // Same treatment as the streaming route: the caller gets a sentence, the log gets the detail.
    logAiError("chat", e, { userId: user.id, conversationId: opts.conversationId ?? null, kind: opts.kind ?? "assistant" });
    throw asUserFacingAiError(e);
  }
}

/**
 * Streaming turn. Returns the NDJSON body to hand back to the browser: the assistant's text arrives
 * as it is generated, tool activity is announced by name only, and the turn ends with a `done` event
 * (or an `error` one that says whether any text had already been delivered).
 */
export function chatStream(user: SessionUser, opts: { conversationId?: string | null; text: string; kind?: string; systemExtra?: string; maxRounds?: number; snapshotSections?: readonly SnapshotSection[]; signal?: AbortSignal; client?: Pick<ReturnType<typeof anthropic>, "messages"> }) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let delivered = false;
      const send = (e: ChatStreamEvent) => {
        if (e.type === "text") delivered = true;
        try { controller.enqueue(encoder.encode(encodeEvent(e))); } catch { /* the client went away */ }
      };
      try {
        const r = await runChat(user, { ...opts, stream: true }, send);
        send({ type: "done", conversationId: r.conversationId, messageId: r.messageId, outcome: r.outcome, usage: r.usage });
      } catch (e) {
        // The provider's own words never reach the browser: no status line, no request id, no tool ids,
        // no payload. What the user gets is a sentence about their conversation; the rest goes to the log.
        logAiError("chatStream", e, { userId: user.id, conversationId: opts.conversationId ?? null });
        send({ type: "error", message: safeAiMessage(e), partial: delivered });
      } finally {
        controller.close();
      }
    },
  });
}

/** Executes a previously pending (medium/high-risk) action after the user confirmed it in the UI. */
export async function confirmAction(user: SessionUser, logId: string) {
  const [log] = await db.select().from(aiActionLogs).where(and(eq(aiActionLogs.id, logId), eq(aiActionLogs.userId, user.id)));
  if (!log) throw new AppError(404, "Action not found");
  if (log.status !== "pending_confirmation") throw new AppError(409, `This action is already ${log.status}`);
  if (log.expiresAt && log.expiresAt < new Date()) {
    await db.update(aiActionLogs).set({ status: "expired" }).where(and(eq(aiActionLogs.id, log.id), eq(aiActionLogs.status, "pending_confirmation")));
    throw new AppError(410, "This confirmation has expired; ask the assistant again");
  }
  const tool = getTool(log.tool);
  if (!tool) throw new AppError(409, "That action can no longer be carried out");
  /*
   * Claiming the row IS the lock. Two clicks on the same confirmation card — a double tap, a retry after
   * a slow response — used to pass the status check above independently and run the action twice, which
   * for `add_expense` means 20 € and then 20 € again. The conditional update can only succeed once, so
   * whoever loses gets nothing back and stops here.
   */
  const [claimed] = await db.update(aiActionLogs)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(and(eq(aiActionLogs.id, log.id), eq(aiActionLogs.userId, user.id), eq(aiActionLogs.status, "pending_confirmation")))
    .returning();
  if (!claimed) throw new AppError(409, "That action has already been handled");
  const action = await runTool(tool, log.params, { user, conversationId: log.conversationId, messageId: log.messageId, confirmed: true });
  if (log.conversationId) {
    await db.insert(messages).values({ conversationId: log.conversationId, role: "user", text: `[system] User confirmed action ${tool.name}: ${action.status === "failed" ? "FAILED: " + action.error : "executed successfully. " + (action.summary ?? "")}`, content: [{ type: "text", text: `[system] User confirmed action ${tool.name}: ${action.status === "failed" ? "FAILED: " + action.error : "executed successfully. " + (action.summary ?? "")}` }] });
  }
  return action;
}
export async function rejectAction(user: SessionUser, logId: string) {
  await db.update(aiActionLogs).set({ status: "rejected" }).where(and(eq(aiActionLogs.id, logId), eq(aiActionLogs.userId, user.id), eq(aiActionLogs.status, "pending_confirmation")));
}

/** Plain completion without tools (used for summaries / news interpretation). */
export async function complete(opts: { system: string; prompt: string; maxTokens?: number }) {
  const res = await anthropic().messages.create({ model: AI_MODEL(), max_tokens: opts.maxTokens ?? 1500, system: opts.system, messages: [{ role: "user", content: opts.prompt }] });
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
}
