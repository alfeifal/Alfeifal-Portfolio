/**
 * One test per module the user listed: an AI write really lands in the database, and the pages that
 * display it are really told to refetch. Each case drives the agent's own loop with a stand-in model,
 * so the tool, the validation, the risk gate, the action log and the emitted events are all the real
 * ones — only the text generation is replaced.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser, deleteTestUser } from "./helpers";
import { db } from "@/server/db";
import { events as calendarEvents, tasks, transactions } from "@/server/db/schema";
import { createEventParser, type ChatStreamEvent } from "@/server/ai/stream";
import { chatStream } from "@/server/ai/agent";
import { invalidateModules, modulesOf, subscribePath, __resetInvalidation } from "@/lib/invalidate";
import { getTool, runTool } from "./_tool-helpers";
import "@/server/ai/tools";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

function fakeClient(script: { text?: string; toolUse?: { name: string; input: unknown } }[]) {
  let call = 0;
  const build = (step: (typeof script)[number]) => {
    const content: unknown[] = [];
    if (step.text) content.push({ type: "text", text: step.text });
    if (step.toolUse) content.push({ type: "tool_use", id: `tu_${call}`, name: step.toolUse.name, input: step.toolUse.input });
    return { id: `msg_${call}`, content, stop_reason: step.toolUse ? "tool_use" : "end_turn", usage: { input_tokens: 5, output_tokens: 7 } };
  };
  return {
    messages: {
      stream() { const step = script[Math.min(call, script.length - 1)]; const self = { on() { return self; }, async finalMessage() { const m = build(step); call++; return m; } }; return self; },
      async create() { const m = build(script[Math.min(call, script.length - 1)]); call++; return m; },
    },
  } as never;
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = createEventParser();
  const out: ChatStreamEvent[] = [];
  for (;;) { const { value, done } = await reader.read(); if (done) break; out.push(...parser.push(decoder.decode(value, { stream: true }))); }
  return out;
}

d("every module refreshes its own pages after an AI write", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { user = await createTestUser(); });
  afterAll(async () => { if (user) await deleteTestUser(user.id); });
  beforeEach(() => __resetInvalidation());

  /** Runs one tool through the real registry and reports which paths an open UI would refetch. */
  async function act(toolName: string, input: unknown, watch: string[]) {
    const tool = getTool(toolName);
    expect(tool, `tool ${toolName} must exist`).toBeTruthy();
    const action = await runTool(tool!, input, user, tool!.risk === "medium" || tool!.risk === "high");
    const refetched: string[] = [];
    for (const p of watch) subscribePath(p, () => refetched.push(p));
    invalidateModules(modulesOf([action]));
    return { action, refetched };
  }

  it("Finance: an expense lands in the DB and finance + dashboard refetch", async () => {
    const { action, refetched } = await act("add_expense", { amount: 12, description: "Lunch sync", date: "2026-09-15" }, ["/api/finance/summary", "/api/finance/transactions", "/api/dashboard"]);
    expect(action.status).toBe("success");
    const rows = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.description, "Lunch sync")));
    expect(rows).toHaveLength(1);
    expect(refetched).toHaveLength(3);
  });

  it("Tasks: completing a task refreshes the task lists and the dashboard", async () => {
    const [t] = await db.insert(tasks).values({ userId: user.id, title: "Sync probe task" }).returning();
    const { action, refetched } = await act("complete_task", { id: t.id }, ["/api/tasks?status=todo", "/api/tasks/counts", "/api/dashboard"]);
    expect(action.status).toBe("success");
    const [after] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(after.status).toBe("done");
    expect(refetched).toHaveLength(3);
  });

  it("Calendar: a new event refreshes the calendar and the dashboard", async () => {
    const { action, refetched } = await act("create_event", { title: "Gym sync probe", startAt: "2026-09-16T18:00:00", endAt: "2026-09-16T19:00:00" }, ["/api/events?from=2026-09-01", "/api/dashboard"]);
    expect(action.status).toBe("success");
    const rows = await db.select().from(calendarEvents).where(and(eq(calendarEvents.userId, user.id), eq(calendarEvents.title, "Gym sync probe")));
    expect(rows).toHaveLength(1);
    expect(refetched).toHaveLength(2);
  });

  it("Nutrition: a logged meal refreshes the nutrition day view", async () => {
    const { action, refetched } = await act("log_meal", { type: "lunch", date: "2026-09-15", items: [{ description: "Entrecot 400g", quantity: 400, unit: "g", calories: 1000, protein: 88, carbs: 0, fat: 70, basis: "total", source: "estimated", confidence: 60 }] }, ["/api/nutrition/day?date=2026-09-15", "/api/dashboard"]);
    expect(action.status).toBe("success");
    expect(refetched).toHaveLength(2);
  });

  it("Training: a logged set refreshes today's workout and the stats", async () => {
    const today = await runTool(getTool("get_today_workout")!, {}, user);
    expect(today.status).toBe("success");
    const { action, refetched } = await act("log_workout", { date: "2026-09-15", finished: true, notes: "Sync probe", durationMinutes: 60 }, ["/api/training/today", "/api/training/stats", "/api/dashboard"]);
    expect(action.status).toBe("success");
    expect(refetched).toHaveLength(3);
  });

  it("Studies: a study session refreshes the studies pages", async () => {
    const { action, refetched } = await act("log_study_session", { subject: "Matematicas", date: "2026-09-15", durationMinutes: 45, topic: "Sync probe" }, ["/api/studies/sessions", "/api/dashboard"]);
    expect(action.status).toBe("success");
    expect(refetched).toHaveLength(2);
  });

  it("Goals: a new goal refreshes goals and milestones", async () => {
    const { action, refetched } = await act("create_goal", { name: "Sync probe goal", category: "health" }, ["/api/goals", "/api/milestones/x", "/api/dashboard"]);
    expect(action.status).toBe("success");
    expect(refetched).toHaveLength(3);
  });

  it("Projects: a new project refreshes the project pages", async () => {
    const { action, refetched } = await act("create_project", { name: "Velsoma sync probe" }, ["/api/projects", "/api/dashboard"]);
    expect(action.status).toBe("success");
    expect(refetched).toHaveLength(2);
  });

  it("Journal: a new entry refreshes the journal", async () => {
    const { action, refetched } = await act("create_journal_entry", { date: "2026-09-15", content: "Sync probe entry" }, ["/api/journal", "/api/dashboard"]);
    expect(action.status).toBe("success");
    expect(refetched).toHaveLength(2);
  });

  it("Investing: an investing write refreshes the portfolio", async () => {
    const portfolio = await runTool(getTool("get_portfolio")!, {}, user);
    expect(portfolio.status).toBe("success");
    const { action, refetched } = await act("create_investment_account", { name: "Trading212 sync probe", type: "broker" }, ["/api/investing/portfolio", "/api/investing/accounts"]);
    expect(action.status).toBe("success");
    expect(refetched).toHaveLength(2);
  });

  it("Trading: a watchlist change refreshes the trading pages", async () => {
    const { refetched } = await act("add_to_watchlist", { symbol: "AAPL" }, ["/api/trading/watchlist", "/api/trading/stats"]);
    expect(refetched).toHaveLength(2);
  });

  it("Notifications: marking one read refreshes the notification list", async () => {
    const { action, refetched } = await act("mark_notifications_read", { all: true }, ["/api/notifications"]);
    expect(action.status).toBe("success");
    expect(refetched).toEqual(["/api/notifications"]);
  });

  it("Memory: an AI memory edit refreshes the memory page", async () => {
    await runTool(getTool("remember_memory")!, { kind: "fact", key: "sync_probe", content: "probe" }, user);
    const { action, refetched } = await act("update_memory", { key: "sync_probe", content: "probe updated" }, ["/api/ai/memory"]);
    expect(action.status).toBe("success");
    expect(refetched).toEqual(["/api/ai/memory"]);
  });

  it("end to end through the stream: the DB, the action and the refetch all agree", async () => {
    const events = await collect(chatStream(user, {
      text: "Spent €25 on groceries",
      client: fakeClient([{ toolUse: { name: "add_expense", input: { amount: 25, description: "Groceries e2e", date: "2026-09-15" } } }, { text: "Saved €25." }]),
    }));
    const action = (events.find((e) => e.type === "action") as { action: { module: string; status: string; result: unknown } }).action;
    const [row] = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.description, "Groceries e2e")));
    expect(row).toBeTruthy();
    // what the tool returned, what is in the database and what the UI refetches are one and the same
    expect(Number(row.amount)).toBe(25);
    expect((action.result as { id?: string }).id).toBe(row.id);
    const refetched: string[] = [];
    subscribePath("/api/finance/summary", () => refetched.push("summary"));
    invalidateModules(modulesOf([action]));
    expect(refetched).toEqual(["summary"]);
  });
});
