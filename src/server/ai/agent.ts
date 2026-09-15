import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { aiActionLogs, conversations, messages } from "@/server/db/schema";
import type { SessionUser } from "@/server/auth/session";
import { AI_MODEL, anthropic } from "./client";
import { allTools, getTool, type ToolDefinition } from "./registry";
import { toInputSchema } from "./schema-json";
import { buildSystemPrompt } from "./context";
import { audit } from "@/server/audit";
import { getPreferences } from "@/server/services/users";
import { conversationExpiry, touchConversation } from "@/server/services/conversations";
import "./tools"; // registers every tool

const MAX_TOOL_ROUNDS = 8;
const PENDING_TTL_MS = 30 * 60 * 1000;

export interface ExecutedAction { logId: string; tool: string; risk: string; status: string; summary: string | null; params: unknown; result?: unknown; error?: string | null }
export interface ChatResult { conversationId: string; messageId: string; text: string; actions: ExecutedAction[]; pending: ExecutedAction[]; usage: { input: number; output: number } }

function anthropicTools(): Anthropic.Tool[] {
  return allTools().map((t) => ({ name: t.name, description: `[${t.module} · ${t.risk}] ${t.description}`, input_schema: toInputSchema(t.schema) as Anthropic.Tool.InputSchema }));
}

/** Continues the given conversation only while it is alive; an expired transcript starts a fresh one (never resurrected). */
async function ensureConversation(user: SessionUser, conversationId: string | null, kind: string, firstUserText: string) {
  if (conversationId) {
    const [c] = await db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)));
    if (c && c.expiresAt > new Date()) return c;
  }
  const [c] = await db.insert(conversations).values({ userId: user.id, kind, title: firstUserText.slice(0, 80), expiresAt: conversationExpiry() }).returning();
  return c;
}

/** Replays persisted messages as Anthropic messages (content blocks kept verbatim for tool_use/tool_result). */
async function history(conversationId: string, limit = 40): Promise<Anthropic.MessageParam[]> {
  const rows = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(desc(messages.createdAt)).limit(limit);
  const ordered = rows.reverse().filter((m) => m.role === "user" || m.role === "assistant");
  const out: Anthropic.MessageParam[] = [];
  for (const m of ordered) {
    const content = (m.content as Anthropic.MessageParam["content"] | null) ?? m.text;
    if (!content || (typeof content === "string" && !content.trim())) continue;
    // Anthropic requires alternating roles; merge consecutive same-role messages.
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      const a = Array.isArray(last.content) ? last.content : [{ type: "text" as const, text: String(last.content) }];
      const b = Array.isArray(content) ? content : [{ type: "text" as const, text: String(content) }];
      last.content = [...a, ...b];
    } else out.push({ role: m.role as "user" | "assistant", content });
  }
  // The transcript must start with a user message.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export async function runTool(tool: ToolDefinition, rawInput: unknown, ctx: { user: SessionUser; conversationId: string | null; messageId?: string | null; confirmed: boolean }): Promise<ExecutedAction> {
  const started = Date.now();
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    const [log] = await db.insert(aiActionLogs).values({ userId: ctx.user.id, conversationId: ctx.conversationId, messageId: ctx.messageId ?? null, tool: tool.name, risk: tool.risk, params: rawInput, status: "failed", error: "Invalid parameters: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), durationMs: Date.now() - started }).returning();
    return { logId: log.id, tool: tool.name, risk: tool.risk, status: "failed", summary: null, params: rawInput, error: log.error };
  }
  const input = parsed.data;
  const prefs = await getPreferences(ctx.user.id);
  const confirmMedium = (prefs.ai as { confirmMedium?: boolean } | undefined)?.confirmMedium ?? false;
  let needs: boolean | string = tool.risk === "high";
  if (!needs && tool.risk === "medium") needs = confirmMedium || (tool.needsConfirmation?.(input, { ...ctx }) ?? false);
  if (needs && !ctx.confirmed) {
    const [log] = await db.insert(aiActionLogs).values({ userId: ctx.user.id, conversationId: ctx.conversationId, messageId: ctx.messageId ?? null, tool: tool.name, risk: tool.risk, params: input, status: "pending_confirmation", summary: typeof needs === "string" ? needs : tool.summarize?.(input, null) ?? tool.name, expiresAt: new Date(Date.now() + PENDING_TTL_MS) }).returning();
    return { logId: log.id, tool: tool.name, risk: tool.risk, status: "pending_confirmation", summary: log.summary, params: input };
  }
  try {
    const result = await tool.run(input, { user: ctx.user, conversationId: ctx.conversationId, confirmed: ctx.confirmed });
    const summary = tool.summarize?.(input, result) ?? tool.name;
    const [log] = await db.insert(aiActionLogs).values({ userId: ctx.user.id, conversationId: ctx.conversationId, messageId: ctx.messageId ?? null, tool: tool.name, risk: tool.risk, params: input, result: truncate(result), status: ctx.confirmed ? "confirmed" : "success", summary, confirmedAt: ctx.confirmed ? new Date() : null, durationMs: Date.now() - started }).returning();
    if (tool.risk !== "read") await audit({ userId: ctx.user.id, actor: "ai", action: `ai.${tool.name}`, metadata: { logId: log.id, summary } });
    return { logId: log.id, tool: tool.name, risk: tool.risk, status: log.status, summary, params: input, result };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const [log] = await db.insert(aiActionLogs).values({ userId: ctx.user.id, conversationId: ctx.conversationId, messageId: ctx.messageId ?? null, tool: tool.name, risk: tool.risk, params: input, status: "failed", error, durationMs: Date.now() - started }).returning();
    return { logId: log.id, tool: tool.name, risk: tool.risk, status: "failed", summary: null, params: input, error };
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

/**
 * Chat with tool use. Tools run through `runTool` so every action is validated, risk-gated and logged.
 * The model is told explicitly when a tool failed or is awaiting confirmation, so it never claims success.
 */
export async function chat(user: SessionUser, opts: { conversationId?: string | null; text: string; kind?: string; systemExtra?: string; maxRounds?: number; allowedTools?: string[] }): Promise<ChatResult> {
  const client = anthropic();
  const conv = await ensureConversation(user, opts.conversationId ?? null, opts.kind ?? "assistant", opts.text);
  const [userMsg] = await db.insert(messages).values({ conversationId: conv.id, role: "user", text: opts.text, content: [{ type: "text", text: opts.text }] }).returning();
  const system = await buildSystemPrompt(user, opts.systemExtra);
  const tools = anthropicTools().filter((t) => !opts.allowedTools || opts.allowedTools.includes(t.name));
  const transcript = await history(conv.id);
  const actions: ExecutedAction[] = [];
  const pending: ExecutedAction[] = [];
  let usage = { input: 0, output: 0 };
  let finalText = "";
  let lastAssistantId = userMsg.id;

  for (let round = 0; round <= (opts.maxRounds ?? MAX_TOOL_ROUNDS); round++) {
    const res = await client.messages.create({ model: AI_MODEL(), max_tokens: 2048, system, tools, messages: transcript });
    usage = { input: usage.input + res.usage.input_tokens, output: usage.output + res.usage.output_tokens };
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    const [assistantMsg] = await db.insert(messages).values({ conversationId: conv.id, role: "assistant", text, content: res.content, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }).returning();
    lastAssistantId = assistantMsg.id;
    transcript.push({ role: "assistant", content: res.content });
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !toolUses.length) { finalText = text; break; }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const tool = getTool(tu.name);
      if (!tool) { results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}` }); continue; }
      const action = await runTool(tool, tu.input, { user, conversationId: conv.id, messageId: assistantMsg.id, confirmed: false });
      if (action.status === "pending_confirmation") {
        pending.push(action);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: `NOT EXECUTED. This action requires the user's explicit confirmation (risk: ${tool.risk}). A confirmation card was shown to the user (action id ${action.logId}). Tell the user it is waiting for their confirmation; do NOT claim it was done.` });
      } else if (action.status === "failed") {
        actions.push(action);
        results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `FAILED: ${action.error}. Tell the user clearly that this action failed and was not saved.` });
      } else {
        actions.push(action);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(action.result ?? null).slice(0, 30000) });
      }
    }
    await db.insert(messages).values({ conversationId: conv.id, role: "user", text: "", content: results });
    transcript.push({ role: "user", content: results });
  }
  await touchConversation(conv.id); // every exchange slides the 24 h retention window forward
  return { conversationId: conv.id, messageId: lastAssistantId, text: finalText, actions, pending, usage };
}

/** Executes a previously pending (medium/high-risk) action after the user confirmed it in the UI. */
export async function confirmAction(user: SessionUser, logId: string) {
  const [log] = await db.select().from(aiActionLogs).where(and(eq(aiActionLogs.id, logId), eq(aiActionLogs.userId, user.id)));
  if (!log) throw new Error("Action not found");
  if (log.status !== "pending_confirmation") throw new Error(`Action is ${log.status}`);
  if (log.expiresAt && log.expiresAt < new Date()) {
    await db.update(aiActionLogs).set({ status: "expired" }).where(eq(aiActionLogs.id, log.id));
    throw new Error("This confirmation has expired; ask the assistant again");
  }
  const tool = getTool(log.tool);
  if (!tool) throw new Error("Tool no longer exists");
  await db.update(aiActionLogs).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(aiActionLogs.id, log.id));
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
