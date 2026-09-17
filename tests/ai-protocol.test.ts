/**
 * Phase 3.14 — the tool protocol, and the failure that started it.
 *
 * On 2026-09-17 a real conversation died. The model was logging three sets at once, the turn hit
 * `max_tokens` while it was still emitting `tool_use` blocks, and the assistant message was written to
 * the database with three tool calls that nothing would ever answer. From then on every message sent to
 * that conversation came back as
 *
 *     400 invalid_request_error — messages: tool_use ids were found without tool_result blocks
 *     immediately after
 *
 * …and the raw provider text was shown to the user. Three things had to be true afterwards, and each has
 * tests here: a transcript like that can never be *created* again, a transcript like that can still be
 * *sent* (repaired on the way out, so conversations that are already broken come back to life), and the
 * provider's own words never reach the screen.
 *
 * The first block needs no database: the protocol rules are a pure function over a list of messages.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { aiActionLogs, conversations, messages } from "@/server/db/schema";
import { chat, chatStream, confirmAction } from "@/server/ai/agent";
import { GENERIC_AI_ERROR, safeAiMessage } from "@/server/ai/errors";
import { createEventParser, type ChatStreamEvent } from "@/server/ai/stream";
import { resumeConversation } from "@/server/services/conversations";
import { createGoal, goalCreateSchema } from "@/server/services/goals";
import { z } from "zod";
import { defineTool, getTool } from "@/server/ai/registry";
import { InvalidTranscriptError, assertSendable, repairTranscript, validateTranscript, UNKNOWN_RESULT } from "@/server/ai/transcript";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

type Msg = Anthropic.MessageParam;
const user = (text: string): Msg => ({ role: "user", content: [{ type: "text", text }] });
const say = (text: string): Msg => ({ role: "assistant", content: [{ type: "text", text }] });
const uses = (...calls: { id: string; name: string }[]): Msg => ({
  role: "assistant",
  content: calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: {} })),
});
const results = (...ids: string[]): Msg => ({
  role: "user",
  content: ids.map((id) => ({ type: "tool_result", tool_use_id: id, content: "{}" })),
});
const kinds = (t: Msg[]) => validateTranscript(t).map((v) => v.kind);
const toolUseIds = (m: Msg) => (Array.isArray(m.content) ? m.content : []).filter((b) => b.type === "tool_use").map((b) => (b as Anthropic.ToolUseBlockParam).id);
const toolResultIds = (m: Msg) => (Array.isArray(m.content) ? m.content : []).filter((b) => b.type === "tool_result").map((b) => (b as Anthropic.ToolResultBlockParam).tool_use_id);

/* ------------------------------------------------------------------ the captured failure, exactly */

describe("the exact error captured in production", () => {
  /**
   * Message for message, what conversation cb856b94 held: a question, a read tool round that worked, two
   * ordinary turns, then the assistant message with three `log_sets` calls that `max_tokens` cut short,
   * and finally the next thing the user typed. Nothing else is needed to make the provider refuse it.
   */
  const captured: Msg[] = [
    user("today I'm training back and chest, reorder the schedule"),
    uses({ id: "toolu_01XYTjxyudmu4WRinN8dKYTA", name: "get_training_plan" }),
    results("toolu_01XYTjxyudmu4WRinN8dKYTA"),
    say("Today falls on a rest day in your current schedule."),
    user("Dame el entrenamiento de hoy sabiendo que me toca pecho espalda"),
    say("Aquí tienes el día Chest + Back de tu rutina."),
    user("Press inclinado con 50 kg, remo en smith 35 kg por lado, press plano con 25 kg"),
    uses(
      { id: "toolu_01PamW4rvrYGY2AWXH8mX39d", name: "log_sets" },
      { id: "toolu_01LDzqVT15u6y9nPbvThoDHt", name: "log_sets" },
      { id: "toolu_01PArpEsixy3ZvTdx5i5F67a", name: "log_sets" },
    ),
    user("Dame las marcas que tengas registradas hasta ahora"),
  ];

  it("is recognised as invalid — three tool_use blocks with no tool_result after them", () => {
    const found = validateTranscript(captured).filter((v) => v.kind === "orphan_tool_use");
    expect(found).toHaveLength(3);
    expect(found.map((v) => v.detail).join(" ")).toContain("log_sets");
    expect(() => assertSendable(captured)).toThrow(InvalidTranscriptError);
  });

  it("is repaired into something the provider accepts, with the user's question intact", () => {
    const { messages: fixed, repaired } = repairTranscript(captured);
    expect(validateTranscript(fixed)).toEqual([]);
    expect(repaired.filter((v) => v.kind === "orphan_tool_use")).toHaveLength(3);

    // The three calls are answered in the message straight after them, in the order they were made.
    const round = fixed.findIndex((m) => toolUseIds(m).includes("toolu_01PamW4rvrYGY2AWXH8mX39d"));
    expect(toolResultIds(fixed[round + 1])).toEqual([
      "toolu_01PamW4rvrYGY2AWXH8mX39d",
      "toolu_01LDzqVT15u6y9nPbvThoDHt",
      "toolu_01PArpEsixy3ZvTdx5i5F67a",
    ]);
    // …and the question the user actually asked is still there, after the results.
    expect(JSON.stringify(fixed[round + 1].content)).toContain("Dame las marcas");
  });

  it("does not tell the model the actions definitely did not happen", () => {
    // The turn died after the tool calls were emitted. Whether they ran is unknown from the transcript
    // alone, and "it did not happen" is the answer that produces 20 € twice.
    const { messages: fixed } = repairTranscript(captured);
    const answer = JSON.stringify(fixed.find((m) => toolResultIds(m).length === 3)!.content);
    expect(answer).toContain(UNKNOWN_RESULT);
    expect(answer).toContain("read the current state first");
  });
});

/* ------------------------------------------------------------------------------ the rules, one by one */

describe("what the validator refuses", () => {
  it("accepts an ordinary, well-formed transcript", () => {
    expect(validateTranscript([user("hi"), say("hello"), user("log it"), uses({ id: "a", name: "t" }), results("a"), say("done")])).toEqual([]);
  });

  it("a tool_use answered by the wrong id", () => {
    const t = [user("hi"), uses({ id: "A", name: "create_task" }), results("B")];
    expect(kinds(t)).toContain("orphan_tool_use");
    expect(kinds(t)).toContain("orphan_tool_result");
  });

  it("only some of several calls answered", () => {
    const t = [user("hi"), uses({ id: "A", name: "t" }, { id: "B", name: "t" }, { id: "C", name: "t" }), results("A", "C")];
    expect(validateTranscript(t).filter((v) => v.kind === "orphan_tool_use")).toHaveLength(1);
  });

  it("the same call answered twice", () => {
    const t: Msg[] = [user("hi"), uses({ id: "A", name: "t" }), { role: "user", content: [
      { type: "tool_result", tool_use_id: "A", content: "1" },
      { type: "tool_result", tool_use_id: "A", content: "2" },
    ] }];
    expect(kinds(t)).toContain("duplicate_tool_result");
  });

  it("the same id used by two different calls", () => {
    const t = [user("hi"), uses({ id: "A", name: "t" }), results("A"), uses({ id: "A", name: "t" }), results("A")];
    expect(kinds(t)).toContain("duplicate_tool_use_id");
  });

  it("an answer that arrives after something else in the same message", () => {
    const t: Msg[] = [user("hi"), uses({ id: "A", name: "t" }), { role: "user", content: [
      { type: "text", text: "and also" },
      { type: "tool_result", tool_use_id: "A", content: "1" },
    ] }];
    expect(kinds(t)).toContain("malformed_block");
  });

  it("results that reach the model before their question — the assistant turn fell out of the window", () => {
    expect(kinds([results("A"), say("ok")])).toContain("orphan_tool_result");
  });

  it("a transcript that opens on the assistant, is empty, or holds an empty message", () => {
    expect(kinds([say("hello"), user("hi")])).toContain("leading_assistant");
    expect(kinds([])).toEqual(["empty_transcript"]);
    expect(kinds([user("hi"), { role: "assistant", content: [] }])).toContain("empty_content");
    expect(kinds([user("hi"), { role: "assistant", content: [{ type: "text", text: "   " }] }])).toContain("empty_content");
  });
});

describe("what the repair does about it", () => {
  const cases: [string, Msg[]][] = [
    ["a tool_use answered by the wrong id", [user("hi"), uses({ id: "A", name: "t" }), results("B")]],
    ["one of three answers missing", [user("hi"), uses({ id: "A", name: "t" }, { id: "B", name: "t" }, { id: "C", name: "t" }), results("A", "C")]],
    ["an answer with no question", [results("A"), user("carry on")]],
    ["a leading assistant message", [say("hello"), user("hi")]],
    ["an empty message in the middle", [user("hi"), { role: "assistant", content: [] }, user("still there?")]],
    ["a round split across the window boundary", [results("A"), say("I looked it up"), user("thanks")]],
    ["a duplicated answer", [user("hi"), uses({ id: "A", name: "t" }), { role: "user", content: [
      { type: "tool_result", tool_use_id: "A", content: "1" },
      { type: "tool_result", tool_use_id: "A", content: "2" },
    ] }]],
    ["the captured failure", [user("hi"), uses({ id: "A", name: "log_sets" }, { id: "B", name: "log_sets" }), user("what did you record?")]],
  ];

  for (const [name, broken] of cases) {
    it(`${name} — the result validates clean`, () => {
      const { messages: fixed } = repairTranscript(broken);
      expect(validateTranscript(fixed), name).toEqual([]);
    });
  }

  it("is idempotent: repairing a repaired transcript changes nothing", () => {
    for (const [, broken] of cases) {
      const once = repairTranscript(broken).messages;
      const twice = repairTranscript(once);
      expect(twice.messages).toEqual(once);
      expect(twice.repaired).toEqual([]);
    }
  });

  it("leaves a healthy transcript exactly as it was", () => {
    const healthy = [user("hi"), uses({ id: "A", name: "t" }), results("A"), say("done")];
    const { messages: out, repaired } = repairTranscript(healthy);
    expect(repaired).toEqual([]);
    expect(out).toEqual(healthy);
  });

  it("replays the real result when the caller can supply one, instead of writing the round off", () => {
    const broken = [user("what do I owe?"), uses({ id: "A", name: "list_expenses" }), user("well?")];
    const { messages: fixed } = repairTranscript(broken, {
      recover: (u) => (u.id === "A" ? { content: '{"total":42}', isError: false } : undefined),
    });
    expect(validateTranscript(fixed)).toEqual([]);
    const answer = fixed.find((m) => toolResultIds(m).includes("A"))!;
    expect(JSON.stringify(answer.content)).toContain('{\\"total\\":42}');
    expect(JSON.stringify(answer.content)).not.toContain("INTERRUPTED");
  });

  it("never invents a result for a call that was answered properly", () => {
    const { messages: fixed } = repairTranscript([user("hi"), uses({ id: "A", name: "t" }), results("A"), uses({ id: "B", name: "t" }), user("?")], {
      recover: () => ({ content: "MADE UP", isError: false }),
    });
    const first = fixed.find((m) => toolResultIds(m).includes("A"))!;
    expect(JSON.stringify(first.content)).not.toContain("MADE UP");
  });

  it("is cheap enough to run on every request", () => {
    // A full window: 40 messages, half of them tool rounds.
    const big: Msg[] = [];
    for (let i = 0; i < 20; i++) { big.push(user(`q${i}`)); big.push(uses({ id: `t${i}`, name: "list_tasks" })); big.push(results(`t${i}`)); }
    const started = performance.now();
    for (let i = 0; i < 200; i++) repairTranscript(big);
    expect((performance.now() - started) / 200).toBeLessThan(5); // ms per call
  });
});

/* ------------------------------------------------------------------------------------- the error UX */

describe("what a failure is allowed to say", () => {
  class FakeAPIError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }

  const leaky = new FakeAPIError(400, 'Anthropic: 400 invalid_request_error — messages.7: tool_use ids were found without tool_result blocks immediately after: toolu_01PamW4rvrYGY2AWXH8mX39d. request_id: req_011CT9xQ');

  it("a provider error becomes one plain sentence", () => {
    const msg = safeAiMessage(leaky);
    expect(msg).toBe(GENERIC_AI_ERROR);
    for (const forbidden of ["invalid_request_error", "toolu_", "req_", "messages.7", "Anthropic", "400", "tool_result"]) {
      expect(msg, forbidden).not.toContain(forbidden);
    }
  });

  it("a refused transcript does not tell the user about the protocol", () => {
    const msg = safeAiMessage(new InvalidTranscriptError([{ kind: "orphan_tool_use", index: 7, role: "assistant", detail: "log_sets (toolu_01Pam) has no tool_result" }]));
    expect(msg).not.toContain("tool");
    expect(msg).not.toContain("toolu_");
    expect(msg).toMatch(/start a new one/i);
  });

  it("never returns a stack trace or an empty string, whatever it is handed", () => {
    for (const e of [new Error("at Object.<anonymous> (/home/user/app/src/server/ai/agent.ts:148:20)"), "a string", null, undefined, { weird: true }, 42]) {
      const msg = safeAiMessage(e);
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toContain("/src/");
      expect(msg).not.toContain(".ts:");
    }
  });
});

/* ------------------------------------------------------ the loop, against the database and a fake model */

/** A model that answers from a script, including the shapes that used to corrupt a conversation. */
function scripted(script: { text?: string; toolUse?: { name: string; input: unknown }[]; stopReason?: string; onCall?: () => void }[]) {
  let call = 0;
  const sent: { messages: Msg[] }[] = [];
  const build = (step: (typeof script)[number]) => {
    const content: unknown[] = [];
    if (step.text) content.push({ type: "text", text: step.text });
    for (const [i, t] of (step.toolUse ?? []).entries()) content.push({ type: "tool_use", id: `tu_${call}_${i}`, name: t.name, input: t.input });
    return { id: `msg_${call}`, content, stop_reason: step.stopReason ?? (step.toolUse?.length ? "tool_use" : "end_turn"), usage: { input_tokens: 5, output_tokens: 7 } };
  };
  const client = {
    messages: {
      async create(params: { messages: Msg[] }) { sent.push({ messages: structuredClone(params.messages) }); const step = script[Math.min(call, script.length - 1)]; const m = build(step); call++; step.onCall?.(); return m; },
      stream(params: { messages: Msg[] }) {
        sent.push({ messages: structuredClone(params.messages) });
        const step = script[Math.min(call, script.length - 1)];
        const self = { on() { return self; }, async finalMessage() { const m = build(step); call++; step.onCall?.(); return m; } };
        return self;
      },
    },
  };
  return { client: client as never, sent, calls: () => call };
}

const rowsOf = (conversationId: string) => db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
const blocks = (row: { content: unknown }) => (Array.isArray(row.content) ? row.content : []) as { type: string; id?: string; tool_use_id?: string }[];

/** `chat` takes no stand-in client in its public signature; the agent's own loop does. */
type ChatOpts = Parameters<typeof chat>[1] & { client?: unknown; signal?: AbortSignal };
const run = (u: Parameters<typeof chat>[0], o: ChatOpts) => chat(u, o as Parameters<typeof chat>[1]);

/**
 * A tool whose result cannot be serialised, so `JSON.stringify(action.result)` throws — in the tool loop
 * itself, outside anything `runTool` guards. It is the closest a test can get to the round dying half
 * way through, which is what the `finally` around the loop exists for.
 */
const CRASH_TOOL = "__test_unserialisable_result";
if (!getTool(CRASH_TOOL)) {
  defineTool({
    name: CRASH_TOOL, module: "tasks", risk: "read", description: "test seam: returns a circular object",
    schema: z.object({}),
    run: async () => { const o: Record<string, unknown> = {}; o.self = o; return o; },
  });
}

/** Every stored message of a conversation, replayed the way the agent replays it, must be sendable. */
const assertStoredIsSendable = async (conversationId: string) => {
  const rows = await rowsOf(conversationId);
  const replay: Msg[] = rows.filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => ({ role: r.role as "user" | "assistant", content: (r.content as Msg["content"]) ?? r.text }));
  const merged: Msg[] = [];
  for (const m of replay) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role && Array.isArray(last.content) && Array.isArray(m.content)) last.content = [...last.content, ...m.content];
    else merged.push(m);
  }
  expect(validateTranscript(merged), `stored transcript of ${conversationId}`).toEqual([]);
};

d("the agent never writes a transcript it could not send again", () => {
  let u: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("a turn cut off at max_tokens mid tool call stores no orphan — this is the production bug", async () => {
    // Exactly the shape that broke it: three tool calls, stop_reason max_tokens, so nothing ran.
    const { client } = scripted([{ toolUse: [
      { name: "log_sets", input: { exerciseName: "Incline press", sets: [{ weightKg: 50, reps: 8 }] } },
      { name: "log_sets", input: { exerciseName: "Smith row", sets: [{ weightKg: 70, reps: 8 }] } },
      { name: "log_sets", input: { exerciseName: "Bench press", sets: [{ weightKg: 25, reps: 8 }] } },
    ], stopReason: "max_tokens" }]);
    const r = await run(u, { text: "Press inclinado 50 kg, remo 35 por lado, press plano 25", client });

    const rows = await rowsOf(r.conversationId);
    expect(rows.flatMap(blocks).filter((b) => b.type === "tool_use")).toHaveLength(0);
    await assertStoredIsSendable(r.conversationId);
    // …and the user is told, rather than being handed an empty answer as they were: in the turn's
    // result, in the message that survives a reload, and — see below — down the stream as it happens.
    expect(r.text).toMatch(/ran out of room/i);
    expect(rows.at(-1)!.text).toContain("ran out of room");
  });

  it("tells a streaming client too, not only the caller", async () => {
    // A streamed turn shows what the model produced; a notice the server writes has to be pushed as
    // well or the browser is left with a blank answer, which is what the production build did.
    const { client } = scripted([{ toolUse: [{ name: "create_task", input: { title: "Cut off" } }], stopReason: "max_tokens" }]);
    const reader = chatStream(u, { text: "log it", client } as never).getReader();
    const decoder = new TextDecoder();
    const parser = createEventParser();
    const events: ChatStreamEvent[] = [];
    for (;;) { const { value, done } = await reader.read(); if (done) break; events.push(...parser.push(decoder.decode(value, { stream: true }))); }
    const streamed = events.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.delta : "")).join("");
    expect(streamed).toMatch(/ran out of room/i);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("the conversation still works afterwards, which is the whole point", async () => {
    const first = scripted([{ toolUse: [{ name: "log_sets", input: { exerciseName: "Incline press", sets: [{ weightKg: 50, reps: 8 }] } }], stopReason: "max_tokens" }]);
    const r = await run(u, { text: "log my sets", client: first.client });
    const second = scripted([{ text: "Here is what I have." }]);
    const r2 = await run(u, { conversationId: r.conversationId, text: "what did you record?", client: second.client });
    expect(r2.text).toBe("Here is what I have.");
    expect(validateTranscript(second.sent[0].messages)).toEqual([]);
  });

  it("every tool_use it does store is answered in the very next message", async () => {
    const { client } = scripted([
      { text: "On it", toolUse: [{ name: "create_task", input: { title: "Call the dentist" } }, { name: "create_task", input: { title: "Buy milk" } }] },
      { text: "Both created." },
    ]);
    const r = await run(u, { text: "two tasks please", client });
    const rows = await rowsOf(r.conversationId);
    const useRow = rows.findIndex((x) => blocks(x).some((b) => b.type === "tool_use"));
    const used = blocks(rows[useRow]).filter((b) => b.type === "tool_use").map((b) => b.id);
    const answered = blocks(rows[useRow + 1]).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id);
    expect(rows[useRow + 1].role).toBe("user");
    expect(answered).toEqual(used); // same ids, same order, one message
    await assertStoredIsSendable(r.conversationId);
  });

  it("a tool that fails is answered, not dropped", async () => {
    const { client } = scripted([
      { toolUse: [{ name: "create_task", input: { nonsense: true } }] }, // fails schema validation
      { text: "That did not work." },
    ]);
    const r = await run(u, { text: "make a task", client });
    const rows = await rowsOf(r.conversationId);
    const answer = rows.flatMap(blocks).find((b) => b.type === "tool_result") as { is_error?: boolean; content?: string } | undefined;
    expect(answer?.is_error).toBe(true);
    expect(answer?.content).toContain("FAILED");
    await assertStoredIsSendable(r.conversationId);
  });

  it("an unknown tool is answered too", async () => {
    const { client } = scripted([{ toolUse: [{ name: "no_such_tool_exists", input: {} }] }, { text: "sorry" }]);
    const r = await run(u, { text: "do the impossible", client });
    await assertStoredIsSendable(r.conversationId);
  });

  it("a crash in the middle of a round still leaves the round answered", async () => {
    const { client } = scripted([{ toolUse: [{ name: CRASH_TOOL, input: {} }, { name: "create_task", input: { title: "Never reached" } }] }]);
    const [conv] = await db.insert(conversations).values({ userId: u.id, kind: "assistant", title: "crash" }).returning();
    await expect(run(u, { conversationId: conv.id, text: "explode please", client })).rejects.toThrow();

    // The turn failed, but the transcript did not: the tool_use blocks that were written down are
    // answered, so the next message to this conversation is still a legal request.
    const rows = await rowsOf(conv.id);
    expect(rows.flatMap(blocks).filter((b) => b.type === "tool_use")).toHaveLength(2);
    expect(rows.flatMap(blocks).filter((b) => b.type === "tool_result")).toHaveLength(2);
    expect(JSON.stringify(rows.flatMap(blocks))).toContain("INTERRUPTED");
    await assertStoredIsSendable(conv.id);

    const next = scripted([{ text: "back on my feet" }]);
    const r2 = await run(u, { conversationId: conv.id, text: "what happened?", client: next.client });
    expect(r2.text).toBe("back on my feet");
    expect(validateTranscript(next.sent[0].messages)).toEqual([]);
  });

  it("stops between rounds when the client goes away, never inside one", async () => {
    const ac = new AbortController();
    // The model aborts the request while it is answering the first round: the round still finishes and
    // persists its results, and the loop then stops instead of asking for another turn.
    const { client, calls } = scripted([
      { toolUse: [{ name: "create_task", input: { title: "Aborted round" } }], onCall: () => ac.abort() },
      { text: "never reached" },
    ]);
    const r = await run(u, { text: "do a thing", client, signal: ac.signal });
    expect(calls()).toBe(1); // one model call, not two
    expect(r.actions.map((a) => a.tool)).toEqual(["create_task"]); // the round that started, finished
    await assertStoredIsSendable(r.conversationId);
  });
});

d("a conversation that is already broken", () => {
  let u: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  /** Writes the corrupted shape straight into the database, the way it exists in production today. */
  const corrupt = async (opts: { withLog?: boolean } = {}) => {
    const [conv] = await db.insert(conversations).values({ userId: u.id, kind: "assistant", title: "broken" }).returning();
    await db.insert(messages).values({ conversationId: conv.id, role: "user", text: "log my sets", content: [{ type: "text", text: "log my sets" }] });
    const [assistant] = await db.insert(messages).values({ conversationId: conv.id, role: "assistant", text: "", content: [
      { type: "tool_use", id: "toolu_orphan_1", name: "list_tasks", input: {} },
    ] }).returning();
    if (opts.withLog) {
      await db.insert(aiActionLogs).values({ userId: u.id, conversationId: conv.id, messageId: assistant.id, tool: "list_tasks", risk: "read", params: {}, result: { recovered: true }, status: "success" });
    }
    return conv.id;
  };

  it("can be written to again, and what is sent is valid", async () => {
    const conversationId = await corrupt();
    const { client, sent } = scripted([{ text: "Here you go." }]);
    const r = await chat(u, { conversationId, text: "what did you record?", client } as never);
    expect(r.text).toBe("Here you go.");
    expect(validateTranscript(sent[0].messages)).toEqual([]);
    expect(JSON.stringify(sent[0].messages)).toContain("toolu_orphan_1"); // repaired, not thrown away
  });

  it("the stored rows are left exactly as they were — no silent rewriting of history", async () => {
    const conversationId = await corrupt();
    const before = JSON.stringify((await rowsOf(conversationId)).map((r) => [r.role, r.text, r.content]));
    const { client } = scripted([{ text: "ok" }]);
    await chat(u, { conversationId, text: "hello again", client } as never);
    const after = await rowsOf(conversationId);
    expect(JSON.stringify(after.slice(0, 2).map((r) => [r.role, r.text, r.content]))).toBe(before);
  });

  it("uses the action log's real result when the round actually ran", async () => {
    const conversationId = await corrupt({ withLog: true });
    const { client, sent } = scripted([{ text: "done" }]);
    await chat(u, { conversationId, text: "and now?", client } as never);
    const wire = JSON.stringify(sent[0].messages);
    expect(wire).toContain("recovered");
    expect(wire).not.toContain("INTERRUPTED");
  });

  it("a repair never reaches across accounts", async () => {
    const other = await createTestUser();
    try {
      const conversationId = await corrupt();
      const { client } = scripted([{ text: "ok" }]);
      // Another account passing the id does not continue it: it gets a conversation of its own.
      const r = await chat(other, { conversationId, text: "give me that transcript", client } as never);
      expect(r.conversationId).not.toBe(conversationId);
      const rows = await rowsOf(r.conversationId);
      expect(rows.map((x) => x.text).join(" ")).not.toContain("log my sets");
    } finally {
      await deleteTestUser(other.id);
    }
  });
});

d("the same protocol serves Fast Log, with no second implementation", () => {
  let u: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("a quick note goes through the same loop and stores the same shapes", async () => {
    const { client } = scripted([
      { toolUse: [{ name: "create_task", input: { title: "Quick note task" } }] },
      { text: "Saved." },
    ]);
    const r = await chat(u, { text: "remind me to call the dentist", kind: "quick_entry", maxRounds: 4, client } as never);
    const rows = await rowsOf(r.conversationId);
    const useRow = rows.findIndex((x) => blocks(x).some((b) => b.type === "tool_use"));
    expect(rows[useRow + 1].role).toBe("user");
    expect(blocks(rows[useRow + 1]).filter((b) => b.type === "tool_result")).toHaveLength(1);
    expect(validateTranscript(rows.filter((x) => x.role !== "system").map((x) => ({ role: x.role as "user", content: (x.content as Msg["content"]) ?? x.text })))).toEqual([]);
  });

  it("the assistant does not adopt a Fast Log transcript on mount", async () => {
    const { client } = scripted([{ text: "Saved." }]);
    const quick = await chat(u, { text: "a quick note", kind: "quick_entry", client } as never);
    const resumed = await resumeConversation(u.id, null);
    expect(resumed?.id).not.toBe(quick.conversationId);
  });

  it("but it can still be opened deliberately from the list", async () => {
    const { client } = scripted([{ text: "Saved." }]);
    const quick = await chat(u, { text: "another quick note", kind: "quick_entry", client } as never);
    const opened = await resumeConversation(u.id, quick.conversationId);
    expect(opened?.id).toBe(quick.conversationId);
  });
});

d("a confirmed action happens once", () => {
  let u: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("two clicks on the same confirmation card do not do the work twice", async () => {
    const goal = await createGoal(u.id, goalCreateSchema.parse({ name: "Delete me twice" }));
    // `delete_goal` is high risk, so it always waits for the user rather than running straight away.
    const { client } = scripted([{ toolUse: [{ name: "delete_goal", input: { id: goal.id, name: goal.name } }] }, { text: "ok" }]);
    const r = await run(u, { text: "delete that goal", client });
    const waiting = r.pending[0];
    expect(waiting?.tool).toBe("delete_goal");

    const both = await Promise.allSettled([confirmAction(u, waiting.logId), confirmAction(u, waiting.logId)]);
    expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(both.find((x) => x.status === "rejected")).toBeTruthy();

    // Two rows and no more: the pending row, claimed once and flipped to confirmed, and the one row the
    // execution itself writes. A second execution would add a third.
    const logs = await db.select().from(aiActionLogs).where(and(eq(aiActionLogs.conversationId, r.conversationId), eq(aiActionLogs.tool, "delete_goal")));
    expect(logs).toHaveLength(2);
    expect(logs.filter((l) => l.status === "pending_confirmation")).toHaveLength(0);
    expect(logs.filter((l) => l.durationMs !== null)).toHaveLength(1); // exactly one row records a run
  });

  it("a second confirmation after the first finished is refused, not replayed", async () => {
    const goal = await createGoal(u.id, goalCreateSchema.parse({ name: "Once only" }));
    const { client } = scripted([{ toolUse: [{ name: "delete_goal", input: { id: goal.id, name: goal.name } }] }, { text: "ok" }]);
    const r = await run(u, { text: "delete it", client });
    await confirmAction(u, r.pending[0].logId);
    await expect(confirmAction(u, r.pending[0].logId)).rejects.toMatchObject({ status: 409 });
  });

  it("belongs to the account that was asked", async () => {
    const other = await createTestUser();
    try {
      const goal = await createGoal(u.id, goalCreateSchema.parse({ name: "Not yours" }));
      const { client } = scripted([{ toolUse: [{ name: "delete_goal", input: { id: goal.id, name: goal.name } }] }, { text: "ok" }]);
      const r = await run(u, { text: "delete it", client });
      await expect(confirmAction(other, r.pending[0].logId)).rejects.toMatchObject({ status: 404 });
    } finally {
      await deleteTestUser(other.id);
    }
  });
});

d("what the browser is told when a turn fails", () => {
  let u: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { u = await createTestUser(); });
  afterAll(async () => { if (u) await deleteTestUser(u.id); });

  it("gets the plain sentence, never the provider's", async () => {
    const exploding = { messages: { stream() { const s = { on() { return s; }, async finalMessage(): Promise<never> { throw new Error("Anthropic: 400 invalid_request_error messages.7 tool_use ids toolu_01Pam request_id req_1"); } }; return s; } } };
    const reader = chatStream(u, { text: "hello", client: exploding as never }).getReader();
    const decoder = new TextDecoder();
    const parser = createEventParser();
    const events: ChatStreamEvent[] = [];
    for (;;) { const { value, done } = await reader.read(); if (done) break; events.push(...parser.push(decoder.decode(value, { stream: true }))); }
    const err = events.find((e) => e.type === "error");
    expect(err?.type === "error" && err.message).toBe(GENERIC_AI_ERROR);
    const wire = JSON.stringify(events);
    for (const forbidden of ["invalid_request_error", "toolu_", "req_1", "messages.7"]) expect(wire, forbidden).not.toContain(forbidden);
  });
});
