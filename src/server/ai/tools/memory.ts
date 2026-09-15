import { z } from "zod";
import { defineTool } from "../registry";
import * as mem from "@/server/services/memory";
import { globalSearch } from "@/server/services/search";

defineTool({
  name: "remember_memory", module: "ai", risk: "low",
  description: "Store a durable fact/preference about the user's life (e.g. work schedule, goals, people, preferences). Use a stable key to update rather than duplicate (e.g. 'work_schedule').",
  schema: mem.memorySchema.omit({ source: true }),
  summarize: (i) => `remember_memory — ${i.key ?? i.kind} — ${i.content.slice(0, 50)}`,
  run: (i, ctx) => mem.rememberMemory(ctx.user.id, { ...i, source: "ai" }),
});
defineTool({ name: "forget_memory", module: "ai", risk: "medium", description: "Delete a stored memory by id. Requires confirmation.", schema: z.object({ id: z.string().uuid() }), needsConfirmation: () => "Forget memory", summarize: (i) => `forget_memory — ${i.id.slice(0, 8)}`, run: async (i, ctx) => { await mem.forgetMemory(ctx.user.id, i.id); return { deleted: i.id }; } });
defineTool({ name: "search_everything", module: "ai", risk: "read", description: "Keyword search across tasks, events, transactions, goals, projects, journal, studies, workouts, trades, exercises, news and German content.", schema: z.object({ q: z.string().min(2) }), run: (i, ctx) => globalSearch(ctx.user.id, i.q) });

defineTool({
  name: "update_memory", module: "ai", risk: "low",
  description: "Edit a stored memory: its text, kind, importance (1-5), key, pin or expiry. Use it to correct or refine something you remembered instead of adding a near-duplicate.",
  schema: z.object({ id: z.string().uuid() }).extend(mem.memorySchema.partial().omit({ source: true }).shape),
  summarize: (i) => `update_memory — ${i.id.slice(0, 8)}`,
  run: ({ id, ...rest }, ctx) => mem.updateMemory(ctx.user.id, id, rest),
});
