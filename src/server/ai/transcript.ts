import type Anthropic from "@anthropic-ai/sdk";

/**
 * The tool protocol, as a pure function over a transcript.
 *
 * Phase 3.14 started from a real production failure: a turn stopped at `max_tokens` while the model was
 * emitting `tool_use` blocks, the assistant message was persisted with them anyway, and nothing ever
 * answered them. Every later message in that conversation replayed the orphan and the provider answered
 *
 *     400 invalid_request_error — messages: tool_use ids were found without tool_result blocks
 *     immediately after
 *
 * The conversation was dead: no message could ever be sent to it again. So there are two jobs here, and
 * they are deliberately separate:
 *
 *   · `validateTranscript` states what is wrong with a transcript, and is used as a last gate before a
 *     request leaves the server. We never knowingly send a request we can see is invalid.
 *   · `repairTranscript` makes a stored transcript sendable again without touching the database. Nothing
 *     historical is rewritten; the repair happens on the way to the provider, every time.
 *
 * Both are pure: no database, no network, no clock. That is what makes the rules testable, and it keeps
 * the validation cheap enough to run on every request (it is a single pass over at most 40 messages).
 *
 * The rules are the provider's, not ours:
 *   1. the first message is a `user` message;
 *   2. every message has at least one content block;
 *   3. every `tool_use` in an assistant message is answered by a `tool_result` carrying the same id, in
 *      the single user message immediately after it;
 *   4. every `tool_result` refers to a `tool_use` in the message immediately before it;
 *   5. an id is used once, and answered once;
 *   6. `tool_result` blocks come first in the user message that carries them.
 */

type Msg = Anthropic.MessageParam;
type Block = Anthropic.ContentBlockParam;
/** Whatever roles the SDK accepts on a message; only `user` and `assistant` are ever persisted here. */
type Role = Msg["role"];

export type ViolationKind =
  | "empty_transcript"
  | "leading_assistant"
  | "empty_content"
  | "malformed_block"
  | "orphan_tool_use"
  | "orphan_tool_result"
  | "duplicate_tool_use_id"
  | "duplicate_tool_result";

export interface Violation {
  kind: ViolationKind;
  /** Index in the transcript that was examined, for the server log. Never shown to a user. */
  index: number;
  role: Role;
  /** Short, human-readable, safe to log. Tool ids appear here — logs only, never a response body. */
  detail: string;
}

/** What a repaired-away tool call is told to the model. Configurable so the caller can supply the truth. */
export interface Recovered {
  content: string;
  isError: boolean;
}

/**
 * A tool call that was never answered, with nothing known about what happened to it.
 *
 * The wording matters. Claiming "this did not happen" would be a lie whenever the round died *after* the
 * tool ran — and would invite the model to do it a second time, which is exactly how a 20 € expense
 * becomes 20 € + 20 €. So the model is told the outcome is unknown and pointed at a read tool.
 */
export const UNKNOWN_RESULT =
  "INTERRUPTED: this tool call never returned a result — the assistant's turn ended before it could be recorded. "
  + "It is NOT known whether it took effect. Do not assume either way and do not repeat it blindly: "
  + "read the current state first, tell the user what you find, and only then act.";


const isBlock = (b: unknown): b is Block =>
  typeof b === "object" && b !== null && typeof (b as { type?: unknown }).type === "string";

/** Content as a block array, dropping anything malformed. A blank string message yields no blocks at all. */
export function blocksOf(content: Msg["content"] | null | undefined): Block[] {
  if (content == null) return [];
  if (typeof content === "string") return content.trim() ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.filter(isBlock);
}

const isToolUse = (b: Block): b is Anthropic.ToolUseBlockParam => b.type === "tool_use";
const isToolResult = (b: Block): b is Anthropic.ToolResultBlockParam => b.type === "tool_result";

/** True when a block carries nothing the provider would accept — an empty text block is rejected. */
function isEmptyBlock(b: Block): boolean {
  if (b.type === "text") return !String(b.text ?? "").trim();
  return false;
}

export function validateTranscript(messages: readonly Msg[]): Violation[] {
  const v: Violation[] = [];
  const push = (kind: ViolationKind, index: number, role: Role, detail: string) =>
    v.push({ kind, index, role, detail });

  if (!messages.length) {
    v.push({ kind: "empty_transcript", index: -1, role: "user", detail: "no messages" });
    return v;
  }
  if (messages[0].role !== "user") push("leading_assistant", 0, "assistant", "transcript starts with an assistant message");

  const seenUse = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const role = m.role;
    const raw = m.content;
    const blocks = blocksOf(raw);
    if (Array.isArray(raw) && raw.length !== blocks.length) push("malformed_block", i, role, `${raw.length - blocks.length} block(s) are not content blocks`);
    if (!blocks.length) { push("empty_content", i, role, "message has no content"); continue; }
    if (blocks.some(isEmptyBlock)) push("empty_content", i, role, "message contains an empty text block");

    if (role === "assistant") {
      const uses = blocks.filter(isToolUse);
      for (const u of uses) {
        if (seenUse.has(u.id)) push("duplicate_tool_use_id", i, role, `${u.name} reuses id ${u.id}`);
        seenUse.add(u.id);
      }
      if (!uses.length) continue;
      const next = messages[i + 1];
      if (!next || next.role !== "user") {
        for (const u of uses) push("orphan_tool_use", i, role, `${u.name} (${u.id}) is not followed by a user message`);
        continue;
      }
      const answered = new Set(blocksOf(next.content).filter(isToolResult).map((r) => r.tool_use_id));
      for (const u of uses) if (!answered.has(u.id)) push("orphan_tool_use", i, role, `${u.name} (${u.id}) has no tool_result`);
    } else {
      const results = blocks.filter(isToolResult);
      if (!results.length) continue;
      const prev = messages[i - 1];
      const offered = prev && prev.role === "assistant" ? new Set(blocksOf(prev.content).filter(isToolUse).map((u) => u.id)) : new Set<string>();
      const seenResult = new Set<string>();
      for (const r of results) {
        if (!offered.has(r.tool_use_id)) push("orphan_tool_result", i, role, `tool_result ${r.tool_use_id} answers no preceding tool_use`);
        if (seenResult.has(r.tool_use_id)) push("duplicate_tool_result", i, role, `tool_result ${r.tool_use_id} appears twice`);
        seenResult.add(r.tool_use_id);
      }
      // `tool_result` blocks have to lead the message.
      const firstOther = blocks.findIndex((b) => !isToolResult(b));
      const lastResult = blocks.reduce((acc, b, idx) => (isToolResult(b) ? idx : acc), -1);
      if (firstOther > -1 && lastResult > firstOther) push("malformed_block", i, role, "tool_result blocks do not lead the message");
    }
  }
  return v;
}

export interface RepairOptions {
  /**
   * What to answer an unanswered `tool_use` with. The agent looks the call up in `ai_action_logs` — the
   * durable record that outlives the transcript — so a round that really did run is replayed with its
   * real result instead of being written off. Anything unknown falls back to {@link UNKNOWN_RESULT}.
   */
  recover?: (use: { id: string; name: string }) => Recovered | undefined;
}

export interface RepairResult {
  messages: Msg[];
  /** What had to be fixed. Empty means the stored transcript was already valid. */
  repaired: Violation[];
}

/**
 * Returns a transcript the provider will accept, built from one that it would not.
 *
 * Nothing is deleted that carries meaning: an unanswered tool call gains a `tool_result` saying what is
 * actually known about it, rather than the assistant's turn being thrown away. The blocks that *are*
 * dropped are the ones that cannot mean anything — a `tool_result` for a call that is not in the
 * transcript, a second answer to the same call, an empty message.
 */
export function repairTranscript(messages: readonly Msg[], opts: RepairOptions = {}): RepairResult {
  const repaired: Violation[] = [];
  const note = (kind: ViolationKind, index: number, role: Role, detail: string) =>
    repaired.push({ kind, index, role, detail });

  // 1 — normalise to block arrays and drop what carries nothing.
  type Norm = { role: Role; blocks: Block[]; at: number };
  const norm: Norm[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const raw = m.content;
    const blocks = blocksOf(raw).filter((b) => !isEmptyBlock(b));
    if (Array.isArray(raw) && raw.length !== blocksOf(raw).length) note("malformed_block", i, m.role, "dropped non-block content");
    if (!blocks.length) { note("empty_content", i, m.role, "dropped an empty message"); continue; }
    norm.push({ role: m.role, blocks, at: i });
  }

  // 2 — merge consecutive same-role messages, so a tool_result row and the user's next question become
  //     the single user message the protocol expects after a tool round.
  const merged: Norm[] = [];
  for (const m of norm) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.blocks = [...last.blocks, ...m.blocks];
    else merged.push({ ...m, blocks: [...m.blocks] });
  }

  // 3 — pair every tool_use with its tool_result.
  const out: Norm[] = [];
  const seenUse = new Set<string>();
  for (let i = 0; i < merged.length; i++) {
    const m = merged[i];

    if (m.role !== "assistant") {
      // A user message reached here without an assistant tool round in front of it, so any tool_result
      // it carries answers nothing the model can see. (This is what a truncated history window leaves
      // behind: the assistant turn falls off the top and its answers survive.)
      const kept = m.blocks.filter((b) => {
        if (!isToolResult(b)) return true;
        note("orphan_tool_result", m.at, "user", `dropped tool_result ${b.tool_use_id} with no preceding tool_use`);
        return false;
      });
      if (kept.length) out.push({ ...m, blocks: kept });
      else note("empty_content", m.at, "user", "dropped a message that was only orphan tool_results");
      continue;
    }

    const uses: Anthropic.ToolUseBlockParam[] = [];
    const keptAssistant: Block[] = [];
    for (const b of m.blocks) {
      if (isToolUse(b)) {
        if (seenUse.has(b.id)) { note("duplicate_tool_use_id", m.at, "assistant", `dropped a second tool_use with id ${b.id}`); continue; }
        seenUse.add(b.id);
        uses.push(b);
      }
      keptAssistant.push(b);
    }
    out.push({ ...m, blocks: keptAssistant });
    if (!uses.length) continue;

    // The next message, if it is a user message, is this round's answer sheet.
    const answers = new Map<string, Anthropic.ToolResultBlockParam>();
    const trailing: Block[] = [];
    const next = merged[i + 1];
    if (next && next.role === "user") {
      for (const b of next.blocks) {
        if (!isToolResult(b)) { trailing.push(b); continue; }
        if (!uses.some((u) => u.id === b.tool_use_id)) { note("orphan_tool_result", next.at, "user", `dropped tool_result ${b.tool_use_id}, no matching tool_use`); continue; }
        if (answers.has(b.tool_use_id)) { note("duplicate_tool_result", next.at, "user", `dropped a second tool_result for ${b.tool_use_id}`); continue; }
        answers.set(b.tool_use_id, b);
      }
      i++; // consumed
    }

    for (const u of uses) {
      if (answers.has(u.id)) continue;
      note("orphan_tool_use", m.at, "assistant", `${u.name} (${u.id}) had no tool_result`);
      const rec = opts.recover?.({ id: u.id, name: u.name }) ?? { content: UNKNOWN_RESULT, isError: true };
      answers.set(u.id, { type: "tool_result", tool_use_id: u.id, is_error: rec.isError, content: rec.content });
    }

    // Results lead the message, in the order the model asked for them.
    out.push({ role: "user", at: next?.at ?? m.at, blocks: [...uses.map((u) => answers.get(u.id)!), ...trailing] });
  }

  // 4 — dropping messages can leave two of the same role touching; merge again, then make sure the
  //     transcript still opens on a user message.
  const finalMsgs: Msg[] = [];
  for (const m of out) {
    const last = finalMsgs[finalMsgs.length - 1];
    if (last && last.role === m.role && Array.isArray(last.content)) last.content = [...last.content, ...m.blocks];
    else finalMsgs.push({ role: m.role, content: m.blocks });
  }
  while (finalMsgs.length && finalMsgs[0].role !== "user") {
    note("leading_assistant", 0, "assistant", "dropped a leading assistant message");
    finalMsgs.shift();
  }

  return { messages: finalMsgs, repaired };
}

/** Thrown instead of sending a request we can see the provider will reject. Never shown to a user. */
export class InvalidTranscriptError extends Error {
  constructor(public violations: Violation[]) {
    super(`transcript is not sendable: ${violations.map((v) => `${v.kind}@${v.index} ${v.detail}`).join("; ")}`);
    this.name = "InvalidTranscriptError";
  }
}

/** Last gate before the provider call. Cheap enough to run on every request, and it runs on every request. */
export function assertSendable(messages: readonly Msg[]): void {
  const v = validateTranscript(messages);
  if (v.length) throw new InvalidTranscriptError(v);
}
