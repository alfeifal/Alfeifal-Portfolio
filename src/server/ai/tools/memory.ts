import { z } from "zod";
import { defineTool } from "../registry";
import * as mem from "@/server/services/memory";
import { globalSearch, MAX_QUERY_LENGTH, SEARCH_MODULES } from "@/server/services/search";

/**
 * A memory is addressed by `key` (the semantic slug the assistant chose, e.g. "investments_trading212")
 * or by `id` (the UUID primary key). The system prompt only ever shows the key, so the key is the
 * normal handle; `id` is accepted for memories the model looked up with search_memory/get_memory.
 * Exactly one must be supplied, and a non-UUID string is never silently accepted as an id.
 */
const memoryRef = z.object({
  id: z.string().uuid().nullish().describe("The memory's UUID, as returned by search_memory/get_memory. Omit it if you only know the key."),
  key: z.string().max(100).nullish().describe("The memory's semantic key, e.g. 'work_schedule' — the slug shown as [kind:key] in your context. This is NOT a UUID."),
}).refine((v) => Boolean(v.id) || Boolean(v.key), { message: "Provide the memory's key, or its id if you know the UUID" });

/** Compact shape for the model: enough to pick the right memory and address it afterwards. */
const brief = (m: { id: string; kind: string; key: string | null; content: string; importance: number; pinned: boolean; updatedAt: Date }) =>
  ({ id: m.id, key: m.key, kind: m.kind, content: m.content, importance: m.importance, pinned: m.pinned, updatedAt: m.updatedAt });

defineTool({
  name: "remember_memory", module: "ai", risk: "low",
  description: "Store a durable fact/preference about the user's life (e.g. work schedule, goals, people, preferences). Use a stable key to update rather than duplicate (e.g. 'work_schedule').",
  schema: mem.memorySchema.omit({ source: true }),
  summarize: (i) => `remember_memory — ${i.key ?? i.kind} — ${i.content.slice(0, 50)}`,
  run: (i, ctx) => mem.rememberMemory(ctx.user.id, { ...i, source: "ai" }),
});

defineTool({
  name: "search_memory", module: "ai", risk: "read",
  description: "Search the user's long-term memories by text, key or kind. Returns each memory's real id and key — call this first when you need to update or delete a memory you cannot see in your context.",
  schema: z.object({ q: z.string().max(200).default(""), limit: z.number().int().min(1).max(50).default(10) }),
  run: async (i, ctx) => (await mem.searchMemory(ctx.user.id, i.q, i.limit)).map(brief),
});

defineTool({
  name: "get_memory", module: "ai", risk: "read",
  description: "Fetch one stored memory by key or id, including its real UUID.",
  schema: memoryRef,
  run: async (i, ctx) => brief(await mem.getMemory(ctx.user.id, i)),
});

defineTool({
  name: "update_memory", module: "ai", risk: "low",
  description: "Edit a stored memory: its text, kind, importance (1-5), key, pin or expiry. Address it by 'key' (the slug in your context) or by 'id' (a UUID from search_memory). Use it to correct or refine something you remembered instead of adding a near-duplicate.",
  schema: memoryRef.safeExtend(mem.memorySchema.partial().omit({ source: true }).shape),
  summarize: (i) => `update_memory — ${i.key ?? i.id?.slice(0, 8) ?? "memory"}`,
  run: ({ id, key, ...rest }, ctx) => mem.updateMemory(ctx.user.id, { id, key }, rest),
});

defineTool({
  name: "forget_memory", module: "ai", risk: "medium",
  description: "Delete a stored memory, addressed by key or id. Requires confirmation.",
  schema: memoryRef,
  needsConfirmation: () => "Forget memory",
  summarize: (i) => `forget_memory — ${i.key ?? i.id?.slice(0, 8) ?? "memory"}`,
  run: (i, ctx) => mem.forgetMemory(ctx.user.id, i),
});

/**
 * The assistant's way into the user's own data.
 *
 * Strictly read-only and always scoped to the caller. It takes a query string, two caps and an optional
 * module filter from a fixed list — there is no table, column, userId, ordering or SQL parameter, so it
 * cannot be used to reach another user's rows or to write anything. Every hit carries a safe internal
 * reference, which is how the model then calls the module's own read/write tools (and, for a memory,
 * both its `id` and its `key`, so it never has to guess a UUID).
 */
defineTool({
  name: "search_personal_os", module: "ai", risk: "read",
  description: [
    "Search everything in the user's Personal OS by keyword: tasks, calendar events, journal entries, goals, projects, milestones, plan items,",
    "transactions, accounts, categories, recurring payments, savings goals, budgets, foods, meals and logged nutrition entries, workouts, exercises,",
    "routine days and training plans, subjects, study sessions, assignments and exams, investment accounts/assets/transactions, trades, strategies,",
    "trading accounts, watchlist items, price alerts, academy lessons, notifications, stored memories, live AI conversations, market news and German course content.",
    "Case- and accent-insensitive, matches partial words, and all words must match. Use it to find something that is not in your context, then call that",
    "module's own get_/update_ tool with the id it returns. It is read-only: it can never create, change or delete anything.",
  ].join(" "),
  schema: z.object({
    q: z.string().min(2).max(MAX_QUERY_LENGTH).describe("What to look for, e.g. 'Budapest', 'Velsoma', 'entrenamiento pecho'."),
    limit: z.number().int().min(1).max(40).default(20).describe("Maximum hits to return."),
    modules: z.array(z.enum(SEARCH_MODULES)).max(SEARCH_MODULES.length).optional().describe("Restrict to these modules. Omit to search everything."),
  }),
  run: async (i, ctx) => {
    const r = await globalSearch(ctx.user.id, i.q, { limit: i.limit, modules: i.modules });
    // Compact on purpose: the model gets what it needs to choose and to act, not whole records.
    return {
      query: r.query, total: r.total, truncated: r.truncated,
      hits: r.hits.map((h) => ({ type: h.type, module: h.module, id: h.id, ...(h.key ? { key: h.key } : {}), title: h.title, snippet: h.snippet ?? undefined, date: h.date ?? undefined })),
    };
  },
});
