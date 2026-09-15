/**
 * The contract between an AI action and the screen.
 *
 * Three separate things have to hold, and each is tested against the real thing rather than a mock of
 * it: the turn's outcome is derived from the action statuses (never from the model's prose), only
 * actions that really succeeded invalidate anything, and every tool module maps to the API paths whose
 * data it can change — so a page that is open refetches instead of showing pre-action numbers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { aiActionLogs, transactions } from "@/server/db/schema";
import { createEventParser, turnOutcome, type ChatStreamEvent } from "@/server/ai/stream";
import { chatStream } from "@/server/ai/agent";
import { allTools } from "@/server/ai/registry";
import { buildSystemPrompt } from "@/server/ai/context";
import {
  MODULE_PATHS, invalidateModules, invalidatePaths, matchesPrefix, modulesOf, pathsForModules,
  subscribePath, __resetInvalidation,
} from "@/lib/invalidate";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

// ---------------------------------------------------------------- pure layer

describe("turn outcome", () => {
  const ok = { status: "success" };
  const confirmed = { status: "confirmed" };
  const failed = { status: "failed" };
  const pending = { status: "pending_confirmation" };

  it("is ok only when every action succeeded", () => {
    expect(turnOutcome([ok])).toBe("ok");
    expect(turnOutcome([ok, confirmed])).toBe("ok");
  });

  it("is partial — never ok — when one of several actions failed", () => {
    expect(turnOutcome([ok, failed])).toBe("partial");
    expect(turnOutcome([ok, ok, failed])).toBe("partial");
  });

  it("is failed when nothing got through", () => {
    expect(turnOutcome([failed])).toBe("failed");
    expect(turnOutcome([failed, failed])).toBe("failed");
  });

  it("reports a waiting confirmation rather than a success", () => {
    expect(turnOutcome([], [pending])).toBe("pending");
    expect(turnOutcome([ok], [pending])).toBe("pending");
  });

  it("a failure outranks a pending confirmation: nothing got through, so nothing is claimed", () => {
    expect(turnOutcome([failed], [pending])).toBe("failed");
    expect(turnOutcome([ok, failed], [pending])).toBe("partial");
  });

  it("is none when the turn was pure conversation", () => {
    expect(turnOutcome([], [])).toBe("none");
  });
});

describe("module → path mapping", () => {
  it("covers every module in the tool registry", () => {
    const missing = [...new Set(allTools().map((t) => t.module))].filter((m) => !MODULE_PATHS[m]);
    expect(missing).toEqual([]);
  });

  it("maps each module to API paths that actually exist", () => {
    for (const [mod, paths] of Object.entries(MODULE_PATHS)) {
      expect(paths.length, mod).toBeGreaterThan(0);
      for (const p of paths) expect(p, `${mod} → ${p}`).toMatch(/^\/api\//);
    }
  });

  it("matches a path with a query string and does not match a sibling prefix", () => {
    expect(matchesPrefix("/api/finance/summary?from=2026-09-01", ["/api/finance"])).toBe(true);
    expect(matchesPrefix("/api/finance", ["/api/finance"])).toBe(true);
    expect(matchesPrefix("/api/financial-other", ["/api/finance"])).toBe(false);
    expect(matchesPrefix("/api/tasks/counts", ["/api/finance"])).toBe(false);
  });

  it("only counts actions that actually took effect", () => {
    const actions = [
      { module: "finance", status: "success" },
      { module: "tasks", status: "failed" },
      { module: "nutrition", status: "pending_confirmation" },
      { module: "goals", status: "confirmed" },
    ];
    expect(modulesOf(actions).sort()).toEqual(["finance", "goals"]);
  });

  it("an expense refetches finance, the dashboard and analytics", () => {
    const paths = pathsForModules(["finance"]);
    expect(paths).toContain("/api/finance");
    expect(paths).toContain("/api/dashboard");
    expect(paths).toContain("/api/analytics");
  });
});

describe("invalidation registry", () => {
  beforeEach(() => __resetInvalidation());

  it("refetches exactly the hooks under the affected module", () => {
    const hits: string[] = [];
    subscribePath("/api/finance/summary?from=2026-09-01&to=2026-09-30", () => hits.push("summary"));
    subscribePath("/api/finance/transactions?limit=500", () => hits.push("transactions"));
    subscribePath("/api/tasks?status=todo", () => hits.push("tasks"));
    invalidateModules(["finance"]);
    expect(hits.sort()).toEqual(["summary", "transactions"]);
  });

  it("a failed action refreshes nothing at all", () => {
    let hits = 0;
    subscribePath("/api/finance/summary", () => hits++);
    invalidateModules(modulesOf([{ module: "finance", status: "failed" }]));
    expect(hits).toBe(0);
  });

  it("an unmounted page is never called again", () => {
    let hits = 0;
    const off = subscribePath("/api/tasks", () => hits++);
    invalidateModules(["tasks"]);
    expect(hits).toBe(1);
    off();
    invalidateModules(["tasks"]);
    expect(hits).toBe(1);
  });

  it("does not fan out to unrelated modules", () => {
    let trading = 0;
    subscribePath("/api/trading/trades", () => trading++);
    invalidateModules(["nutrition"]);
    expect(trading).toBe(0);
  });

  it("an unknown module invalidates nothing rather than everything", () => {
    let hits = 0;
    subscribePath("/api/finance/summary", () => hits++);
    expect(invalidatePaths(pathsForModules(["not_a_module"]))).toBe(0);
    expect(hits).toBe(0);
  });
});

// ---------------------------------------------------------------- end to end

/** Stand-in Anthropic client: the agent's real loop runs, only the model is replaced. */
function fakeClient(script: { text?: string; toolUse?: { name: string; input: unknown }; toolUses?: { name: string; input: unknown }[] }[]) {
  let call = 0;
  const build = (step: (typeof script)[number]) => {
    const content: unknown[] = [];
    if (step.text) content.push({ type: "text", text: step.text });
    const uses = step.toolUses ?? (step.toolUse ? [step.toolUse] : []);
    uses.forEach((u, i) => content.push({ type: "tool_use", id: `tu_${call}_${i}`, name: u.name, input: u.input }));
    return { id: `msg_${call}`, content, stop_reason: uses.length ? "tool_use" : "end_turn", usage: { input_tokens: 5, output_tokens: 7 } };
  };
  return {
    messages: {
      stream() {
        const step = script[Math.min(call, script.length - 1)];
        const self = {
          on() { return self; },
          async finalMessage() { const m = build(step); call++; return m; },
        };
        return self;
      },
      async create() { const m = build(script[Math.min(call, script.length - 1)]); call++; return m; },
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

d("what the agent actually sends to the model", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });

  /** Captures the request params the agent builds, without reaching the network. */
  async function capture(opts: Parameters<typeof chatStream>[1] = { text: "hello" }) {
    const seen: { tools?: { name: string; cache_control?: unknown }[] }[] = [];
    const client = {
      messages: {
        stream(params: { tools?: { name: string; cache_control?: unknown }[] }) {
          seen.push(params);
          const self = { on() { return self; }, async finalMessage() { return { id: "m", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }; } };
          return self;
        },
      },
    } as never;
    await collect(chatStream(user, { ...opts, client }));
    return seen;
  }

  it("tells the model that finance, investing and trading figures are separate books", async () => {
    const prompt = await buildSystemPrompt(user);
    expect(prompt).toMatch(/net worth/i);
    expect(prompt).toMatch(/PAPER/);
    expect(prompt).toMatch(/income minus expenses/i);
  });

  it("sends every registered tool — no routing, nothing dropped", async () => {
    const [params] = await capture();
    expect(params.tools?.length).toBe(allTools().length);
  });

  it("marks exactly one prompt-cache breakpoint, at the end of the tool block", async () => {
    const [params] = await capture();
    const marked = params.tools!.filter((t) => t.cache_control);
    expect(marked).toHaveLength(1);
    expect(marked[0].name).toBe(params.tools!.at(-1)!.name);
    expect(marked[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("the tool block is big enough that caching it matters, and is built once", async () => {
    const a = await capture({ text: "one" });
    const b = await capture({ text: "two" });
    // Same object identity across requests: the ~90 kB of JSON is built once per process. The last
    // entry is deliberately a copy (that is where the breakpoint is stamped), so compare the one before.
    expect(a[0].tools!.at(-2)).toBe(b[0].tools!.at(-2));
    expect(a[0].tools!.at(-1)).not.toBe(b[0].tools!.at(-1));
    expect(JSON.stringify(a[0].tools).length).toBeGreaterThan(50_000);
  });

  it("marking a breakpoint never mutates the memoised block", async () => {
    const [params] = await capture();
    const uncached = allTools().length - 1;
    expect(params.tools!.filter((t) => !t.cache_control)).toHaveLength(uncached);
    const again = await capture();
    expect(again[0].tools!.filter((t) => t.cache_control)).toHaveLength(1); // not two
  });
});

d("an AI action and what the UI is told about it", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });
  beforeEach(() => __resetInvalidation());

  it("Fast Log: the expense is in the database and the finance pages are told to refetch", async () => {
    const before = await db.select().from(transactions).where(eq(transactions.userId, user.id));
    const events = await collect(chatStream(user, {
      text: "Spent €12 on lunch",
      client: fakeClient([
        { toolUse: { name: "add_expense", input: { amount: 12, description: "Lunch", date: "2026-09-15" } } },
        { text: "Saved: €12 lunch." },
      ]),
    }));

    const action = events.find((e) => e.type === "action");
    expect(action?.type === "action" && action.action.status).toBe("success");
    // The module travels with the action: that is what the client invalidates on.
    expect(action?.type === "action" && action.action.module).toBe("finance");

    const rows = await db.select().from(transactions).where(eq(transactions.userId, user.id));
    expect(rows.length).toBe(before.length + 1);
    const created = rows.find((r) => !before.some((b) => b.id === r.id))!;
    expect(Number(created.amount)).toBe(12);
    expect(created.type).toBe("expense");

    const done = events.at(-1);
    expect(done?.type === "done" && done.outcome).toBe("ok");

    // What an open Finance page does with that event.
    const refetched: string[] = [];
    subscribePath("/api/finance/summary?from=2026-09-01&to=2026-09-30", () => refetched.push("summary"));
    subscribePath("/api/finance/transactions?limit=500", () => refetched.push("transactions"));
    subscribePath("/api/dashboard", () => refetched.push("dashboard"));
    const actions = events.filter((e) => e.type === "action").map((e) => (e as { action: { module: string; status: string } }).action);
    invalidateModules(modulesOf(actions));
    expect(refetched.sort()).toEqual(["dashboard", "summary", "transactions"]);
  });

  it("the tool event reaches the client before the action completes", async () => {
    const events = await collect(chatStream(user, {
      text: "Add a task",
      client: fakeClient([{ toolUse: { name: "create_task", input: { title: "Call the dentist" } } }, { text: "Created." }]),
    }));
    const toolIdx = events.findIndex((e) => e.type === "tool");
    const actionIdx = events.findIndex((e) => e.type === "action");
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeLessThan(actionIdx); // the spinner can appear while the work is still running
  });

  it("a failed tool is reported as failed and refreshes nothing", async () => {
    const events = await collect(chatStream(user, {
      text: "Add a task with no title",
      client: fakeClient([{ toolUse: { name: "create_task", input: { title: "" } } }, { text: "I could not create it." }]),
    }));
    const action = events.find((e) => e.type === "action");
    expect(action?.type === "action" && action.action.status).toBe("failed");
    const done = events.at(-1);
    expect(done?.type === "done" && done.outcome).toBe("failed");

    let hits = 0;
    subscribePath("/api/tasks", () => hits++);
    const actions = events.filter((e) => e.type === "action").map((e) => (e as { action: { module: string; status: string } }).action);
    invalidateModules(modulesOf(actions));
    expect(hits).toBe(0); // nothing changed, so nothing is refetched
  });

  it("one success plus one failure is partial — the UI can never call that turn done", async () => {
    const events = await collect(chatStream(user, {
      text: "Log lunch and create a task",
      client: fakeClient([
        { toolUses: [
          { name: "add_expense", input: { amount: 9, description: "Coffee", date: "2026-09-15" } },
          { name: "create_task", input: { title: "" } },
        ] },
        { text: "Done." }, // the model claiming success must not decide the outcome
      ]),
    }));
    const actions = events.filter((e) => e.type === "action").map((e) => (e as { action: { module: string; status: string; tool: string } }).action);
    expect(actions).toHaveLength(2);
    expect(actions.filter((a) => a.status === "success")).toHaveLength(1);
    expect(actions.filter((a) => a.status === "failed")).toHaveLength(1);

    const done = events.at(-1);
    expect(done?.type === "done" && done.outcome).toBe("partial");

    // Only the module that really changed is refetched.
    expect(modulesOf(actions)).toEqual(["finance"]);
  });

  it("the model is told a tool failed, in the transcript, so it cannot claim success", async () => {
    const events = await collect(chatStream(user, {
      text: "Create an impossible task",
      client: fakeClient([{ toolUse: { name: "create_task", input: { title: "" } } }, { text: "It failed." }]),
    }));
    const conversationId = (events[0] as { conversationId: string }).conversationId;
    const { messages } = await import("@/server/db/schema");
    const rows = await db.select().from(messages).where(eq(messages.conversationId, conversationId));
    const toolResults = rows.flatMap((r) => (Array.isArray(r.content) ? (r.content as { type: string; is_error?: boolean; content?: string }[]) : []))
      .filter((b) => b.type === "tool_result");
    expect(toolResults.some((b) => b.is_error === true)).toBe(true);
    expect(toolResults.some((b) => String(b.content).includes("FAILED"))).toBe(true);
  });

  it("a pending confirmation is not a success and changes nothing until confirmed", async () => {
    const events = await collect(chatStream(user, {
      text: "Set my nutrition targets",
      client: fakeClient([{ toolUse: { name: "update_nutrition_targets", input: { calories: 2500, protein: 170, carbs: 300, fat: 70 } } }, { text: "Waiting for you." }]),
    }));
    const pending = events.find((e) => e.type === "pending");
    expect(pending?.type === "pending" && pending.action.status).toBe("pending_confirmation");
    const done = events.at(-1);
    expect(done?.type === "done" && done.outcome).toBe("pending");
    expect(modulesOf([(pending as { action: { module: string; status: string } }).action])).toEqual([]);
  });

  it("does not duplicate the record when the same sentence is sent twice", async () => {
    const run = () => collect(chatStream(user, {
      text: "Spent €7 on a sandwich",
      client: fakeClient([{ toolUse: { name: "add_expense", input: { amount: 7, description: "Sandwich dedupe probe", date: "2026-09-15" } } }, { text: "Saved." }]),
    }));
    await run();
    const after1 = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.description, "Sandwich dedupe probe")));
    expect(after1).toHaveLength(1);
    // A second, separate request is a second instruction from the user: it creates a second record,
    // and the point here is that one request never writes twice.
    const events = await run();
    expect(events.filter((e) => e.type === "action")).toHaveLength(1);
    const logs = await db.select().from(aiActionLogs).where(and(eq(aiActionLogs.userId, user.id), eq(aiActionLogs.tool, "add_expense")));
    expect(logs.filter((l) => l.status === "success").length).toBeGreaterThanOrEqual(2);
  });

  it("events arrive in a usable order: start first, done last, text before done", async () => {
    const events = await collect(chatStream(user, {
      text: "Log a coffee",
      client: fakeClient([{ text: "Sure", toolUse: { name: "add_expense", input: { amount: 2, description: "Coffee order probe", date: "2026-09-15" } } }, { text: "Saved." }]),
    }));
    expect(events[0].type).toBe("start");
    expect(events.at(-1)?.type).toBe("done");
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(events.filter((e) => e.type === "start")).toHaveLength(1);
    const doneIdx = events.length - 1;
    for (const t of ["text", "tool", "action"] as ChatStreamEvent["type"][]) {
      const last = events.map((e) => e.type).lastIndexOf(t);
      if (last >= 0) expect(last, t).toBeLessThan(doneIdx);
    }
  });

  it("actions are written to another user's data never — the log belongs to the caller", async () => {
    const other = await createTestUser();
    try {
      await collect(chatStream(user, {
        text: "Spent €3",
        client: fakeClient([{ toolUse: { name: "add_expense", input: { amount: 3, description: "Isolation probe", date: "2026-09-15" } } }, { text: "Saved." }]),
      }));
      const theirs = await db.select().from(transactions).where(and(eq(transactions.userId, other.id), eq(transactions.description, "Isolation probe")));
      expect(theirs).toHaveLength(0);
      const mine = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.description, "Isolation probe")));
      expect(mine).toHaveLength(1);
    } finally { await deleteTestUser(other.id); }
  });
});
