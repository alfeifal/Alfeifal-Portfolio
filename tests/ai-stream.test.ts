/**
 * Streaming chat. Two layers are covered here without an API key: the NDJSON transport (framing and
 * incremental parsing, exactly what the browser does with the response body) and the agent's streaming
 * loop driven by a stand-in Anthropic client, which proves accumulation, tool rounds, persistence and
 * error handling. A real generation against the model is NOT exercised: that needs ANTHROPIC_API_KEY.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { conversations, messages } from "@/server/db/schema";
import { createEventParser, encodeEvent, type ChatStreamEvent } from "@/server/ai/stream";
import { chatStream } from "@/server/ai/agent";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

describe("chat stream transport", () => {
  it("frames one event per line and parses them back", () => {
    const events: ChatStreamEvent[] = [
      { type: "start", conversationId: "c1" },
      { type: "text", delta: "Hoy" },
      { type: "text", delta: " tienes" },
      { type: "done", conversationId: "c1", messageId: "m1", usage: { input: 10, output: 5 } },
    ];
    const wire = events.map(encodeEvent).join("");
    expect(wire.endsWith("\n")).toBe(true);
    const parser = createEventParser();
    expect(parser.push(wire)).toEqual(events);
    expect(parser.rest()).toBe("");
  });

  it("holds an unfinished line until the rest of it arrives", () => {
    const parser = createEventParser();
    const wire = encodeEvent({ type: "text", delta: "entrenamiento de piernas" });
    const cut = Math.floor(wire.length / 2);
    expect(parser.push(wire.slice(0, cut))).toEqual([]);
    expect(parser.rest().length).toBeGreaterThan(0);
    expect(parser.push(wire.slice(cut))).toEqual([{ type: "text", delta: "entrenamiento de piernas" }]);
    expect(parser.rest()).toBe("");
  });

  it("survives odd chunking, accents and a malformed line", () => {
    const parser = createEventParser();
    const wire = encodeEvent({ type: "text", delta: "café ☕ y entrecot" }) + "{not json}\n" + encodeEvent({ type: "text", delta: "!" });
    const out: ChatStreamEvent[] = [];
    for (const ch of wire) out.push(...parser.push(ch)); // one character at a time
    expect(out).toEqual([{ type: "text", delta: "café ☕ y entrecot" }, { type: "text", delta: "!" }]);
  });

  it("accumulating the deltas reproduces the answer", () => {
    const deltas = ["Hoy", " tienes", " entrenamiento", " de piernas"];
    const parser = createEventParser();
    const events = parser.push(deltas.map((delta) => encodeEvent({ type: "text", delta })).join(""));
    const text = events.reduce((a, e) => (e.type === "text" ? a + e.delta : a), "");
    expect(text).toBe("Hoy tienes entrenamiento de piernas");
  });
});

/** Minimal stand-in for the Anthropic messages API: enough surface for the agent's loop. */
function fakeClient(script: { text?: string; toolUse?: { name: string; input: unknown }; fail?: string; failAfterText?: string }[]) {
  let call = 0;
  const build = (step: (typeof script)[number]) => {
    const content: unknown[] = [];
    if (step.text) content.push({ type: "text", text: step.text });
    if (step.toolUse) content.push({ type: "tool_use", id: `tu_${call}`, name: step.toolUse.name, input: step.toolUse.input });
    return { id: `msg_${call}`, content, stop_reason: step.toolUse ? "tool_use" : "end_turn", usage: { input_tokens: 5, output_tokens: 7 } };
  };
  return {
    messages: {
      stream(_params: unknown) {
        const step = script[Math.min(call, script.length - 1)];
        const listeners: ((t: string) => void)[] = [];
        const self = {
          on(_event: string, cb: (t: string) => void) { listeners.push(cb); return self; },
          async finalMessage() {
            if (step.failAfterText) { for (const c of step.failAfterText.split(" ")) listeners.forEach((l) => l(c + " ")); throw new Error("upstream died"); }
            if (step.fail) throw new Error(step.fail);
            for (const word of (step.text ?? "").split(" ").filter(Boolean)) listeners.forEach((l) => l(word + " "));
            const msg = build(step);
            call++;
            return msg;
          },
        };
        return self;
      },
      async create(_params: unknown) { const msg = build(script[Math.min(call, script.length - 1)]); call++; return msg; },
    },
  } as never;
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = createEventParser();
  const events: ChatStreamEvent[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    events.push(...parser.push(decoder.decode(value, { stream: true })));
  }
  return events;
}

d("chat stream over the real agent loop (stand-in model)", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  it("emits start, the text as it is produced, and done — and persists one assistant message", async () => {
    const events = await collect(chatStream(user, { text: "What should I do today?", client: fakeClient([{ text: "Hoy tienes entrenamiento de piernas" }]) }));
    expect(events[0].type).toBe("start");
    const texts = events.filter((e) => e.type === "text");
    expect(texts.length).toBeGreaterThan(1); // really incremental, not one lump
    expect(texts.reduce((a, e) => a + (e.type === "text" ? e.delta : ""), "").trim()).toBe("Hoy tienes entrenamiento de piernas");
    const done = events.at(-1);
    expect(done?.type).toBe("done");

    const conversationId = (events[0] as { conversationId: string }).conversationId;
    const rows = await db.select().from(messages).where(eq(messages.conversationId, conversationId));
    expect(rows.filter((r) => r.role === "user")).toHaveLength(1);
    const assistant = rows.filter((r) => r.role === "assistant");
    expect(assistant).toHaveLength(1); // one row for the turn, not one per chunk
    expect(assistant[0].text).toBe("Hoy tienes entrenamiento de piernas");
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conv.expiresAt.getTime()).toBeGreaterThan(Date.now()); // the 24 h window was slid forward
  });

  it("keeps tool calling intact and never leaks arguments or ids down the wire", async () => {
    const events = await collect(chatStream(user, {
      text: "Create a task to call the dentist",
      client: fakeClient([{ text: "One moment", toolUse: { name: "create_task", input: { title: "Call the dentist" } } }, { text: "Done, I created it" }]),
    }));
    const tool = events.find((e) => e.type === "tool");
    expect(tool).toEqual({ type: "tool", name: "create_task" });
    const action = events.find((e) => e.type === "action");
    expect(action?.type === "action" && action.action.tool).toBe("create_task");
    expect(action?.type === "action" && action.action.status).toBe("success");
    // The answer the user reads never carries internal machinery; tool arguments and results travel
    // only inside action/pending events, which the UI renders as cards exactly as the non-streaming
    // endpoint already did.
    const streamedText = events.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.delta : "")).join("");
    for (const internal of ["tu_0", "tool_use", "{", "}", "input", "logId"]) expect(streamedText).not.toContain(internal);
    expect(events.map(encodeEvent).join("")).not.toContain("tu_0"); // no internal tool_use ids anywhere
    const final = events.filter((e) => e.type === "text").reduce((a, e) => a + (e.type === "text" ? e.delta : ""), "");
    expect(final).toContain("Done, I created it");
  });

  it("a medium-risk tool still stops for confirmation, and says so instead of claiming success", async () => {
    const events = await collect(chatStream(user, {
      text: "Set my targets",
      client: fakeClient([{ text: "Sure", toolUse: { name: "update_nutrition_targets", input: { calories: 2500, protein: 170, carbs: 300, fat: 70 } } }, { text: "It is waiting for your confirmation" }]),
    }));
    const pending = events.find((e) => e.type === "pending");
    expect(pending?.type === "pending" && pending.action.status).toBe("pending_confirmation");
    expect(events.some((e) => e.type === "action")).toBe(false);
  });

  it("a failure before any text is a clean error; one after text keeps what arrived", async () => {
    const early = await collect(chatStream(user, { text: "hello", client: fakeClient([{ fail: "model unavailable" }]) }));
    const err = early.find((e) => e.type === "error");
    expect(err).toMatchObject({ type: "error", partial: false });
    expect(err?.type === "error" && err.message).toContain("model unavailable");
    expect(early.some((e) => e.type === "done")).toBe(false);

    const late = await collect(chatStream(user, { text: "hello again", client: fakeClient([{ failAfterText: "Hoy tienes" }]) }));
    const lateErr = late.find((e) => e.type === "error");
    expect(lateErr).toMatchObject({ type: "error", partial: true });
    expect(late.filter((e) => e.type === "text").length).toBeGreaterThan(0);
    expect(late.some((e) => e.type === "done")).toBe(false);
  });

  it("two turns in the same conversation stay in that conversation and do not duplicate messages", async () => {
    const first = await collect(chatStream(user, { text: "first", client: fakeClient([{ text: "one" }]) }));
    const conversationId = (first[0] as { conversationId: string }).conversationId;
    const second = await collect(chatStream(user, { conversationId, text: "second", client: fakeClient([{ text: "two" }]) }));
    expect((second[0] as { conversationId: string }).conversationId).toBe(conversationId);
    const rows = await db.select().from(messages).where(eq(messages.conversationId, conversationId));
    expect(rows.filter((r) => r.role === "user").map((r) => r.text)).toEqual(["first", "second"]);
    expect(rows.filter((r) => r.role === "assistant")).toHaveLength(2);
  });

  it("two concurrent turns never mix their conversations", async () => {
    const [a, b] = await Promise.all([
      collect(chatStream(user, { text: "alpha", client: fakeClient([{ text: "answer alpha" }]) })),
      collect(chatStream(user, { text: "beta", client: fakeClient([{ text: "answer beta" }]) })),
    ]);
    const idA = (a[0] as { conversationId: string }).conversationId;
    const idB = (b[0] as { conversationId: string }).conversationId;
    expect(idA).not.toBe(idB);
    const rowsA = await db.select().from(messages).where(eq(messages.conversationId, idA));
    expect(rowsA.map((r) => r.text)).toContain("alpha");
    expect(rowsA.map((r) => r.text)).not.toContain("beta");
  });
});
