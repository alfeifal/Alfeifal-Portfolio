import { z } from "zod";
import { defineTool } from "../registry";
import * as mem from "@/server/services/memory";
import { globalSearch } from "@/server/services/search";

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

defineTool({ name: "search_everything", module: "ai", risk: "read", description: "Keyword search across tasks, events, transactions, goals, projects, journal, studies, workouts, trades, exercises, news and German content.", schema: z.object({ q: z.string().min(2) }), run: (i, ctx) => globalSearch(ctx.user.id, i.q) });
